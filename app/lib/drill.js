'use strict';

/**
 * 3 分钟专项技能练习（规格 E/B 项）
 * ------------------------------------------------------------------
 * 五项技能的定义在本文件是唯一真源（前端通过 GET /api/drill/skills 拿同一份）。
 *
 * 铁律：
 *   1. 规则兜底必须是真实计算：所有分数都来自 analyzeRule() 的真实统计，
 *      绝不造数据；响应里 engine 标 'rule'，前端据此显示「本地规则判定」。
 *   2. evidence[].quote 必须是讲稿原文的**原样子串**，产出前用 indexOf 校验，
 *      校验不过就丢掉这条。
 *   3. 不重造语速/口头禅/提问统计器 —— 一律复用 lib/analyzer.js 的 analyzeRule。
 */

const { analyzeRule } = require('./analyzer');
const { deriveLevelParams, PROFILE_LABELS } = require('./profile');
/* 问句判定统一走 wait-metrics.js（唯一事实来源）。
   本文件原先有一个同名但口径更松的本地实现（把「吗/呢」结尾的陈述句也当问句），
   同名不同义是维护陷阱，已删除，改用共享实现。
   切句也用同一套（splitSentencesKeepPunct）—— 判定依赖问号，切句必须保留标点。 */
const { isQuestionSentence, splitSentencesKeepPunct } = require('./wait-metrics');

/* ---------------- 五项技能定义（规格 §2.7 / §3.4） ---------------- */
const SKILLS = [
  {
    key: 'question_wait',
    label: '提问与等待',
    focus: '把封闭式提问换成真提问，并真的留白',
    brief:
      '用 3 分钟讲一小段内容：至少设计 2 个需要学生思考的开放提问，每个问题问完后留出等待（可用「（停顿）」「默数三秒」标注），最后说明学生可能的回答与追问方向。',
    checklist: [
      '有 2 个以上需要思考的开放提问',
      '每个提问后标注了等待',
      '没有「听懂了吗」这类假提问',
      '给出了学生可能的回应',
      '留白位置与提问位置匹配',
    ],
    starter: '同学们，昨天我们学过一个结论。今天我想先问大家一个问题：如果把这个条件换掉，还成立吗？',
  },
  {
    key: 'pace_filler',
    label: '语速与口头禅',
    focus: '控速、去掉口头禅',
    brief:
      '用 3 分钟讲清一个知识点：目标语速 120–150 字/分，把「那个」「然后」「就是」这类口头禅清掉，关键结论处留短停顿。',
    checklist: [
      '语速落在 120–150 字/分',
      '口头禅少于 8 处',
      '结论处有短停顿',
      '一句话只带一个信息点',
      '没有连续重复的铺垫',
    ],
    starter: '这个结论其实只有一句话要记：先看条件，再看结论。条件变了，结论就要重新推一遍。',
  },
  {
    key: 'board_structure',
    label: '板书结构',
    focus: '让板书承担结构：课题→推导→结论',
    brief:
      '用 3 分钟讲一段推导，并在讲稿里说清板书怎么写：课题写在哪、推导主线分几步、结论落在哪，主板书全程不擦。',
    checklist: [
      '板书有明确分区',
      '写出课题与主线步骤',
      '推导过程留在板上',
      '结论单独占位置',
      '说明哪些内容不擦',
    ],
    starter: '板书分两块：左边主板书写推导主线，右边副板书写例题演算，课题写在正上方。',
  },
  {
    key: 'intro_design',
    label: '导入设计',
    focus: '用情境/冲突/复习衔接开场，再自然进入新课（按语义切分导入段）',
    brief:
      '用 3 分钟设计并讲解一个导入：从生活情境、旧知复习或一个反常现象切入，导入段落不超过整段讲稿的 15%。',
    checklist: [
      '导入有具体情境或冲突',
      '与旧知或生活经验相连',
      '导入含一个真实问题',
      '导入长度不超过 15%',
      '导入后自然进入新课',
    ],
    starter: '上周有同学问我：一个数到底能开多少次平方才算完？今天我们用这个例子来回答。',
  },
  {
    key: 'transition',
    label: '过渡衔接',
    focus: '环节之间有过渡句，小结收口',
    brief:
      '用 3 分钟串起三个教学环节：每个环节之间有过渡句，最后用小结收口并布置作业，让环节之间不跳。',
    checklist: [
      '环节之间有过渡句',
      '过渡句指向明确',
      '覆盖了推导、例题、互动',
      '末尾有小结',
      '有作业或下课收口',
    ],
    starter: '接下来我们把这个结论用到一道例题上；例题讲完，我会用两句话把今天的内容收回来。',
  },
];

const SKILL_MAP = SKILLS.reduce((m, s) => {
  m[s.key] = s;
  return m;
}, {});

/* ------------------------------------------------------------------
 * 规范维度 key 集（唯一真源）
 * ------------------------------------------------------------------
 * 为什么需要：规则兜底与 LLM 分析原本各用各的 key 命名
 * （规则：density/wait/marker；模型：question_design/wait_time/…），
 * 同一个技能在两条路径下产出的 dimensions[].key 无法对齐，
 * 「按技能聚合历史练习」会拿到脏数据。
 *
 * 约定：
 *   - key 一律 snake_case，且**跨两条路径必须一致**；
 *   - key 固定后不再改（历史记录里已落库的 key 依赖它）；
 *   - label / score / weight / evidence / fix 的语义一律不动（前端按 label 渲染）。
 *
 * 字段说明：
 *   internal  —— 规则组件内部标识（drillRule 内部沿用，不对外暴露）
 *   aliases   —— LLM 可能返回的等价 key（含中英文），精确命中即映射
 *   keywords  —— 按 label 关键词兜底匹配用（同一技能内各维度的关键词互不重叠）
 * ------------------------------------------------------------------ */
