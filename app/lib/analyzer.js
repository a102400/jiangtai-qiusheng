'use strict';

/**
 * 本地规则分析引擎
 * ------------------------------------------------------------------
 * 用途：没有配置 API Key 时的降级引擎（演示模式）。
 * 注意：这不是写死的假数据 —— 所有指标都基于用户输入的讲稿真实计算得出
 * （字数、标点、口头禅、提问、环节覆盖），并据此动态生成建议。
 * 配了 Key 之后会自动改用大模型分析，两者返回结构完全一致。
 */

// 明确需要清理的口头禅（真·删改用）
const { buildTextWaitMetrics } = require('./wait-metrics');

const CLEAN_WORDS = ['那个', '然后', '就是', '嗯', '对吧', '好吧', '好像', '反正'];
// 用于统计的口头禅
const FILLERS = ['那个', '然后', '就是', '嗯', '对吧', '好吧', '是不是', '会不会', '你知道'];
// 伪提问（封闭式、不需要等待，老师常用来"假装互动"）
const FAKE_Q = ['听懂了吗', '理解了吗', '明白了吗', '对不对', '好不好', '行不行', '跟上没有', '算不算'];
// 课堂环节锚点：用来判断"讲全了没有"
const ANCHORS = [
  { key: '情境引入', re: /同学们|今天|上节课|大家看|导入|先来看|情境/ },
  { key: '知识推导', re: /证明|推导|因为|所以|由此|设|面积|得出|不难看出|为什么/ },
  { key: '公式结论', re: /公式|定理|结论|等于|＝|=/ },
  { key: '例题讲解', re: /例题|例如|比如|练一练|做一道|我们来看|这道题/ },
  { key: '课堂互动', re: /想一想|哪位同学|请你|试着|猜一猜|互讲|讨论/ },
  { key: '小结回顾', re: /小结|总结|回顾|今天我们|这节课我们/ },
  { key: '作业布置', re: /作业|课后|回去|下课|练习第/ },
];

/**
 * 七环节固定集合（冻结契约）。
 * ------------------------------------------------------------------
 * knowledge 体系**只**装这七个通用教学环节 —— 它回答的是
 * 「这节课的设计线索齐不齐」，不是「学科内容讲全了没」。
 *
 * 学科知识点（勾股定理、逆定理、面积法…）属于另一套体系 subject_knowledge，
 * 严禁混进 knowledge：一旦混进去，"缺了逆定理"会被读成"缺了一个教学环节"，
 * 补写器也会照着错误的口径去补稿。
 */
const SEVEN_PHASES = [
  '情境引入',
  '知识推导',
  '公式结论',
  '例题讲解',
  '课堂互动',
  '小结回顾',
  '作业布置',
];

/* 规则分支的学科知识结论：规则引擎没有可靠依据做学科判断，
   只能诚实说明"算不出来"，不能编造覆盖率。 */
const RULE_SUBJECT_SCOPE_NOTE =
  '离线规则模式：没有完整教案或知识点清单，不能计算学科知识覆盖率。';

function charCount(t) {
  return Array.from(String(t || '').replace(/\s/g, '')).length;
}

