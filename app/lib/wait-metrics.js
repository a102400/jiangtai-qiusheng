'use strict';

/**
 * 等待指标统一模块（wait_metrics）
 * ------------------------------------------------------------------
 * 背景：此前「等待时间」有两套来源 —— /api/analyze 的平均等待、/api/heatmap 的逐次等待，
 * 各自实现、各自表述，用户容易被误。本模块把「等待秒数」收敛成唯一出口：
 * 所有由讲稿文本推断出来的等待值都必须从这里产出，并自曝来源（source）。
 *
 * 冻结口径（契约）：
 *   1. 没有提问 → moments 为空数组、average_sec 为 null。
 *      不许塞一条 wait_sec: 0 的伪造条目，也不许塞「整段未检测到提问」的伪片段。
 *   2. average_sec 是「逐条推断值的平均」，不是实测平均等待。
 *      各条推断值来自不同规则分支（3 / 2.5 / 0.5 / 0.8），取平均没有物理意义，
 *      只能当「整段提问节奏」的趋势参考 —— 这一句也写进了对外的 note 文案。
 *      没有可靠音频时间戳时，questions.avg_wait_sec 一律保持 null。
 *   3. 每个值都要带 source：
 *        text-heuristic  —— 本地规则按讲稿上下文推断
 *        model-inference —— 大模型按讲稿上下文推断
 *        timestamp       —— （预留，本批不实现）提问结束时间 + 学生回应开始时间的音频时间戳实测
 *
 * 本模块自包含：不依赖 heatmap.js，避免循环依赖与两处重复实现。
 *
 * 问句与互动任务（第三批 A）：
 *   · isQuestionSentence   —— 「这句话是不是在向学生提问」，等待时间推断只用它；
 *   · isInteractiveSentence —— 「这句话是不是在组织学生互动」（讨论/练习/板演/齐读…），
 *                              教学环节分类与时间分配用它。
 *   两套判定此前混在一起，导致陈述句被错当问句（「今天我们先看看勾股定理呢。」）。
 *   现在两者都在本模块实现，heatmap.js 直接引入，保证 /api/analyze 与 /api/heatmap 同源。
 */

/* ---------------- 来源取值 ---------------- */
const SOURCE_TEXT = 'text-heuristic';   // 本地规则推断
const SOURCE_MODEL = 'model-inference'; // 大模型推断
const SOURCE_TIMESTAMP = 'timestamp';   // 预留：音频时间戳实测（本批不产出）

/* ---------------- 说明文案 ----------------
   average_sec 的口径必须写死在文案里，避免下游把它读成「实测平均等待」：
   它是「逐条推断值的算术平均」，而这些推断值分别来自不同规则分支
   （等待信号 3 / 点名留白 2.5 / 确认式 0.5 / 默认 0.8），
   取平均没有物理意义，只能当「整段提问节奏」的趋势参考。 */
const NOTE_TEXT =
  '等待秒数由讲稿上下文推断，不是音频时间戳实测值；average_sec 是逐条推断值的平均，不是实测平均等待。';
const NOTE_MODEL =
  '等待秒数由模型依据讲稿上下文推断，不是音频时间戳实测值；average_sec 是逐条推断值的平均，不是实测平均等待。';
const NOTE_TIMESTAMP =
  '等待秒数由提问结束与学生回应开始时间的音频时间戳实测得出；average_sec 是实测等待的平均。';

/* 规则推断最多取几条（与旧热力图口径一致） */
const MAX_MOMENTS = 8;

/* ------------------------------------------------------------------ */
/* 通用工具                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把任意输入转成有限数值；null / undefined / '' / 非数字 一律变成 NaN。
 * 注意：Number(null) === 0，若直接用 Number() 会把「缺值」当成「0 秒」，
 * 这正是「不许伪造默认值」要防的事，所以这里显式挡掉空值。
 */
function toFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'boolean') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 切句：保留句末标点。
 * 问号是「这句是不是问句」的关键证据，切分时丢掉问号会让问句判定整体失效
 * （有问句的课被误判成「整段未检测到提问」）。
 */
function splitSentencesKeepPunct(text) {
  const src = String(text || '');
  const out = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    if ('。！？；!?;\n'.indexOf(ch) !== -1) {
      const s = buf.trim();
      // 至少要有 2 个正文字符才算一句（只丢「好。」这类残片，不丢「对吗？」这类真问句）
      if (s.replace(/[。！？；!?;，、,\s]/g, '').length >= 2) out.push(s);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail.replace(/[。！？；!?;，、,\s]/g, '').length >= 2) out.push(tail);
  return out;
}