const CANONICAL_DIMENSIONS = {
  question_wait: [
    {
      key: 'question_design', internal: 'density', label: '有效提问密度',
      aliases: ['question_design', 'question_density', 'density', 'question_quality', 'design', '提问密度', '问题设计', '有效提问密度'],
      keywords: ['密度', '设计', '问题质量', '有效提问'],
    },
    {
      key: 'wait_time', internal: 'wait', label: '提问后留白',
      aliases: ['wait_time', 'waiting_time', 'wait', 'avg_wait', 'avg_wait_sec', 'pause_duration', '留白时长', '等待时长'],
      keywords: ['留白', '候答', '等待时长', '等待时间', '停顿时长'],
    },
    {
      key: 'wait_marker', internal: 'marker', label: '等待标记',
      aliases: ['wait_marker', 'wait_mark', 'marker', 'pause_marker', '等待标记'],
      keywords: ['等待标记', '停顿标记', '留白标记'],
    },
    {
      key: 'fake_question', internal: 'fake', label: '假提问扣分',
      aliases: ['fake_question', 'fake', 'fake_questions', 'closed_question', 'pseudo_question', '假提问', '伪提问'],
      keywords: ['假提问', '伪提问', '封闭式', '无效提问'],
    },
  ],
  pace_filler: [
    {
      key: 'speech_rate', internal: 'pace', label: '语速',
      aliases: ['speech_rate', 'pace', 'speed', 'rate', 'chars_per_min', '语速', '节奏'],
      keywords: ['语速', '字/分', '语速节奏'],
    },
    {
      key: 'filler_count', internal: 'filler', label: '口头禅数量',
      aliases: ['filler_count', 'filler_number', 'filler_total', 'count', 'filler_words', '口头禅数量', '数量'],
      keywords: ['口头禅数量', '次数', '个数'],
    },
    {
      key: 'filler_density', internal: 'density', label: '口头禅密度',
      aliases: ['filler_density', 'density', 'per_100', 'filler_freq', 'filler_frequency', '口头禅密度', '密度'],
      keywords: ['口头禅密度', '每百字', '频次'],
    },
  ],
  board_structure: [
    {
      key: 'board_signal', internal: 'board', label: '板书承担设计',
      aliases: ['board_signal', 'board', 'board_design', 'board_statement', 'blackboard', '板书'],
      keywords: ['板书承担', '板书设计', '板书安排', '板书陈述'],
    },
    {
      key: 'structure_marker', internal: 'structure', label: '板书结构标记',
      aliases: ['structure_marker', 'structure', 'outline', 'structure_signal', '结构标记'],
      keywords: ['结构标记', '结构主线', '主线'],
    },
    {
      key: 'coverage', internal: 'cover', label: '环节覆盖',
      aliases: ['coverage', 'cover', 'coverage_percent', 'knowledge_coverage', '环节覆盖', '知识点覆盖'],
      keywords: ['环节覆盖', '覆盖度', '知识点覆盖'],
    },
    {
      key: 'missing_knowledge', internal: 'missing', label: '缺失环节扣分',
      aliases: ['missing_knowledge', 'missing_coverage', 'missing', 'missing_points', 'gaps', '缺失环节', '未覆盖'],
      keywords: ['缺失', '未覆盖', '缺环节'],
    },
  ],
  intro_design: [
    {
      key: 'intro_signal', internal: 'signal', label: '导入信号',
      aliases: ['intro_signal', 'signal', 'context_signal', '导入信号', '情境'],
      keywords: ['导入信号', '情境信号', '信号'],
    },
    {
      key: 'intro_hook', internal: 'ask', label: '导入提问',
      aliases: ['intro_hook', 'hook', 'question', 'intro_question', '导入提问', '设问'],
      keywords: ['导入提问', '提问', '钩子', '发问'],
    },
    {
      key: 'intro_length', internal: 'length', label: '导入长度',
      aliases: ['intro_length', 'length', 'intro_len', 'length_control', '导入长度', '篇幅'],
      keywords: ['导入长度', '长度', '字数'],
    },
    {
      key: 'concrete_example', internal: 'concrete', label: '情境具体度',
      aliases: ['concrete_example', 'intro_concrete', 'concrete', 'concreteness', 'specificity', '具体度', '具体情境', '具体例子'],
      keywords: ['具体', '具体度', '名词'],
    },
  ],
  transition: [
    {
      key: 'transition_marker', internal: 'transition', label: '过渡句',
      aliases: ['transition_marker', 'transition', 'transitions', 'bridge', '过渡句', '过渡词'],
      keywords: ['过渡', '衔接'],
    },
    {
      key: 'coverage', internal: 'cover', label: '环节覆盖',
      aliases: ['coverage', 'cover', 'coverage_percent', 'knowledge_coverage', '环节覆盖', '知识点覆盖'],
      keywords: ['环节覆盖', '覆盖度', '知识点覆盖'],
    },
    {
      key: 'coverage_penalty', internal: 'cover_penalty', label: '覆盖不足扣分',
      aliases: ['coverage_penalty', 'penalty', 'insufficient_coverage', 'coverage_gap', '覆盖不足'],
      keywords: ['覆盖不足', '环节缺失', '不足'],
    },
    {
      key: 'closing', internal: 'close', label: '收口',
      aliases: ['closing', 'summary', 'conclusion', 'ending', '收口', '小结'],
      keywords: ['收口', '小结', '总结', '作业', '结尾'],
    },
  ],
};

/* 某技能的规范 key 列表（对外只读） */
function canonicalKeys(skill) {
  const list = CANONICAL_DIMENSIONS[skill] || [];
  return list.map((d) => d.key);
}

/* 规则组件内部标识 → 规范 key */
function canonicalKeyFor(skill, internalKey) {
  const list = CANONICAL_DIMENSIONS[skill] || [];
  const hit = list.find((d) => d.internal === internalKey);
  return hit ? hit.key : null;
}

/**
 * 把模型返回的维度 key 映射到规范 key
 * 优先级：规范 key 精确命中 → aliases 精确命中 → label 关键词兜底
 * @returns {string|null} 规范 key；实在匹配不上返回 null（调用方保留模型原 key）
 */
function mapToCanonicalKey(skill, modelKey, modelLabel) {
  const list = CANONICAL_DIMENSIONS[skill] || [];
  if (!list.length) return null;
  const rawKey = String(modelKey == null ? '' : modelKey).trim();
  const label = String(modelLabel == null ? '' : modelLabel).trim();

  // 1. 规范 key 精确命中
  const norm = rawKey.toLowerCase();
  const exact = list.find((d) => d.key.toLowerCase() === norm);
  if (exact) return exact.key;

  // 2. aliases 精确命中
  const alias = list.find((d) => d.aliases.some((a) => String(a).toLowerCase() === norm));
  if (alias) return alias.key;

  // 3. label 关键词兜底：取关键词命中数最多者，同分取规范顺序靠前者
  const text = (rawKey + ' ' + label).toLowerCase();
  let best = null;
  let bestHits = 0;
  list.forEach((d) => {
    const hits = d.keywords.filter((k) => text.indexOf(String(k).toLowerCase()) !== -1).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = d;
    }
  });
  return best ? best.key : null;
}

/* ---------------- 统计口径（全部来自 analyzer.analyzeRule） ---------------- */

/* 等待标记：提问后是否真的留白（文本启发式，非音频实测） */
const WAIT_MARKERS = ['(停顿)', '（停顿）', '…', '默数', '等3秒', '等 3 秒', '大家想想', '想一想', '静默', '留白'];
/* 板书标记 */
const BOARD_MARKERS = ['板书', '写下来', '黑板', '大屏', 'PPT', '投影'];
/* 板书结构标记 */
const STRUCT_MARKERS = ['课题', '第一步', '第二步', '第三步', '第二', '第三', '结论', '所以', '因此'];
/* 导入信号 */
const INTRO_MARKERS = ['情境', '冲突', '问题', '复习', '上节课', '还记得', '猜一猜', '上周', '同学们'];
/* 新课开始信号：命中即视为「已进入新授」，该句不被计入导入段（语义切分断点） */
const INTRO_END_MARKERS = [
  '进入新课', '新课', '我们今天要学', '今天我们学习', '今天我们来学习', '今天我们来讲',
  '这就是我们今天', '正式开始', '下面我们一起来', '接下来我们一起来',
  '下面我们来', '接下来我们来', '现在我们来学习', '本节课我们',
  '我们要学习', '我们来研究', '我们要研究', '请大家看课本', '翻开课本',
  '看课本第', '出示课题', '这节课我们', '一起来学习',
];
/* 具体情境名词（数字/图形/生活场景） */
const CONCRETE_MARKERS = ['米', '厘米', '厘米的', '三角形', '圆', '正方形', '汽车', '自行车', '球', '水', '书', '苹果', '楼房', '温度', '角度'];

/**
 * 语义切分「导入段」：沿句子边界找到「导入 → 新授」的语义断点，取代原先「盲切前 15% 字数」。
 * 规则（断点优先，字数只当安全网）：
 *   · 从开头逐句累加，遇到第一句含「新课开始」信号就停止（该句归入新授，不计入导入）；
 *   · 全文**存在**断点时，一律以断点为准，不再加字数上限：上限会按全文比例算，
 *     短讲稿里它比导入本身还短，会把「猜一猜 / 为什么」这类关键提问整段砍掉（已踩过）；
 *     此时只保留 40 句的病理上界。
 *   · 全文**不存在**断点时退回保守上界：前 8 句且不超过 35% 字数，避免整篇被算成导入。
 * 返回值额外带 `ratio`（导入段占全文比例），供打分侧判断「导入是否超长」时使用，
 * 本函数只负责切段，不负责判分。
 * @param {string} transcript
 * @returns {{text:string, sentences:string[], ratio:number}}
 */