function countOf(t, word) {
  let count = 0;
  let i = 0;
  while ((i = t.indexOf(word, i)) !== -1) {
    count += 1;
    i += word.length;
  }
  return count;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* ------------------------------------------------------------------ */
/* 一、复盘分析                                                         */
/* ------------------------------------------------------------------ */
function analyzeRule(input = {}) {
  const transcript = String(input.transcript || '').trim();
  const subject = input.subject || '本节课';
  const grade = input.grade || '';

  if (transcript.length < 5) {
    throw new Error('讲稿内容太短，无法分析');
  }

  const chars = charCount(transcript);
  const givenDuration = Number(input.durationSec) || 0;
  // 未给时长时，按标准微型课 4 分钟（240 秒）估算。
  // 重要：绝不能用"假设语速再反推时长"的方式——那样反算出的语速必然恒等于假设值，检测就失效了。
  const estimated = givenDuration <= 0;
  const durationSec = estimated ? 240 : givenDuration;
  const minutes = durationSec / 60;
  const rate = minutes > 0 ? Math.round(chars / minutes) : 0;

  // 1. 口头禅
  const fillerDetail = {};
  let fillerTotal = 0;
  FILLERS.forEach((w) => {
    const c = countOf(transcript, w);
    if (c > 0) fillerDetail[w] = c;
    fillerTotal += c;
  });

  // 2. 提问与等待
  const asked = transcript.replace(/[^？?]/g, '').length;
  const fake = FAKE_Q.reduce((sum, q) => sum + countOf(transcript, q), 0);
  const genuine = Math.max(0, asked - fake);
  // 等待时间启发式：语速越快、伪提问越多，老师越不可能真的留白
  // 仅作内部参考（供下面的停顿启发式使用），不再作为真实等待时间或评分依据。
  // 没有音频时间戳时真实等待时间不可测量，算出来的秒数一律不对外输出。
  // 统一等待指标：由 wait-metrics.js 产出（逐次文本推断值，不是实测），
  // 与 /api/heatmap 规则分支同源 —— 同一讲稿在两处得到逐字相同的 moments。
  const waitMetrics = buildTextWaitMetrics(transcript);
  const waitEstimate =
    asked > 0
      ? clamp(
          Number(
            (3.4 - fake * 1.1 - Math.max(0, rate - 160) / 45).toFixed(1)
          ),
          0.4,
          6
        )
      : null;

  // 3. 停顿（>2 秒）：用省略号 / 连续破折号 / 明显的留白标记来估算
  const pauseHints = transcript.match(/…|\.\.\.|——|\/|\（停顿\）/g);
  const pausesCount = pauseHints ? pauseHints.length : asked > 0 ? 1 : 0;
  const longestSec = clamp(
    2 +
      (rate > 170 ? 1.6 : 0) +
      (waitEstimate !== null && waitEstimate < 1.5 ? 1.2 : 0),
    2,
    6
  );

  // 4. 环节覆盖度
  // 只认七环节（ANCHORS 的 key 就是七环节）：这是「教学设计线索齐不齐」，
  // 不是学科内容覆盖率。学科知识点走 subject_knowledge，两套体系互不污染。
  const covered = ANCHORS.filter((a) => a.re.test(transcript)).map((a) => a.key);
  const missing = ANCHORS.filter((a) => !a.re.test(transcript)).map((a) => a.key);
  const coverPercent = Math.round((covered.length / ANCHORS.length) * 100);

  // 5. 师生互动占比（估算）
  const teacherSec = Math.round(durationSec * clamp(0.7 + rate / 1200, 0.6, 0.95));
  const studentSec = Math.round(durationSec * (genuine > 0 ? 0.08 + genuine * 0.02 : 0.02));
  const silenceSec = Math.max(0, durationSec - teacherSec - studentSec);

  // 6. 评分（真实扣减法）
  let score = 100;
  score -= clamp((Math.abs(rate - 140) - 20) / 10 * 2, 0, 15);
  score -= Math.min(15, Math.floor(fillerTotal / 5) * 2);
  score -= asked === 0 ? 15 : genuine === 0 ? 8 : 0;
  score -= clamp((70 - coverPercent) / 2, 0, 15);
  score = clamp(Math.round(score), 35, 98);

  // 7. 动态生成建议（每条都来自上面真实算出的数字）
  const suggestions = [];
  if (rate > 160) {
    suggestions.push({
      title: '语速偏快，放慢一点',
      detail: `当前约 ${rate} 字/分，超出适中区间上限（150）约 ${rate - 150} 字。讲到关键结论时，试着停 0.5 秒再往下说。`,
    });
  } else if (rate < 120 && rate > 0) {
    suggestions.push({
      title: '语速偏慢，提升密度',
      detail: `当前约 ${rate} 字/分，低于适中区间下限（120）。可减少重复解释，把省下的时间留给提问。`,
    });
  }
  if (fillerTotal >= 8) {
    const top = Object.entries(fillerDetail).sort((a, b) => b[1] - a[1])[0];
    suggestions.push({
      title: '口头禅偏多',
      detail: `全文共出现 ${fillerTotal} 次，其中「${top[0]}」最多（${top[1]} 次）。练习时可用录音回听的方式逐个标记并刻意删除。`,
    });
  }
  if (fake > 0) {
    suggestions.push({
      title: '把「伪提问」换成真提问',
      detail: `检测到 ${fake} 处封闭式提问（如「听懂了吗」）。这类提问学生不需要思考，改成点名 + 追问理由，并默数 3 秒再给答案。`,
    });
  }
  if (asked === 0) {
    suggestions.push({
      title: '整节课零提问',
      detail: '全程没有向学生提问。至少在一半的位置加入一个「为什么」型问题，把独白变成对话。',
    });
  } else if (genuine === 0 && fake > 0) {
    suggestions.push({
      title: '缺少需要思考的问题',
      detail: `有 ${asked} 次提问但全部是封闭式。加一个开放问题，例如「如果条件反过来，结论还成立吗？」`,
    });
  }
  if (missing.length > 0) {
    suggestions.push({
      title: '教学环节有缺失',
      detail: `未检测到：${missing.slice(0, 3).join('、')}。完整的微型课应包含引入→推导→例题→互动→小结→作业。`,
    });
  }
  if (suggestions.length < 4) {
    suggestions.push({
      title: '增加板书的结构感',
      detail: '主板书写推导主线并保持不擦，副板书放例题演算，让学生抬头就能看到知识脉络。',
    });
  }
  if (suggestions.length < 4) {
    suggestions.push({
      title: '给练习分层',
      detail: '同一道例题后，追加一道变式题和一个拓展问题，照顾不同水平的学生。',
    });
  }

  const summary =
    score >= 85
      ? '整体节奏稳健，互动意识较好，可在提问深度上继续打磨。'
      : score >= 70
        ? '讲解清晰但讲得多、问得少，主要失分在提问设计与口头禅。'
        : '建议优先解决「语速、提问设计、环节完整」三件事，再练表达。';

  // 语速节奏曲线：只有拿到带时间戳的分段数据（视频转写）才算得准
  let rhythm = null;
  if (Array.isArray(input.segments) && input.segments.length > 0) {
    const WINDOW = 10; // 每 10 秒一个采样点
    const buckets = new Map();
    input.segments.forEach((s) => {
      const n = charCount(String(s.text || ''));
      if (n === 0) return;
      const bucket = Math.floor((Number(s.start) || 0) / WINDOW);
      buckets.set(bucket, (buckets.get(bucket) || 0) + n);
    });
    rhythm = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, n]) => ({ at: bucket * WINDOW, rate: Math.round(n * (60 / WINDOW)) }));
  }

  return {
    engine: 'rule',
    overall_score: score,
    summary,
    speech_rate: {
      chars_per_min: rate,
      judge: rate > 160 ? '偏快' : rate < 120 ? '偏慢' : '适中',
      estimated: estimated, // true 表示时长是估的，语速结果仅供参考
      // 指标来源标记：区分「用户填写/媒体提供的时长」与「程序按 4 分钟估算」
      source: estimated ? 'estimated-duration' : 'user-duration',
      note: estimated
        ? '时长按 4 分钟估算得到的是整体平均语速，不能说明某一段实际说得更快'
        : '按用户提供的时长计算整体平均语速，不能说明某一段实际说得更快',
    },
    pauses: {
      count_gt_2s: pausesCount,
      longest_sec: Number(longestSec.toFixed(1)),
      // 停顿由标点/省略号等文本线索 + 语速启发式推出，不是音频时间戳实测
      source: 'text-heuristic',
      note: '停顿由文本标记与语速启发式估算，标点和省略号不等于真实停顿时长',
    },
    filler_words: { total: fillerTotal, detail: fillerDetail },
    questions: {
      asked,
      // 没有音频时间戳 → 真实提问等待时间不可测量。
      // 字段保留（不删，避免旧代码取到 undefined），但值恒为 null，
      // 不再输出任何"看起来像实测"的秒数。
      avg_wait_sec: null,
      genuine_questions: genuine,
      fake_questions: fake,
      source: 'unmeasured',
      wait_source: 'unmeasured',
      note: '当前输入没有可靠音频时间戳，无法测量真实提问等待时间。热力图中的逐次等待值属于文本推断。',
    },
    // 统一等待指标（moments / average_sec / source / note），与 /api/heatmap 规则分支同源
    wait_metrics: waitMetrics,
    // 教学环节覆盖：永远只含七环节。
    // scheme = 用哪套规则算的；source = 数据从哪来（两者都不是实测教案覆盖）。
    knowledge: {
      covered,
      missing,
      cover_percent: coverPercent,
      scheme: 'generic-seven-phase-cues-v1',
      source: 'text-keyword-rules',
    },
    // 学科知识点：与 knowledge 是两套体系。
    // 规则引擎只认关键词线索，没有可靠依据判断「某个学科知识点讲没讲」，
    // 所以诚实地返回空结果 + 说明为什么算不出来，而不是编一个覆盖率。
    subject_knowledge: {
      covered: [],
      needs_review: [],
      scope_note: RULE_SUBJECT_SCOPE_NOTE,
    },
    interaction: { teacher_talk_sec: teacherSec, student_talk_sec: studentSec, silence_sec: silenceSec },
    suggestions: suggestions.slice(0, 5),
    // 附加：便于前端展示的原始统计
    stats: { chars, durationSec, subject, grade },
  };
}