/* ------------------------------------------------------------------ */
/* 问句判定 / 互动任务判定                                                */
/* ------------------------------------------------------------------ */
/*
 * 这两套判定本应分开，现在收敛到一处（避免两处口径漂移）：
 *   ① isQuestionSentence   —— 这句话是不是真的在向学生提问（用于等待时间推断）；
 *   ② isInteractiveSentence —— 这句话是不是在组织学生互动（讨论/练习/板演/齐读…），
 *                              用于教学环节分类与时间分配。
 * 互动任务不等于问句：「请同桌讨论这道题。」是互动任务，不是提问；
 * 「谁来回答？」既是问句，也自然算互动。
 */

/**
 * 强疑问词（可出现在句中任意位置，不要求在句首）。
 * 这一组是「明确在问」的硬证据：出现即视为具备疑问结构。
 * 注意「几个」不在列 —— 「分为几个步骤」是陈述句，误判率高。
 */
const INTERROGATIVE_STRONG =
  /(为什么|为啥|凭什么|怎么|怎样|多少|是否|是不是|有没有|能不能|可不可以|要不要|会不会|好不好|行不行|对不对|难道)/;

/**
 * 「情态/系动词 + 吗」的固定疑问搭配（行吗 / 对吗 / 好吗 / 能吗 / 是吗 …）。
 * 这里认的不是「吗」这个字，而是它前面那个能独立构成一般疑问句的成分；
 * 「吗」单独出现（懂了吗）不作为证据。
 */
const INTERROGATIVE_MA_FIXED = /(可以|行|是|对|好|能|难道|是否|应该|不是|无非)吗/;

/**
 * 疑问结构检测：句子里是否真的有疑问结构（疑问词 / 一般疑问句式）。
 * 不含「邀请式」——那是另一层判定（hasInvitationStructure）。
 */
function hasInterrogativeStructure(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // ① 强疑问词
  if (INTERROGATIVE_STRONG.test(t)) return true;

  // ② 疑问代词「哪」：排除「无论哪…」「不管哪…」的泛指用法
  if (/哪(?:个|些|位|里|种|样|儿|边|座|头|一|天|月|年)/.test(t) && !/(无论|不管)/.test(t)) {
    return true;
  }

  // ③ 疑问代词「什么」：排除泛指（无论什么 / 什么都 / 什么也）
  const what = t
    .replace(/(?:无论|不管|凭|爱|随他|随便)[^。？！!?；;\n]{0,2}什么/g, '')
    .replace(/什么(?:都|也|就|才)/g, '');
  if (/什么/.test(what)) return true;

  // ④ 疑问代词「谁」
  if (/谁[来能会是有想要说的把在跟和最也应可以回答知道看做写读听敢们]/.test(t)) return true;

  // ⑤ 「如何」当名词用（学习如何…/讲如何…）不是问句，先把这处排除再判定
  const how = t.replace(
    /(学习|讲解|介绍|了解|掌握|知道|谈谈|说说|讲讲|讲|谈|研究|探讨|阐述|说明)[^。？！!?；;\n]{0,4}如何/g,
    ''
  );
  if (/如何/.test(how)) return true;

  // ⑥ 「情态/系动词 + 吗」的固定疑问搭配
  if (INTERROGATIVE_MA_FIXED.test(t)) return true;

  return false;
}

/**
 * 邀请 / 应答式问句：句子里没有疑问词，但句式本身在索取学生回答。
 * 「讨论 / 交流 / 读一读 / 算一算」不在此列 —— 它们是互动任务，不是提问。
 */