function extractIntroSegment(transcript) {
  const sentences = splitSentencesKeepPunct(transcript);
  const bodyLen = String(transcript || '').replace(/\s/g, '').length;

  // 断点是否存在，决定了「字数上界」该不该收紧：
  // 有断点 → 断点就是真正的终点；无断点 → 只能用保守上界兜住。
  const hasBreak = sentences.some((sent) =>
    INTRO_END_MARKERS.some((m) => sent.indexOf(m) !== -1)
  );
  const maxChars = hasBreak ? Infinity : Math.max(1, Math.round(bodyLen * 0.35));
  const maxSent = Math.min(sentences.length, hasBreak ? 40 : 8);

  const picked = [];
  let chars = 0;
  for (let i = 0; i < maxSent; i++) {
    const sent = sentences[i];
    // 命中「新课开始」信号 → 导入段到此为止，这句不算导入（i=0 命中即表示「直接开讲」，导入段为空）
    if (INTRO_END_MARKERS.some((m) => sent.indexOf(m) !== -1)) break;
    const len = sent.replace(/\s/g, '').length;
    // 字数上界只约束「后续句子」，首句永远纳入（否则一个长开场白会被整句砍掉导致导入段为空）
    if (i > 0 && chars + len > maxChars) break;
    picked.push(sent);
    chars += len;
  }
  return { text: picked.join(''), sentences: picked, ratio: bodyLen ? chars / bodyLen : 0 };
}
/* 过渡词 */
const TRANSITION_MARKERS = ['接下来', '下面', '回到', '再看', '因此', '所以', '小结', '总结', '最后'];
/* 收口词 */
const CLOSE_MARKERS = ['小结', '总结', '作业', '下课'];

/* 封闭式提问的固定短语（识别「确认式提问」用）。
   与 isQuestionSentence 的分工（别再把两者混用）：
     · isQuestionSentence —— 判断「这句是不是在向学生提问」（问句判定），
       唯一事实来源在 wait-metrics.js，问号/疑问结构/邀请式都归它管；
     · FAKE_PHRASES —— 判断「这句是不是封闭式的确认句」（懂了吗/对不对/行不行…），
       它是问句的一个**子集**，不是问句判定。
   为什么不能把 FAKE_PHRASES 换成 isQuestionSentence：
   那样会把每一个真问句都当成伪提问扣分，方向完全反了。
   句级「需要思考的提问」= 句级问句数 − 句级封闭式提问数，
   其中「句级封闭式提问数」只统计「既是句级问句、又含这些短语」的句子。 */
const FAKE_PHRASES = [
  '听懂了吗',
  '理解了吗',
  '明白了吗',
  '对不对',
  '好不好',
  '行不行',
  '跟上没有',
  '算不算',
  '是不是啊',
];

function countOccur(text, needle) {
  if (!needle) return 0;
  let c = 0;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    c += 1;
    i += needle.length;
  }
  return c;
}

function countMarkers(text, markers) {
  let c = 0;
  markers.forEach((m) => {
    c += countOccur(text, m);
  });
  return c;
}

/* 切句：按 。！？；\n 切，保留原文片段（片段一定是原文子串，可直接当 evidence）。
   注意：**这个版本不丢标点**（句末的 。！？ 会跟着片段走），与 heatmap.js 那个
   「丢标点的旧 splitSentences」不是一回事 —— 问号还在，判定不会失效。
   本函数只用于 evidence 引文（s.sentences：板书句/过渡句/收口句/封闭式提问句）；
   **问句判定一律走 wait-metrics.js 的 splitSentencesKeepPunct**（与判定同源），
   不要用本函数去数提问。 */
function splitSentences(text) {
  const src = String(text || '');
  const out = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    buf += ch;
    if ('。！？；\n'.indexOf(ch) !== -1) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * 提问密度的展示文案（保真版，维度文案与建议文案共用同一套规则）。
 * 硬规则：**非零密度绝不允许显示成 0** ——
 *   「每分钟 0 个需要思考的提问」会被读成「一个需要思考的提问都没有」，
 *   而实际可能有 1 个（只是摊到每分钟不足 1 个）。
 * 三档：
 *   density >= 1   → 每分钟 1.2 个需要思考的提问
 *   0 < density < 1 → 约每 3 分钟 1 个需要思考的提问（M = 1/density，向上不夸大）
 *   density === 0  → 每分钟 0 个需要思考的提问（真的一个都没有才这么写）
 * @param {number} density 每分钟「需要思考的提问」数
 * @returns {string} 可直接嵌进句子的短语
 */
function formatDensityPhrase(density) {
  const n = Number(density);
  if (!Number.isFinite(n) || n <= 0) return '每分钟 0 个需要思考的提问';
  if (n >= 1) return `每分钟 ${n.toFixed(1)} 个需要思考的提问`;
  // 0 < n < 1：改用间隔表述，既不显示 0，也不假装有精确小数
  const m = 1 / n;
  const text = m >= 10 ? String(Math.round(m)) : String(Number(m.toFixed(1)));
  return `约每 ${text} 分钟 1 个需要思考的提问`;
}

/* ---------------- 等待证据（文本判定，不测秒数） ---------------- */

/* 提问句判定：直接用 wait-metrics.js 的共享实现（问号 / 疑问结构 / 邀请式）。
   不要再在本文件另写一份 —— 同名不同义会让人误以为改了一处就改了两处。
   配套切句也用同一套 splitSentencesKeepPunct：判定依赖问号，切句丢了标点就会失效。 */

/* 讲稿里是否写了等待（停顿 / 想一想 / 默数…） */
function hasWaitMarker(s) {
  return WAIT_MARKERS.some((m) => String(s).indexOf(m) !== -1);
}

/**
 * 句级提问数：数「有多少句是提问」。
 * 为什么不用 analyzer 的 questions.asked（问号个数）：
 *   问号计数是对外口径（questions.asked 已被接口/前端契约依赖，不能改），
 *   但它数的是标点、不是问句 ——「李同学，你说说这一步为什么这样设。」没有问号，
 *   却是明确的提问。用问号计数当分母，会把「明明有提问」误报成「整段未检测到提问」。
 * 所以等待维度的分子（等待标记数）与分母（提问数）必须同源：同一套切句 + 同一套问句判定。
 */
function countQuestionSentences(text) {
  return splitSentencesKeepPunct(text).filter((s) => isQuestionSentence(s)).length;
}

/**
 * 句级「封闭式提问」数：既是句级问句、又含封闭式短语的那些句子。
 * 只统计问句 —— 不是问句的句子不进分母，也不该被减掉。
 */
function countClosedQuestions(text) {
  return splitSentencesKeepPunct(text).filter(
    (s) => isQuestionSentence(s) && FAKE_PHRASES.some((f) => s.indexOf(f) !== -1)
  ).length;
}

/* 提问后是否真的留白：只认文本里的等待标记。
   没有音频时间戳，真实等待秒数不可测量，这里只判断「有没有设计留白」。
   切句与提问计数同源（splitSentencesKeepPunct），保证分子 ≤ 分母。 */
function countWaitAfterQuestions(text) {
  const sents = splitSentencesKeepPunct(text);
  let count = 0;
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    if (!isQuestionSentence(s)) continue;
    const next = sents[i + 1] || '';
    // 等待标记写在问句本身里，或紧跟在问句后的下一句，都算这一处留了白
    if (hasWaitMarker(s) || hasWaitMarker(next)) count += 1;
  }
  return count;
}