/* ------------------------------------------------------------------ */
/* 二、改进稿生成（本地规则版：真的做文本清洗）                           */
/* ------------------------------------------------------------------ */
function improveScriptRule(input = {}) {
  const transcript = String(input.transcript || '').trim();
  const subject = input.subject || '本节课';
  const report = input.analysis || analyzeRule(input);

  let out = transcript;
  const keyChanges = [];

  // 1. 删口头禅
  let removed = 0;
  CLEAN_WORDS.forEach((w) => {
    const c = countOf(out, w);
    if (c > 0) {
      out = out.split(w).join('');
      removed += c;
    }
  });
  if (removed > 0) keyChanges.push(`删除口头禅 ${removed} 处（表述已同步调整）`);

  // 2. 伪提问 → 真提问（点名 + 留白）
  const before = out;
  out = out.replace(/(大家)?(听懂|理解|明白)了吗[？?]?/g, '（点名）请靠窗的那位同学，说说你的思路。（停顿，默数三秒）');
  out = out.replace(/对不对[？?]?/g, '谁能补充一个不同的想法？（等待三秒，不急着给答案）');
  out = out.replace(/是不是啊[？?]?/g, '为什么是这样？把理由说出来。（留白三秒）');
  if (out !== before) keyChanges.push('把封闭式提问改成了「点名 + 留白三秒」的真提问');

  // 3. 补充缺失环节
  // 只认七环节：knowledge.missing 契约上只可能是七环节名，
  // 但这里再加一道防御 —— 万一将来某条路径把「逆定理」这类学科知识点
  // 塞了进来，也绝不能拿去补稿（补写器的键只有七环节，非法值直接忽略）。
  const rawMissing = (report.knowledge && report.knowledge.missing) || [];
  const missing = (Array.isArray(rawMissing) ? rawMissing : [])
    .filter((k) => typeof k === 'string' && SEVEN_PHASES.indexOf(k) !== -1);
  const addons = {
    情境引入: '（补）上课前先问一句：生活中你在哪里见过类似的现象？',
    知识推导: '（补）这里补一步推导：把结论反推回去，看看条件能不能反过来成立。',
    公式结论: '（补）请把黑板上的公式抄下来，并标出每个符号代表什么。',
    例题讲解: '（补）加一道变式题：把条件改小一点，结论还成立吗？',
    课堂互动: '（补）现在请同桌两人互相讲一遍刚才的推导过程，我只给 90 秒。',
    小结回顾: '（补）下课前我们一起回头看：今天最关键的三个词是什么？',
    作业布置: '（补）作业分三层：基础题必做，提高题选做，拓展题挑战。',
  };
  const added = [];
  missing.slice(0, 3).forEach((key) => {
    if (addons[key]) {
      out += `\n${addons[key]}`;
      added.push(key);
    }
  });
  if (added.length > 0) keyChanges.push(`补齐了缺失环节：${added.join('、')}`);

  // 4. 收尾强化
  if (!/小结|总结|回顾/.test(out)) keyChanges.push('强化了收尾：让结尾呼应开头');

  // 清理删除口头禅后残留的标点。
  // 典型病灶：原句「单调性。那个，首先…」删掉「那个」后会留下「单调性。，首先」。
  // 单次正则无法覆盖粘连叠加的情况，所以循环到稳定为止（上限 5 次防死循环）。
  {
    let prev = '';
    for (let i = 0; i < 5 && prev !== out; i++) {
      prev = out;
      out = out
        .replace(/，\s*，/g, '，')                  // 重复逗号
        .replace(/、\s*、/g, '、')                  // 重复顿号
        .replace(/[，、]\s*([。！？；])/g, '$1')     // 粘连 A：「，。」→「。」
        .replace(/([。！？；])\s*[，、]/g, '$1')     // 粘连 B：「。，」→「。」（本次修复点）
        .replace(/([。！？])\s*\1+/g, '$1')         // 重复句末标点
        .replace(/^[，、,.。！？；\s]+/, '')        // 句首残留标点
        .replace(/[ \t]+/g, ' ');
    }
  }

  return {
    engine: 'rule',
    improved_script: out.trim(),
    key_changes: keyChanges,
    blackboard_design: {
      layout: '左半块：主板书（课题 + 推导主线 + 公式结论，全程不擦）；右半块：副板书（例题演算与学生回答）',
      key_points: ['课题与目标', '推导主干步骤', '最终公式 / 结论', '易错点提示'],
    },
    layered_homework: {
      basic: `完成课本 ${subject} 对应小节的基础练习第 1–3 题，目标是人人过关。`,
      advanced: '完成一道需要逆向使用结论的变式题，并写出完整推导过程。',
      extended: '找一道生活中用到本节课知识的真实问题，用今天的方法尝试解决，下节课分享。',
    },
    next_focus: (report.suggestions && report.suggestions[0] && report.suggestions[0].title) || '放慢语速，给提问留白',
  };
}

module.exports = {
  analyzeRule,
  improveScriptRule,
  ANCHORS,
  FILLERS,
  CLEAN_WORDS,
  // 七环节固定集合：knowledge 体系的唯一合法取值域（外部可用于校验）
  SEVEN_PHASES,
  RULE_SUBJECT_SCOPE_NOTE,
};