function hasInvitationStructure(text) {
  const t = String(text || '');
  if (!t) return false;

  // 点名式：你来说说 / 你来说 / 你来讲 / 你来 / 说说看
  if (/(你说说看|你来说说|你来说|你来讲|你来讲讲|你来|你能|说说看)/.test(t)) return true;

  // 「请 …」后接思考 / 应答类动作（讨论、交流、练习、板演是互动任务，不算问句）
  if (
    /请[，,、]?[^。？！!?；;\n]{0,12}(说一说|说说|讲一讲|讲讲|答一答|答答|想一想|想想|猜一猜|猜猜|回答)/.test(t)
  ) {
    return true;
  }

  // 「大家 / 同学们」后必须紧跟思考类动词短语（中间只允许「再/来/一起/先」这类虚词），
  // 所以「大家好」「大家上午好」不会被误判成邀请式问句。
  if (
    /(大家|同学们)[，,]?\s*(再|来|一起|先)?\s*(想一想|想想|说说看|说说|说一说|讲一讲|讲讲|猜一猜|猜猜|回答一下|回答|谈谈)/.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * 问句判定（严格版）：这句话是不是真的在向学生提问。
 * 判定要准：宁可漏判，也不能把普通陈述判成问句（等待指标会据此逐条出数）。
 *
 * 三层判定：
 *   ① 问号类标点（最强证据）
 *   ② 疑问结构（疑问词不必在句首；名词用法与高误判词已排除）
 *   ③ 邀请 / 应答式（你来说说 / 谁来 / 请…回答 / 大家想一想）
 *
 * 防误判两条硬规则（上一批踩过的坑）：
 *   · 句末语气词「吗/呢/呗」**不能单独**作为问句证据 ——
 *     「今天我们先看看勾股定理呢。」只有语气词、没有疑问结构 → 不是问句；
 *   · 「大家」必须紧跟思考类动词才算邀请式（「大家好」不算）；
 *     「如何」当名词用（学习如何…）、「几个」（分为几个步骤）不算疑问结构。
 */
function isQuestionSentence(sentence) {
  const t = String(sentence || '').trim();
  if (!t) return false;

  // ① 问号类标点（最强证据）
  if (/[?？]/.test(t)) return true;

  // ② 疑问结构（疑问词不必在句首）
  if (hasInterrogativeStructure(t)) return true;

  // ③ 邀请 / 应答式问句
  if (hasInvitationStructure(t)) return true;

  // ④ 句末语气词（吗/呢/呗）不单独作为证据：
  //    上面的结构证据不成立时，这句话就不是在提问。
  return false;
}

/**
 * 互动任务判定：这句话是不是在组织学生互动。
 * 问句天然属于互动（学生要回应），互动任务还包括讨论/练习/板演/齐读等。
 * 「请同桌讨论这道题。」→ 互动任务，不是问句。
 */
function isInteractiveSentence(sentence) {
  const t = String(sentence || '').trim();
  if (!t) return false;
  if (isQuestionSentence(t)) return true;
  return /(?:讨论|互讲|同桌交流|小组交流|练习|做一做|算一算|板演|上台|齐读|朗读|请.{0,8}(?:回答|说说|演示|计算)|试着.{0,8}(?:说|写|算|做))/.test(
    t
  );
}

/** 截断引文：超长时尽量保住句末标点（问号是问句的关键证据） */
function clipQuote(text, max) {
  const str = String(text || '').trim();
  if (str.length <= max) return str;
  const tail = str[str.length - 1];
  if (/[。！？；!?;]/.test(tail)) return str.slice(0, max - 1) + tail;
  return str.slice(0, max) + '…';
}

/** 等待秒数 → 文字反应（措辞统一带「文本推断」前缀，避免被读成实测） */
function reactionFor(wait) {
  if (wait >= 2) return '文本推断：可能留有思考时间';
  if (wait >= 1) return '文本推断：等待偏短，只有少数人能跟上';
  return '文本推断：可能很快进入下一句';
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 汇总等待指标。
 * @param {Array} moments 逐条等待记录
 * @param {string} source  来源标记（text-heuristic / model-inference / timestamp）
 * @param {string} note    口径说明
 * @returns {{moments: Array, average_sec: number|null, source: string, note: string}}
 *          average_sec 只对「有限数值」求平均；没有有效值时必须是 null（不是 0）。
 *          注意：average_sec 是「逐条推断值的算术平均」，不是实测平均等待 ——
 *          各条推断值来自不同规则分支，取平均没有物理意义，只能当趋势参考。
 */
function summarizeWaitMoments(moments, source, note) {
  const list = Array.isArray(moments) ? moments : [];
  const src = source || SOURCE_TEXT;

  const normalized = list.map((m) => {
    const item = m && typeof m === 'object' ? m : {};
    const n = toFiniteNumber(item.wait_sec);
    return Object.assign({}, item, {
      // 每条都必须自曝来源
      source: item.source || src,
      wait_sec: Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null,
    });
  });

  const nums = normalized
    .map((m) => m.wait_sec)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));

  const average = nums.length
    ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1))
    : null;

  return {
    moments: normalized,
    average_sec: average,
    source: src,
    note: note || NOTE_TEXT,
  };
}