/* ---------------- 通用统计（复用 analyzer，口径完全一致） ---------------- */
function buildStat(input) {
  const transcript = String(input.transcript || '').trim();
  const durationSec = clamp(Math.round(Number(input.durationSec) || 180), 1, 600);
  // analyzeRule 需要至少 5 个字；调用方已保证 ≥30，这里只是兜底
  const stat = analyzeRule({
    transcript,
    subject: input.subject || '本节课',
    grade: input.grade || '',
    durationSec,
  });
  const waitAfterQuestions = countWaitAfterQuestions(transcript);
  // 句级提问数：与上面的等待标记数同源（同切句 + 同问句判定），
  // 用作等待维度的分母；analyzer 的 questions.asked（问号计数）是对外口径，原样保留。
  const questionCount = countQuestionSentences(transcript);
  // 句级「需要思考的提问」= 句级问句数 − 句级封闭式提问数
  const closedCount = countClosedQuestions(transcript);
  const thinkingCount = Math.max(0, questionCount - closedCount);
  return {
    transcript,
    durationSec,
    stat,
    sentences: splitSentences(transcript),
    chars: (stat.stats && stat.stats.chars) || 0,
    rate: stat.speech_rate.chars_per_min,
    fillerTotal: stat.filler_words.total,
    fillerDetail: stat.filler_words.detail || {},
    // analyzer 对外口径：全文问号个数（questions.asked 是接口契约，不能改）
    asked: stat.questions.asked,
    // 句级问句数：等待维度的分母（与等待标记数同源）
    questionCount,
    // 句级封闭式提问数 / 句级「需要思考的提问」数：提问密度维度的分子
    closedCount,
    thinkingCount,
    genuine: stat.questions.genuine_questions,
    fake: stat.questions.fake_questions,
    // 等待时长不可测量（没有音频时间戳）：avg_wait_sec 恒为 null，
    // 等待维度改用文本证据（提问后是否写了等待标记）判定。
    avgWait: null,
    waitAfterQuestions,
    waitCoverage: questionCount > 0 ? waitAfterQuestions / questionCount : 0,
    coverPercent: stat.knowledge.cover_percent,
    covered: stat.knowledge.covered || [],
    missing: stat.knowledge.missing || [],
    pauseCount: stat.pauses.count_gt_2s,
    waitMarkers: countMarkers(transcript, WAIT_MARKERS),
  };
}

/* ---------------- 各技能的规则评分（规格 §5.2） ---------------- */

/* 每个技能返回 { components:[{key,label,max,points,evidenceText,fix}], raw } */

function scoreQuestionWait(s, profile) {
  const minutes = s.durationSec / 60;
  // 提问密度与 wait_time 必须同源：都用句级问句判定数出来的数字。
  // （原来这里用 s.genuine —— analyzer 的问号计数口径，于是同一张卡片里
  //   「每分钟 0.00 个需要思考的提问」和「共 1 个提问」自相矛盾。）
  const density = s.thinkingCount / minutes; // 句级「需要思考的提问」÷ 分钟数
  // 学情口径：弱档班对「有效提问密度」的达标线放宽（0.6/min），优秀档不放宽
  const lv = profile && profile.class ? profile.class.level : 'good';
  const densityTarget = lv === 'weak' || lv === 'basic' ? 0.6 : 1;

  // ① 有效提问密度：≥1.0/min 得 40；0.3–1.0 得 25–39；<0.3 得 ≤24
  let densityPoints;
  if (density >= densityTarget) densityPoints = 40;
  else if (density >= 0.3) densityPoints = 25 + ((density - 0.3) / (densityTarget - 0.3)) * 15;
  else densityPoints = Math.max(0, ((density / 0.3) * 25) - 1);
  densityPoints = clamp(Math.round(densityPoints), 0, 40);

  // ③ 等待时长：没有音频时间戳 → 真实等待秒数不可测量，
  //    改用文本证据判定：提问后写了等待标记（停顿 / 想一想 / 默数…）的比例。
  //    分母用句级提问数（questionCount），与分子同源；
  //    不用 analyzer 的问号计数（asked）—— 那个数的是标点不是问句，
  //    会出现「等待 2 处 / 共 1 个提问」这种分子分母打架，或把有提问误报成「整段未检测到提问」。
  //    ≥80% 的提问留了白得 30 分；50%–80% 得 15–29；低于 50% 得 ≤15。
  const questionCount = s.questionCount; // 句级问句数（同源分母）
  const waitEvidence = s.waitAfterQuestions;
  const waitCoverage = questionCount > 0 ? waitEvidence / questionCount : 0;
  let waitPoints;
  if (questionCount === 0) waitPoints = 0;
  else if (waitCoverage >= 0.8) waitPoints = 30;
  else if (waitCoverage >= 0.5) waitPoints = 15 + ((waitCoverage - 0.5) / 0.3) * 15;
  else waitPoints = clamp(Math.round(waitCoverage * 30), 0, 15);

  // ④ 等待标记：每处 +5，上限 +15
  const markerPoints = clamp(s.waitMarkers * 5, 0, 15);

  // ② 伪提问：每处 −6，上限 −20
  const fakePenalty = -Math.min(20, s.fake * 6);

  const components = [
    {
      key: 'density',
      label: '有效提问密度',
      max: 40,
      points: densityPoints,
      evidenceText: `${formatDensityPhrase(density)}（句级问句判定）`,
      fix: '每分钟至少设计 1 个开放提问，问完留 3 秒',
    },
    {
      key: 'wait',
      label: '提问后留白',
      max: 30,
      points: waitPoints,
      evidenceText:
        questionCount > 0
          ? `提问后写了等待 ${waitEvidence} 处 / 共 ${questionCount} 个提问（句级问句判定，文本证据，非实测秒数）`
          : '整段未检测到提问，无等待证据',
      fix: '问完在心里默数三下，再开口讲',
    },
    {
      key: 'marker',
      label: '等待标记',
      max: 15,
      points: markerPoints,
      evidenceText: `讲稿里标出等待 ${s.waitMarkers} 处`,
      fix: '在提问后写上「（停顿）」，逼自己真的等',
    },
    {
      key: 'fake',
      label: '假提问扣分',
      max: 0,
      points: fakePenalty,
      evidenceText: s.fake > 0 ? `检测到 ${s.fake} 处封闭式提问` : '未检测到封闭式提问',
      fix: '把「听懂了吗」改成点名 + 「说说你的理由」',
    },
  ];
  return { components, max: 85 };
}

function scorePaceFiller(s) {
  // ① 语速：120–150 得 50；偏离每 10 字/分 −3（上限 −35）；>175 或 <100 封顶 55
  let pacePoints;
  if (s.rate >= 120 && s.rate <= 150) pacePoints = 50;
  else {
    const dev = s.rate < 120 ? 120 - s.rate : s.rate - 150;
    pacePoints = 50 - Math.min(35, Math.floor(dev / 10) * 3);
  }
  const paceScore = clamp(Math.round(pacePoints), 0, 50);

  // ② 口头禅：每 2 处 −5（上限 −30）
  const fillerPenalty = Math.min(30, Math.floor(s.fillerTotal / 2) * 5);
  const fillerPoints = clamp(30 - fillerPenalty, 0, 30);

  // ③ 口头禅密度：> 4 处/百字 再 −10
  const per100 = s.chars > 0 ? s.fillerTotal / (s.chars / 100) : 0;
  const densityPoints = per100 > 4 ? 10 : 20;

  const components = [
    {
      key: 'pace',
      label: '语速',
      max: 50,
      points: paceScore,
      evidenceText: `当前 ${s.rate} 字/分（适中区间 120–150）`,
      fix: '关键结论后停 0.5 秒，把语速压回 140 字/分上下',
    },
    {
      key: 'filler',
      label: '口头禅数量',
      max: 30,
      points: fillerPoints,
      evidenceText: `全文口头禅 ${s.fillerTotal} 处`,
      fix: '录音回听，每听到一个口头禅就在稿上划一道',
    },
    {
      key: 'density',
      label: '口头禅密度',
      max: 20,
      points: densityPoints,
      evidenceText: `每百字约 ${per100.toFixed(1)} 处口头禅`,
      fix: '把「那个」「然后」换成 1 秒停顿',
    },
  ];
  return { components, max: 100 };
}

function scoreBoardStructure(s) {
  // ① 板书陈述句数：≥3 得 30；1–2 得 15–29；0 得 0
  const boardSentences = s.sentences.filter((x) => BOARD_MARKERS.some((m) => x.indexOf(m) !== -1));
  let boardPoints;
  if (boardSentences.length >= 3) boardPoints = 30;
  else if (boardSentences.length >= 1) boardPoints = 15 + (boardSentences.length - 1) * 14;
  else boardPoints = 0;

  // ② 结构标记：≥3 个不同标记得 30；1–2 得 12–29；0 得 0
  const structHit = STRUCT_MARKERS.filter((m) => s.transcript.indexOf(m) !== -1);
  let structPoints;
  if (structHit.length >= 3) structPoints = 30;
  else if (structHit.length >= 1) structPoints = 12 + (structHit.length - 1) * 17;
  else structPoints = 0;

  // ③ 环节覆盖：0–100 → 0–40
  const coverPoints = Math.round((s.coverPercent / 100) * 40);

  // ④ 缺失环节：每条 −8（上限 −24）
  const missingPenalty = -Math.min(24, s.missing.length * 8);

  const components = [
    {
      key: 'board',
      label: '板书承担设计',
      max: 30,
      points: clamp(Math.round(boardPoints), 0, 30),
      evidenceText: boardSentences.length > 0 ? `讲稿里有 ${boardSentences.length} 句提到板书` : '讲稿里没有板书安排的陈述',
      fix: '写清主板书分区，并说明推导主线不擦',
    },
    {
      key: 'structure',
      label: '板书结构标记',
      max: 30,
      points: clamp(Math.round(structPoints), 0, 30),
      evidenceText: structHit.length > 0 ? `命中结构标记：${structHit.slice(0, 4).join('、')}` : '没有命中课题/步骤/结论类结构标记',
      fix: '板书写「课题 → 第一步 → 第二步 → 结论」四行',
    },
    {
      key: 'cover',
      label: '环节覆盖',
      max: 40,
      points: coverPoints,
      evidenceText: `覆盖 ${s.covered.length}/7 个教学环节（${s.coverPercent}%）`,
      fix: '补齐缺失环节，让板书有推导主线',
    },
    {
      key: 'missing',
      label: '缺失环节扣分',
      max: 0,
      points: missingPenalty,
      evidenceText: s.missing.length > 0 ? `未覆盖：${s.missing.slice(0, 3).join('、')}` : '环节齐全',
      fix: '把缺失环节补进板书主线',
    },
  ];
  return { components, max: 100 };
}

function scoreIntroDesign(s) {
  // ① 语义切分导入段（不再按字数盲切前 15%）
  const { text: intro } = extractIntroSegment(s.transcript);
  const introHits = INTRO_MARKERS.filter((m) => intro.indexOf(m) !== -1);

  // ② 导入信号：≥2 得 50；1 得 28；0 得 0
  let signalPoints;
  if (introHits.length >= 2) signalPoints = 50;
  else if (introHits.length === 1) signalPoints = 28;
  else signalPoints = 0;

  // ③ 导入段含提问得 20
  //    问句判定收敛到共享实现：不再只认问号，也不认「吗/呢」结尾的陈述句。
  const askPoints = isQuestionSentence(intro) ? 20 : 0;

  // ④ 导入段 ≥40 字得 15；<20 字 −10
  const introChars = intro.replace(/\s/g, '').length;
  let lengthPoints;
  if (introChars >= 40) lengthPoints = 15;
  else if (introChars >= 20) lengthPoints = 8;
  else lengthPoints = -10;

  // ⑤ 无具体情境名词 −10
  const concrete = CONCRETE_MARKERS.some((m) => intro.indexOf(m) !== -1);
  const concretePoints = concrete ? 0 : -10;

  const components = [
    {
      key: 'signal',
      label: '导入信号',
      max: 50,
      points: signalPoints,
      evidenceText: introHits.length > 0 ? `导入段命中：${introHits.slice(0, 3).join('、')}` : '导入段没有情境/冲突/复习信号',
      fix: '用生活情境或旧知冲突开场，别直接讲定义',
    },
    {
      key: 'ask',
      label: '导入提问',
      max: 20,
      points: askPoints,
      evidenceText: askPoints > 0 ? '导入段里有提问' : '导入段没有提问',
      fix: '在情境之后立刻抛出一个真实问题',
    },
    {
      key: 'length',
      label: '导入长度',
      max: 15,
      points: lengthPoints,
      evidenceText: `导入段约 ${introChars} 字（目标 ≥40 字）`,
      fix: '导入写够 40 字，把情境铺完整再进新课',
    },
    {
      key: 'concrete',
      label: '情境具体度',
      max: 0,
      points: concretePoints,
      evidenceText: concrete ? '导入里有具体事物' : '导入里没有具体情境名词',
      fix: '给一个具体数字、图形或生活场景',
    },
  ];
  return { components, max: 85 };
}

function scoreTransition(s) {
  // ① 过渡词句数：≥4 得 45；2–3 得 25–44；1 得 12；0 得 0
  const transSentences = s.sentences.filter((x) => TRANSITION_MARKERS.some((m) => x.indexOf(m) !== -1));
  let transPoints;
  if (transSentences.length >= 4) transPoints = 45;
  else if (transSentences.length >= 2) transPoints = 25 + (transSentences.length - 2) * 9.67;
  else if (transSentences.length === 1) transPoints = 12;
  else transPoints = 0;

  // ② 环节覆盖映射 0–35
  const coverPoints = Math.round((s.coverPercent / 100) * 35);

  // ③ 覆盖不足 −15
  const coverPenalty = s.coverPercent < 50 ? -15 : 0;

  // ④ 末句收口得 20
  const last = s.sentences.length ? s.sentences[s.sentences.length - 1] : '';
  const closePoints = CLOSE_MARKERS.some((m) => last.indexOf(m) !== -1) ? 20 : 0;

  const components = [
    {
      key: 'transition',
      label: '过渡句',
      max: 45,
      points: clamp(Math.round(transPoints), 0, 45),
      evidenceText: transSentences.length > 0 ? `有 ${transSentences.length} 句带过渡词` : '没有过渡句',
      fix: '每个环节之间补一句「接下来我们……」。',
    },
    {
      key: 'cover',
      label: '环节覆盖',
      max: 35,
      points: coverPoints,
      evidenceText: `覆盖 ${s.covered.length}/7 个教学环节（${s.coverPercent}%）`,
      fix: '把推导、例题、互动、小结串成一条线',
    },
    {
      key: 'cover_penalty',
      label: '覆盖不足扣分',
      max: 0,
      points: coverPenalty,
      evidenceText: s.coverPercent < 50 ? `环节覆盖仅 ${s.coverPercent}%，衔接会显得跳` : `环节覆盖 ${s.coverPercent}%，衔接基础够`,
      fix: '补一个过渡句把环节接上',
    },
    {
      key: 'close',
      label: '收口',
      max: 20,
      points: closePoints,
      evidenceText: closePoints > 0 ? '末句有小结/作业收口' : '末句没有小结或作业收口',
      fix: '结尾用两句话收口并布置作业',
    },
  ];
  return { components, max: 100 };
}

const SKILL_SCORERS = {
  question_wait: scoreQuestionWait,
  pace_filler: scorePaceFiller,
  board_structure: scoreBoardStructure,
  intro_design: scoreIntroDesign,
  transition: scoreTransition,
};

/* ---------------- 证据抽取（quote 必须是原文子串） ---------------- */

/* 找出讲稿里的封闭式提问句（用于 question_wait 的证据） */
function findFakeQuestionSentences(sentences) {
  return sentences.filter((x) => FAKE_PHRASES.some((f) => x.indexOf(f) !== -1));
}

function findSentencesWith(sentences, markers) {
  return sentences.filter((x) => markers.some((m) => x.indexOf(m) !== -1));
}