/* ------------------------------------------------------------------ */
/* 规则推断（文本启发式）                                                 */
/* ------------------------------------------------------------------ */

/* 下一句里的「真等待信号」。
   这里**不能**用单字「等」：数学/理化生讲稿里「a 平方加 b 平方等于 c 平方」几乎每段都有，
   单字匹配会让几乎每条问句都被判成 3 秒（"有留白"），把「点名留白 2.5 秒」完全遮蔽，
   等待值会系统性偏高 —— 与「文本推断应有的谨慎」相悖。
   所以「等」必须带上下文：等一等 / 等一下 / 等会 / 稍等 / 等同学 / 等大家 / 等回答 …
   而「等于」「不等」「等于号」「等于式」这些数学词不会命中。 */
const WAIT_SIGNAL_RE =
  /等一等|等一下|等会|等下|稍等|稍候|等着|等同学|等大家|等回答|等你们|等他们|等待|想一想|思考|停顿|沉默|别急|慢慢来|先想想/;

/**
 * 按下一句的上下文推断等待秒数（纯文本推断，不是实测）。
 * 规则优先级：下一句等待信号(3) > 点名留白(2.5) > 确认式(0.5) > 默认(0.8)
 */
function estimateWaitSec(sentence, nextSentence) {
  const s = String(sentence || '');
  const next = String(nextSentence || '');
  if (WAIT_SIGNAL_RE.test(next)) return 3;
  if (
    /[张王李刘陈杨赵黄周吴徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董潘袁蔡蒋余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤][同学生]/.test(
      s
    )
  ) {
    return 2.5;
  }
  if (/明白|理解|听懂|对吧|是吧|会不会|是不是/.test(s)) return 0.5;
  return 0.8;
}

/**
 * 规则版等待指标：找出讲稿里的问句，逐条给出「推断的」等待秒数。
 * @param {string} transcript 逐字稿
 * @returns {{moments: Array, average_sec: number|null, source: string, note: string}}
 */
function buildTextWaitMetrics(transcript) {
  const sents = splitSentencesKeepPunct(transcript);
  const moments = [];

  for (let i = 0; i < sents.length && moments.length < MAX_MOMENTS; i++) {
    const s = sents[i];
    if (!isQuestionSentence(s)) continue;
    const wait = estimateWaitSec(s, sents[i + 1] || '');
    moments.push({
      quote: clipQuote(s, 34),
      wait_sec: wait,
      source: SOURCE_TEXT,
      reaction: reactionFor(wait),
    });
  }

  // 没有提问 → moments 为空数组、average_sec 为 null（不造伪条目）
  return summarizeWaitMoments(moments, SOURCE_TEXT, NOTE_TEXT);
}

/* ------------------------------------------------------------------ */
/* 模型返回规整                                                           */
/* ------------------------------------------------------------------ */

/**
 * 规整大模型返回的逐次等待记录。
 * 缺 wait_sec → null（绝不用默认值伪造「等了 1 秒」）；数值夹在 0–10。
 * @param {Array} list 模型返回的数组
 * @returns {{moments: Array, average_sec: number|null, source: string, note: string}}
 */
function normalizeModelWaitMoments(list) {
  const arr = Array.isArray(list) ? list : [];
  const moments = arr.slice(0, MAX_MOMENTS).map((m) => {
    const item = m && typeof m === 'object' ? m : {};
    const n = toFiniteNumber(item.wait_sec);
    return {
      quote: clipQuote(item.quote, 40) || '（未识别）',
      // 缺值 → null；给了值但超出 [0,10] → 夹到边界
      wait_sec: Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null,
      source: SOURCE_MODEL,
      reaction: String(item.reaction || '').slice(0, 40),
    };
  });
  return summarizeWaitMoments(moments, SOURCE_MODEL, NOTE_MODEL);
}

module.exports = {
  buildTextWaitMetrics,
  normalizeModelWaitMoments,
  summarizeWaitMoments,
  // 以下为内部辅助，导出便于回归测试锁定口径
  isQuestionSentence,
  isInteractiveSentence,
  splitSentencesKeepPunct,
  SOURCE_TEXT,
  SOURCE_MODEL,
  SOURCE_TIMESTAMP,
};