function makeEvidence(transcript, quote, reason, fix) {
  const q = String(quote || '').slice(0, 40);
  if (!q) return null;
  // 硬校验：必须是讲稿原样子串，否则丢弃
  if (transcript.indexOf(q) === -1) return null;
  return { quote: q, reason: String(reason || '').slice(0, 50), fix: String(fix || '').slice(0, 60) };
}

function collectEvidence(skill, s) {
  const out = [];
  const push = (quote, reason, fix) => {
    const e = makeEvidence(s.transcript, quote, reason, fix);
    if (e && out.length < 6 && !out.some((x) => x.quote === e.quote)) out.push(e);
  };

  if (skill === 'question_wait') {
    findFakeQuestionSentences(s.sentences).slice(0, 2).forEach((x) =>
      push(x, '封闭式提问不需要学生思考', '换成点名 +「说说你的理由」')
    );
    findSentencesWith(s.sentences, WAIT_MARKERS).slice(0, 2).forEach((x) =>
      push(x, '这一处留了等待', '保持这个等待，把等待放在结论之前')
    );
  } else if (skill === 'pace_filler') {
    // 口头禅最多的那句
    const top = Object.keys(s.fillerDetail).sort((a, b) => s.fillerDetail[b] - s.fillerDetail[a])[0];
    if (top) {
      const hit = s.sentences.find((x) => x.indexOf(top) !== -1);
      if (hit) push(hit, `这句里出现了「${top}」`, `把这处「${top}」换成 1 秒停顿`);
    }
    const long = s.sentences.slice().sort((a, b) => b.length - a.length)[0];
    if (long && long.length > 60) push(long.slice(0, 40), '这句特别长，容易讲快', '拆成两句，中间留停');
  } else if (skill === 'board_structure') {
    findSentencesWith(s.sentences, BOARD_MARKERS).slice(0, 2).forEach((x) =>
      push(x, '这一句在安排板书', '写清主板书分区与不擦的内容')
    );
    findSentencesWith(s.sentences, STRUCT_MARKERS).slice(0, 2).forEach((x) =>
      push(x, '这一句带结构标记', '板书写成课题→步骤→结论三行')
    );
  } else if (skill === 'intro_design') {
    // 语义切分导入段，取其中的句子做引用
    const introSeg = extractIntroSegment(s.transcript);
    const introSent = introSeg.sentences.slice(0, 2);
    introSent.forEach((x) => push(x, '这句在导入段里', '把情境补具体，并加一个真实问题'));
    if (!introSent.length) push(s.sentences[0] || '', '这是讲稿开头', '先给情境再进定义');
  } else if (skill === 'transition') {
    findSentencesWith(s.sentences, TRANSITION_MARKERS).slice(0, 3).forEach((x) =>
      push(x, '这一句在做衔接', '过渡句要指明下一个环节做什么')
    );
    const last = s.sentences[s.sentences.length - 1] || '';
    push(last, '这是讲稿最后一句', '用小结或作业收口');
  }
  return out;
}

/* ---------------- 建议生成（每条必须引用真实数字） ---------------- */
function buildSuggestions(skill, s, components) {
  const list = [];
  const byKey = (k) => components.find((c) => c.key === k);

  if (skill === 'question_wait') {
    const d = byKey('density');
    const w = byKey('wait');
    const f = byKey('fake');
    if (f && f.points < 0) {
      list.push({
        title: '把假提问换成真提问',
        detail: `检测到 ${s.fake} 处封闭式提问，按规则扣 ${Math.abs(f.points)} 分。改成点名 +「说说你的理由」，问完默数三秒。`,
      });
    }
    if (d && d.points < 35) {
      list.push({
        title: '加密有效提问',
        detail: `当前${formatDensityPhrase(s.thinkingCount / (s.durationSec / 60))}，密度得分只有 ${d.points}。每分钟补 1 个开放提问。`,
      });
    }
    if (w && w.points < 25) {
      list.push({
        title: '提问后留白三秒',
        detail: `讲稿里只有 ${s.waitAfterQuestions} 处提问后写了等待标记（规则按文本证据判定，无法测出真实等待秒数）。问完在心里数三下再讲。`,
      });
    }
    if (s.waitMarkers < 3) {
      list.push({
        title: '在稿上标出等待',
        detail: `讲稿里只有 ${s.waitMarkers} 处等待标记，规则上每处计 5 分。写上「（停顿）」能逼自己真的等。`,
      });
    }
  } else if (skill === 'pace_filler') {
    const p = byKey('pace');
    if (p && p.points < 45) {
      list.push({
        title: '把语速压回适中区间',
        detail: `当前 ${s.rate} 字/分，适中区间 120–150，语速项只拿 ${p.points} 分。关键结论后停 0.5 秒。`,
      });
    }
    if (s.fillerTotal >= 8) {
      const top = Object.keys(s.fillerDetail).sort((a, b) => s.fillerDetail[b] - s.fillerDetail[a])[0];
      list.push({
        title: '删掉高频口头禅',
        detail: `全文 ${s.fillerTotal} 处口头禅，「${top}」最多。录音回听逐个划掉，用停顿代替。`,
      });
    }
    if (s.chars > 0 && s.fillerTotal / (s.chars / 100) > 4) {
      list.push({
        title: '口头禅密度偏高',
        detail: `每百字约 ${(s.fillerTotal / (s.chars / 100)).toFixed(1)} 处口头禅，超过 4 处/百字。改写长句，去掉填充词。`,
      });
    }
    if (!list.length) {
      list.push({
        title: '保持当前语速',
        detail: `当前 ${s.rate} 字/分、口头禅 ${s.fillerTotal} 处，两项都达标。下一轮可加练结论处的停顿。`,
      });
    }
  } else if (skill === 'board_structure') {
    const b = byKey('board');
    const st = byKey('structure');
    const mi = byKey('missing');
    if (b && b.points < 25) {
      list.push({
        title: '让板书承担结构',
        detail: `讲稿里只有 ${findSentencesWith(s.sentences, BOARD_MARKERS).length} 句提到板书，板书项 ${b.points} 分。写清分区与不擦内容。`,
      });
    }
    if (st && st.points < 25) {
      list.push({
        title: '写出课题到结论的主线',
        detail: `结构标记只命中 ${STRUCT_MARKERS.filter((m) => s.transcript.indexOf(m) !== -1).length} 个，结构项 ${st.points} 分。板书写四行：课题→第一步→第二步→结论。`,
      });
    }
    if (mi && mi.points < 0) {
      list.push({
        title: '补齐缺失环节',
        detail: `未覆盖 ${s.missing.slice(0, 3).join('、')}，共 ${s.missing.length} 个环节缺失，按规则扣 ${Math.abs(mi.points)} 分。`,
      });
    }
    if (!list.length) {
      list.push({
        title: '板书结构已达标',
        detail: `环节覆盖 ${s.coverPercent}%、板书陈述 ${findSentencesWith(s.sentences, BOARD_MARKERS).length} 句。下一轮可练副板书的例题演算。`,
      });
    }
  } else if (skill === 'intro_design') {
    const sg = byKey('signal');
    const l = byKey('length');
    const c = byKey('concrete');
    // 语义切分导入段，统一口径计算命中数与字数
    const introText = extractIntroSegment(s.transcript).text;
    const introHits = INTRO_MARKERS.filter((m) => introText.indexOf(m) !== -1).length;
    const introChars = introText.replace(/\s/g, '').length;
    if (sg && sg.points < 40) {
      list.push({
        title: '导入先给情境',
        detail: `导入段只命中 ${introHits} 个导入信号。用生活情境或旧知冲突开场。`,
      });
    }
    if (l && l.points < 15) {
      list.push({
        title: '导入写够 40 字',
        detail: `导入段约 ${introChars} 字，太短会显得直接开讲。把情境铺完整再进新课。`,
      });
    }
    if (c && c.points < 0) {
      list.push({
        title: '给一个具体场景',
        detail: '导入段里没有数字、图形或生活场景词。补一个具体事物，学生才有代入感。',
      });
    }
    const ask = byKey('ask');
    if (ask && ask.points < 20) {
      list.push({
        title: '导入里抛一个问题',
        detail: '导入段没有检测到提问。用「李同学，你说说……」把问题抛给学生，别直接开讲。',
      });
    }
    if (!list.length) {
      list.push({
        title: '导入结构已达标',
        detail: `导入信号 ${introHits} 个、含提问。下一轮可练导入到新知的过渡。`,
      });
    }
  } else if (skill === 'transition') {
    const t = byKey('transition');
    const cl = byKey('close');
    const cp = byKey('cover_penalty');
    if (t && t.points < 40) {
      list.push({
        title: '环节之间加过渡句',
        detail: `只有 ${findSentencesWith(s.sentences, TRANSITION_MARKERS).length} 句带过渡词，过渡项 ${t.points} 分。每两个环节之间补一句「接下来我们……」。`,
      });
    }
    if (cp && cp.points < 0) {
      list.push({
        title: '把环节接上',
        detail: `环节覆盖只有 ${s.coverPercent}%，低于 50% 按规则扣 15 分。至少串起推导、例题、互动三段。`,
      });
    }
    if (cl && cl.points === 0) {
      list.push({
        title: '结尾加收口',
        detail: '末句没有小结/总结/作业/下课。用两句话收口并布置作业。',
      });
    }
    if (!list.length) {
      list.push({
        title: '衔接已达标',
        detail: `过渡句 ${findSentencesWith(s.sentences, TRANSITION_MARKERS).length} 句、环节覆盖 ${s.coverPercent}%。下一轮可练小结的层次。`,
      });
    }
  }

  if (!list.length) {
    list.push({ title: '本轮已达标', detail: `讲稿 ${s.chars} 字、语速 ${s.rate} 字/分，各项规则分均接近满分。` });
  }
  return list.slice(0, 5);
}

/* ---------------- 推荐下一个技能 ---------------- */
/* 用真实统计给其余四项技能估一个「短板值」，值越小说明这块越该练 */
function weaknessScores(s) {
  const transHits = countMarkers(s.transcript, TRANSITION_MARKERS);
  const boardHits = countMarkers(s.transcript, BOARD_MARKERS);
  // 语义切分导入段（不再按字数盲切前 15%）
  const introText = extractIntroSegment(s.transcript).text;
  const introHits = countMarkers(introText, INTRO_MARKERS);
  // 与 question_design 维度同源：句级「需要思考的提问」密度（不用 analyzer 的问号计数）
  const density = s.thinkingCount / (s.durationSec / 60);
  return {
    question_wait: (100 - density * 40) + s.fake * 6 + (s.waitCoverage < 0.5 ? 15 : 0) - s.waitMarkers * 2,
    pace_filler: Math.abs(s.rate - 135) / 3 + s.fillerTotal * 2 + (s.chars > 0 && s.fillerTotal / (s.chars / 100) > 4 ? 10 : 0),
    board_structure: (boardHits < 3 ? 30 : 0) + s.missing.length * 5,
    intro_design: (introHits < 2 ? 30 : 0) + (introText.replace(/\s/g, '').length < 40 ? 10 : 0),
    transition: (transHits < 4 ? 30 : 0) + (s.coverPercent < 50 ? 15 : 0),
  };
}

function nextDrill(skill, score, s) {
  const all = weaknessScores(s);
  const keys = Object.keys(all).filter((k) => k !== skill);
  const weakest = keys.sort((a, b) => all[b] - all[a])[0];
  const reason =
    score < 60
      ? `本项 ${score} 分未达标，先补「${SKILL_MAP[weakest].label}」，再回来练本项。`
      : `本项已达标，「${SKILL_MAP[weakest].label}」是下一块更值得练的短板。`;
  return { skill: weakest, reason };
}

/* ---------------- 主入口：规则兜底评分 ---------------- */
/**
 * 专项练习的规则评分
 * @param {{skill:string, transcript:string, profile?:object, durationSec?:number, subject?:string, grade?:string}} input
 */
function drillRule(input = {}) {
  const skill = String(input.skill || '');
  const skillDef = SKILL_MAP[skill];
  if (!skillDef) throw new Error('未知技能：' + skill);

  const profile = input.profile && typeof input.profile === 'object' ? input.profile : null;
  const s = buildStat(input);
  const scorer = SKILL_SCORERS[skill];
  const { components, max } = scorer(s, profile);

  // 各组件归一到 0–100 分并算权重
  const dims = components.map((c) => {
    // max>0 的组件按得分率折算；max===0 的组件是「纯扣分项」，
    // 用 100 分制表达：没扣分 = 100 分，扣了多少就掉多少。
    const score = c.max > 0
      ? clamp(Math.round((c.points / c.max) * 100), 0, 100)
      : clamp(100 + c.points, 0, 100);
    const weight = max > 0 ? Number((c.max / max).toFixed(4)) : 0;
    return {
      // 对外统一用规范 key（按技能查表：不同技能的同名内部 key 映射不同）
      key: canonicalKeyFor(skill, c.key) || c.key,
      label: c.label,
      score,
      weight,
      evidence: String(c.evidenceText || '').slice(0, 60),
      fix: String(c.fix || '').slice(0, 60),
    };
  });

  // 总分：按组件原始分加权（max 之外的负分直接扣），再归一到 100
  let points = 0;
  components.forEach((c) => {
    points += c.max > 0 ? c.points : c.points;
  });
  let raw = max > 0 ? (points / max) * 100 : 0;
  raw = clamp(raw, 0, 100);

  // 讲稿过短（<60 字）→ 原始分 ×0.8，并在总评里说明
  const tooShort = s.chars < 60;
  if (tooShort) raw = raw * 0.8;

  const score = clamp(Math.round(raw), 0, 100);
  const grade = score >= 85 ? '优秀' : score >= 60 ? '合格' : '需改进';

  const evidence = collectEvidence(skill, s);
  const suggestions = buildSuggestions(skill, s, components);

  const summaryParts = [];
  summaryParts.push(`${skillDef.label}得分 ${score} 分（${grade}）`);
  summaryParts.push(`讲稿 ${s.chars} 字、语速 ${s.rate} 字/分、需要思考的提问 ${s.thinkingCount} 个（句级问句判定）`);
  if (profile && profile.class && profile.class.level) {
    const lv = PROFILE_LABELS.level[profile.class.level] || PROFILE_LABELS.level.good;
    summaryParts.push(`按「${lv}」班口径`);
  }
  if (tooShort) summaryParts.push('样本过短，评分仅供参考');

  const metrics = {
    chars_per_min: s.rate,
    filler_total: s.fillerTotal,
    questions_asked: s.asked,
    genuine_questions: s.genuine,
    fake_questions: s.fake,
    // 等待时长不可测量：没有音频时间戳，不输出任何秒数（字段保留，值恒为 null）
    avg_wait_sec: null,
    wait_source: 'unmeasured',
    cover_percent: s.coverPercent,
    pause_count: s.pauseCount,
    matched_markers: s.waitMarkers,
  };

  return {
    skill,
    skill_label: skillDef.label,
    duration_sec: s.durationSec,
    score,
    grade,
    summary: summaryParts.join('，').slice(0, 80),
    dimensions: dims.slice(0, 5),
    evidence,
    suggestions,
    next_drill: nextDrill(skill, score, s),
    metrics,
    engine: 'rule',
    source_note: '本地规则判定：基于讲稿文本的真实统计（语速/提问/口头禅/环节覆盖），非音频实测；等待时长无时间戳不可测量，等待维度改按文本证据（等待标记）判定',
  };
}

/* ---------------- LLM 分支的结果校验与合并 ---------------- */
/**
 * 校验 LLM 返回的评分结果：evidence.quote 必须原样出现在讲稿里，否则丢弃。
 * 维度全部校验失败 → 返回 null（调用方降级规则兜底）。
 */
function validateLlmResult(json, input = {}) {
  if (!json || typeof json !== 'object') return null;
  const transcript = String(input.transcript || '');
  const skill = String(input.skill || '');
  const skillDef = SKILL_MAP[skill];
  if (!skillDef) return null;

  const dimsRaw = Array.isArray(json.dimensions) ? json.dimensions : [];
  const dims = [];
  const seenKeys = new Set();
  dimsRaw.slice(0, 5).forEach((d, i) => {
    const score = clamp(Math.round(Number(d && d.score)), 0, 100);
    if (!isFinite(score)) return;
    const weight = isFinite(Number(d.weight)) ? clamp(Number(d.weight), 0, 1) : 1 / Math.max(1, dimsRaw.length);
    // 规范 key 映射：规范 key 精确 → aliases → label 关键词兜底；映射不到才保留模型原 key
    const rawKey = String((d && d.key) || 'dim_' + (i + 1)).slice(0, 30);
    const label = String((d && d.label) || '维度' + (i + 1)).slice(0, 20);
    const key = mapToCanonicalKey(skill, rawKey, label) || rawKey;
    if (seenKeys.has(key)) return; // 同一规范维度只保留第一条
    seenKeys.add(key);
    dims.push({
      key,
      label,
      score,
      weight: Number(weight.toFixed(4)),
      evidence: String((d && d.evidence) || '').slice(0, 60),
      fix: String((d && d.fix) || '').slice(0, 60),
    });
  });
  if (!dims.length) return null;

  /* 与规则路径对齐：规范维度集合必须一致。
     模型没给到的规范维度，用规则路径同 key 的真实统计补齐（weight=0，不影响模型权重口径）；
     模型多给且映射不上的维度保留原 key（前端按 label 渲染，不会崩）。 */
  const canonical = canonicalKeys(skill);
  if (canonical.length) {
    let ruleDims = [];
    try {
      const rr = drillRule({ skill, transcript, durationSec: clamp(Math.round(Number(input.durationSec) || 180), 1, 600), profile: input.profile });
      ruleDims = Array.isArray(rr && rr.dimensions) ? rr.dimensions : [];
    } catch (e) {
      ruleDims = [];
    }
    canonical.forEach((ck) => {
      if (seenKeys.has(ck)) return;
      const rd = ruleDims.find((x) => x && x.key === ck);
      seenKeys.add(ck);
      dims.push({
        key: ck,
        label: rd ? rd.label : ck,
        score: rd ? rd.score : 0,
        weight: 0,
        evidence: rd ? rd.evidence : '',
        fix: rd ? rd.fix : '',
      });
    });
    // 规范维度在前，模型自定义 key 在后
    dims.sort((a, b) => {
      const ia = canonical.indexOf(a.key);
      const ib = canonical.indexOf(b.key);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    // 契约要求 dimensions 3–5 项：规范维度优先，超出的模型自定义项从尾部裁掉
    if (dims.length > 5) {
      const keep = dims.filter((x) => canonical.indexOf(x.key) !== -1);
      const extra = dims.filter((x) => canonical.indexOf(x.key) === -1);
      while (keep.length + extra.length > 5 && extra.length) extra.pop();
      dims.length = 0;
      keep.concat(extra).forEach((x) => dims.push(x));
    }
  }

  const evs = [];
  (Array.isArray(json.evidence) ? json.evidence : []).slice(0, 6).forEach((e) => {
    const quote = String((e && e.quote) || '').slice(0, 40);
    if (!quote || transcript.indexOf(quote) === -1) return; // 不在原文里 → 丢弃
    evs.push({
      quote,
      reason: String((e && e.reason) || '').slice(0, 50),
      fix: String((e && e.fix) || '').slice(0, 60),
    });
  });

  const suggs = [];
  (Array.isArray(json.suggestions) ? json.suggestions : []).slice(0, 5).forEach((sg) => {
    const title = String((sg && sg.title) || '').slice(0, 20);
    const detail = String((sg && sg.detail) || '').slice(0, 100);
    if (!title && !detail) return;
    suggs.push({ title, detail });
  });

  const score = clamp(Math.round(Number(json.score)), 0, 100);
  if (!isFinite(score)) return null;

  const durationSec = clamp(Math.round(Number(input.durationSec) || 180), 1, 600);
  // 推荐下一个技能：必须存在且不能等于本项，否则按规则排序回退
  let nextSkill = '';
  let nextReason = '';
  if (json.next_drill && SKILL_MAP[String(json.next_drill.skill)] && String(json.next_drill.skill) !== String(input.skill)) {
    nextSkill = String(json.next_drill.skill);
    nextReason = String(json.next_drill.reason || '').slice(0, 60);
  }
  if (!nextSkill) {
    try {
      const fb = nextDrill(String(input.skill), score, buildStat({ transcript, durationSec }));
      nextSkill = fb.skill;
      nextReason = fb.reason;
    } catch (e) {
      nextSkill = 'question_wait';
      nextReason = '下一轮试试提问与等待。';
    }
  }
  // metrics 必须是契约里的九个子集：缺的部分用规则统计补齐（保证前端渲染不崩）
  let metrics;
  try {
    const s = buildStat({ transcript, durationSec });
    metrics = {
      chars_per_min: s.rate,
      filler_total: s.fillerTotal,
      questions_asked: s.asked,
      genuine_questions: s.genuine,
      fake_questions: s.fake,
      // 等待时长不可测量：没有音频时间戳，不输出任何秒数
      avg_wait_sec: null,
      wait_source: 'unmeasured',
      cover_percent: s.coverPercent,
      pause_count: s.pauseCount,
      matched_markers: s.waitMarkers,
    };
  } catch (e) {
    metrics = {
      chars_per_min: 0, filler_total: 0, questions_asked: 0, genuine_questions: 0,
      fake_questions: 0, avg_wait_sec: null, wait_source: 'unmeasured',
      cover_percent: 0, pause_count: 0, matched_markers: 0,
    };
  }
  const llmMetrics = json.metrics && typeof json.metrics === 'object' ? json.metrics : {};
  Object.keys(metrics).forEach((k) => {
    // avg_wait_sec / wait_source 是「不可测量」的口径标记，不允许被模型数值覆盖
    if (k === 'avg_wait_sec' || k === 'wait_source') return;
    if (isFinite(Number(llmMetrics[k]))) metrics[k] = Number(llmMetrics[k]);
  });
  return {
    skill: String(input.skill),
    skill_label: skillDef.label,
    duration_sec: durationSec,
    score,
    grade: score >= 85 ? '优秀' : score >= 60 ? '合格' : '需改进',
    summary: String(json.summary || '').slice(0, 80),
    dimensions: dims,
    evidence: evs,
    suggestions: suggs.length ? suggs : [{ title: '继续打磨', detail: '按维度分数最低的一项下一轮重点练。' }],
    next_drill: { skill: nextSkill, reason: nextReason },
    metrics,
    engine: 'llm',
    source_note: '大模型实时分析：基于本次讲稿文本的语义判断；等待时长无时间戳不可测量，等待维度按文本证据（等待标记）判定',
  };
}

/* 供 engine 复用的统计子集（DRF 里 drillAnalyze 内部用） */
module.exports = {
  SKILLS,
  SKILL_MAP,
  CANONICAL_DIMENSIONS,
  canonicalKeys,
  canonicalKeyFor,
  mapToCanonicalKey,
  drillRule,
  validateLlmResult,
  buildStat,
  splitSentences,
  countMarkers,
  countOccur,
  WAIT_MARKERS,
  BOARD_MARKERS,
  STRUCT_MARKERS,
  INTRO_MARKERS,
  INTRO_END_MARKERS,
  extractIntroSegment,
  scoreIntroDesign,
  TRANSITION_MARKERS,
  CLOSE_MARKERS,
  deriveLevelParams,
  PROFILE_LABELS,
};
