'use strict';

/**
 * 等待指标口径回归测试
 * ------------------------------------------------------------------
 * 背景：产品曾把「由讲稿文本启发式推算的等待秒数」当成实测等待，
 * 在 7 处消费并用于扣分。没有音频时间戳时真实等待时间不可测量，
 * 文本推断值不能冒充实测值。
 *
 * 本文件锁死四条口径：
 *   1. 普通分析（规则/LLM）→ questions.avg_wait_sec 恒为 null，
 *      source / wait_source 恒为 'unmeasured'；
 *   2. 等待秒数不再参与评分，也不再生成"留白不足"类建议；
 *   3. 热力图仍展示逐次文本推断值，但每条自带来源标记；
 *      "整段未检测到提问"不再是一条伪造条目 —— 新契约下 moments 为空数组、
 *      average_sec 为 null（统一口径见 tests/wait-contract.test.js）；
 *   4. 专项练习的等待维度改用文本证据判定，metrics 不输出秒数。
 */

const test = require('node:test');
const assert = require('node:assert');

const { analyzeRule } = require('../lib/analyzer.js');
const engine = require('../lib/engine.js');
const { drillRule } = require('../lib/drill.js');
const { classroomMetrics } = require('../lib/heatmap.js');
const { buildExportHtml } = require('../lib/export.js');

/* 离线确定性：测试不允许走大模型分支（否则结果依赖网络与密钥） */
const SAVED_ENV = {
  AI_API_KEY: process.env.AI_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};
function offline(t) {
  delete process.env.AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    if (SAVED_ENV.AI_API_KEY === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = SAVED_ENV.AI_API_KEY;
    if (SAVED_ENV.DEEPSEEK_API_KEY === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = SAVED_ENV.DEEPSEEK_API_KEY;
  });
}

/* 两段讲稿：除占位短语外完全相同，长度也相同（字数→语速一致） */
const PLACEHOLDER_FAKE = '听懂了吗？';   // 5 字：封闭式提问
const PLACEHOLDER_PLAIN = '下面继续。';  // 5 字：普通陈述
const HEAD = '同学们好，今天我们讲函数的单调性。第一步，求导。为什么要求导呢？因为导数反映变化快慢。';
const TAIL = '我们来看这道题，最后布置作业。';
const TEXT_FAKE = HEAD + PLACEHOLDER_FAKE + TAIL;
const TEXT_PLAIN = HEAD + PLACEHOLDER_PLAIN + TAIL;

/* 旧口径的等待估算（仅用于回归对照：新口径下它不再产生任何影响） */
function legacyAvgWait(report) {
  const asked = report.questions.asked;
  if (asked === 0) return 0;
  const fake = report.questions.fake_questions;
  const rate = report.speech_rate.chars_per_min;
  return Math.max(
    0.4,
    Math.min(6, Number((3.4 - fake * 1.1 - Math.max(0, rate - 160) / 45).toFixed(1)))
  );
}
function legacyWaitDeduction(report) {
  const w = legacyAvgWait(report);
  return w < 2 ? 10 : w < 3 ? 5 : 0;
}

/* ---------- 1. 普通分析：平均等待不可测量 ---------- */

test('analyzeRule：questions.avg_wait_sec 恒为 null，source/wait_source 恒为 unmeasured', () => {
  const r = analyzeRule({ transcript: TEXT_FAKE, subject: '函数单调性', durationSec: 240 });
  assert.strictEqual(r.questions.avg_wait_sec, null, 'avg_wait_sec 必须为 null');
  assert.strictEqual(r.questions.source, 'unmeasured');
  assert.strictEqual(r.questions.wait_source, 'unmeasured');
  assert.ok(r.questions.note.indexOf('无法测量') !== -1, 'note 必须说明不可测量');
  // 字段保留（不删），避免旧代码取到 undefined
  assert.ok(Object.prototype.hasOwnProperty.call(r.questions, 'avg_wait_sec'));
  // 计数类字段仍是真实计算值
  assert.strictEqual(r.questions.asked, 2);
  assert.strictEqual(r.questions.fake_questions, 1);
  assert.strictEqual(r.questions.genuine_questions, 1);
});

test('analyzeRule：分数不再随"等待秒数"变化，评分里没有任何等待项', () => {
  const a = analyzeRule({ transcript: TEXT_FAKE, subject: '函数单调性', durationSec: 240 });
  const b = analyzeRule({ transcript: TEXT_PLAIN, subject: '函数单调性', durationSec: 240 });

  // 构造前提：旧口径下这两段的等待估算确实不同（会拉开 5 分差）
  assert.notStrictEqual(
    legacyWaitDeduction(a),
    legacyWaitDeduction(b),
    '构造前提失效：两段讲稿在旧口径下应产生不同的等待扣分'
  );

  // 新口径：等待秒数不参与评分 → 分数完全一致
  assert.strictEqual(a.overall_score, b.overall_score, '等待秒数不得再影响总分');

  // 且分数可被"非等待项"完整解释（等待项已从公式中移除）
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const expect = clamp(
    Math.round(
      clamp(
        100 -
          clamp((Math.abs(a.speech_rate.chars_per_min - 140) - 20) / 10 * 2, 0, 15) -
          Math.min(15, Math.floor(a.filler_words.total / 5) * 2) -
          (a.questions.asked === 0 ? 15 : a.questions.genuine_questions === 0 ? 8 : 0) -
          clamp((70 - a.knowledge.cover_percent) / 2, 0, 15),
        35,
        98
      )
    ),
    35,
    98
  );
  assert.strictEqual(a.overall_score, expect, '总分必须等于不含等待项的评分公式');
});

test('analyzeRule：不再生成"提问后不留白"这类基于推断秒数的建议', () => {
  const r = analyzeRule({ transcript: TEXT_FAKE, subject: '函数单调性', durationSec: 240 });
  r.suggestions.forEach((s) => {
    assert.ok(s.title.indexOf('留白') === -1, '不应再出现基于推断秒数的「留白」建议：' + s.title);
    assert.ok(!/留白[^。]*\d+(\.\d+)?\s*秒/.test(s.detail), '建议里不应出现等待秒数：' + s.detail);
  });
  // 伪提问本身的建议仍在（那是文本可判定的事实）
  assert.ok(r.suggestions.some((s) => s.title.indexOf('伪提问') !== -1));
});

/* ---------- 2. 危险瞬间：不再引用等待秒数 ---------- */

test('dangerMoments：含确认式提问的讲稿产出「确认式提问」，且引用里没有任何秒数', async (t) => {
  offline(t);
  const analysis = analyzeRule({ transcript: TEXT_FAKE, subject: '函数单调性', durationSec: 240 });
  const r = await engine.dangerMoments({ transcript: TEXT_FAKE, analysis });
  assert.strictEqual(r.engine, 'rule');
  const hit = r.moments.find((m) => m.type === '确认式提问');
  assert.ok(hit, '应产出 type=确认式提问 的危险瞬间，实际：' + JSON.stringify(r.moments));
  assert.ok(hit.quote.indexOf('秒') === -1, 'quote 不得包含秒数：' + hit.quote);
  assert.ok(!/\d+(\.\d+)?\s*秒/.test(hit.quote), 'quote 不得包含秒数：' + hit.quote);
  assert.ok(hit.reason.indexOf('秒') === -1, 'reason 不得包含秒数：' + hit.reason);
  // 不再产出旧口径的「伪提问」类型
  assert.ok(!r.moments.some((m) => m.type === '伪提问'));
});

test('dangerMoments：分析结果缺 fake_questions 字段时，从讲稿现场数（兼容演示/历史数据）', async (t) => {
  offline(t);
  // 旧形状：只有 total / authentic / avg_wait_sec，没有 fake_questions
  const legacyAnalysis = {
    questions: { asked: 2, avg_wait_sec: 1.1, genuine_questions: 0, total: 2, authentic: 0 },
  };
  const r = await engine.dangerMoments({ transcript: TEXT_FAKE, analysis: legacyAnalysis });
  const hit = r.moments.find((m) => m.type === '确认式提问');
  assert.ok(hit, '缺字段时也应产出「确认式提问」，实际：' + JSON.stringify(r.moments));
  assert.ok(hit.quote.indexOf('秒') === -1, 'quote 不得包含秒数：' + hit.quote);
});

/* ---------- 3. 专项练习：等待维度改用文本证据 ---------- */
test('drillRule：question_wait 仍能产出有限分数，规范维度 key 不变', () => {
  const r = drillRule({
    skill: 'question_wait',
    transcript: TEXT_FAKE + '请大家想一想，为什么要求导？（停顿，默数三秒）李同学，你说说看。',
    durationSec: 180,
  });
  assert.ok(Number.isFinite(r.score), 'score 必须是有限数字，实际：' + r.score);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.deepStrictEqual(
    r.dimensions.map((d) => d.key).slice().sort(),
    ['fake_question', 'question_design', 'wait_marker', 'wait_time'],
    '规范维度 key 是冻结契约，不能变'
  );
  r.dimensions.forEach((d) => {
    assert.ok(Number.isFinite(d.score), '维度分数必须是有限数字：' + d.key);
    assert.ok(!/留白[^。]*\d+(\.\d+)?\s*秒/.test(d.evidence), '维度依据里不得出现等待秒数：' + d.evidence);
  });
});

test('drillRule：metrics.avg_wait_sec 为 null 且带 wait_source=unmeasured', () => {
  const r = drillRule({ skill: 'question_wait', transcript: TEXT_FAKE, durationSec: 180 });
  assert.strictEqual(r.metrics.avg_wait_sec, null, '不得输出看起来像实测的等待秒数');
  assert.strictEqual(r.metrics.wait_source, 'unmeasured');
  assert.ok(r.source_note.indexOf('不可测量') !== -1, 'source_note 必须说明等待不可测量');
  // 计数类指标仍是真实计算值
  assert.strictEqual(r.metrics.questions_asked, 2);
  assert.strictEqual(r.metrics.fake_questions, 1);
});

test('drillRule：等待维度随"提问后写了等待标记"变化（文本证据生效，不是秒数）', () => {
  const withMarker = drillRule({
    skill: 'question_wait',
    transcript: '同学们好，今天讲函数的单调性。为什么要求导呢？因为导数反映变化快慢。' +
      '李同学，你说说看。（停顿，默数三秒）大家想一想，为什么导数能判断增减？',
    durationSec: 180,
  });
  const withoutMarker = drillRule({
    skill: 'question_wait',
    transcript: '同学们好，今天讲函数的单调性。为什么要求导呢？因为导数反映变化快慢。' +
      '李同学，你说说看。公式就是这样。',
    durationSec: 180,
  });
  const waitOf = (r) => r.dimensions.find((d) => d.key === 'wait_time').score;
  assert.ok(
    waitOf(withMarker) > waitOf(withoutMarker),
    '写了等待标记的讲稿，等待维度得分必须更高（实际 ' + waitOf(withMarker) + ' vs ' + waitOf(withoutMarker) + '）'
  );
});

/* ---------- 4. 热力图：逐次文本推断 + 不可测量用 null ---------- */

test('heatmap：无提问讲稿的 moments 为空数组、average_sec 为 null（不是 0）', async (t) => {
  offline(t);
  const r = await classroomMetrics({
    transcript: '同学们好，今天我们讲函数的单调性。第一步，求导。导数反映变化快慢。最后布置作业。',
    subject: '函数单调性',
  });
  assert.strictEqual(r.engine, 'rule');
  // 新契约：没有提问就没有可测对象 —— 空数组，不伪造条目
  assert.deepStrictEqual(r.wait_moments, [], '无提问时不得伪造任何条目');
  assert.deepStrictEqual(r.wait_metrics.moments, []);
  assert.strictEqual(r.wait_metrics.average_sec, null, '无有效值时 average_sec 必须是 null');
  assert.notStrictEqual(r.wait_metrics.average_sec, 0, 'average_sec 不能是 0');
  // 顶层口径：逐次等待是文本推断，且说明写清
  assert.strictEqual(r.wait_source, 'text-heuristic');
  assert.ok(r.wait_note.indexOf('不是音频时间戳实测值') !== -1, 'wait_note 必须说明不是实测值');
});

test('heatmap：有提问时逐条保留推断值，但每条都带来源标记', async (t) => {
  offline(t);
  const r = await classroomMetrics({
    transcript: '同学们好，今天讲函数的单调性。李同学，你说说为什么要先求导？大家想一想。' +
      '因为导数反映变化快慢。听懂了吗？',
    subject: '函数单调性',
  });
  assert.ok(r.wait_moments.length > 0);
  r.wait_moments.forEach((m) => {
    assert.strictEqual(m.source, 'text-heuristic', '每条都必须自曝来源');
    assert.ok(m.wait_sec === null || (m.wait_sec >= 0 && m.wait_sec <= 10));
  });
  assert.ok(r.wait_moments.some((m) => typeof m.wait_sec === 'number'), '有提问时应保留逐次推断值');
});

/* ---------- 4b. 规则分支的问句判定（切句丢问号导致的误判） ---------- */

test('heatmap：规则分支能识别"点名+无问号语气"的问句，不误判为「整段未检测到提问」', async (t) => {
  offline(t);
  const r = await classroomMetrics({
    transcript: '同学们好，今天我们学习勾股定理。李同学，你说说这一步为什么这样设？然后我们来看这个公式。',
    subject: '勾股定理',
  });
  assert.strictEqual(r.engine, 'rule');
  assert.ok(r.wait_moments.length > 0, '有问句的讲稿不能被判成「整段未检测到提问」');
  const first = r.wait_moments[0];
  assert.ok(first.quote.indexOf('李同学') !== -1, '首条 quote 应含「李同学」，实际：' + first.quote);
  assert.ok(first.quote.indexOf('整段未检测到提问') === -1, '首条不应是兜底条目');
  assert.ok(typeof first.wait_sec === 'number', '识别到问句后必须给出推断的等待秒数');
  assert.strictEqual(first.wait_sec, 2.5, '点名规则不变：应为 2.5 秒');
  assert.strictEqual(first.source, 'text-heuristic');
  assert.strictEqual(r.wait_metrics.source, 'text-heuristic');
  assert.strictEqual(r.wait_moments, r.wait_metrics.moments, '兼容字段必须指向同一份数组');
});

test('heatmap：真的没有问句时，规则分支产出空数组（不伪造条目）且 average_sec 为 null', async (t) => {
  offline(t);
  const r = await classroomMetrics({
    transcript: '同学们好，今天我们学习勾股定理。然后我们来看这个公式，就是 a 平方加 b 平方等于 c 平方。',
    subject: '勾股定理',
  });
  assert.strictEqual(r.wait_moments.length, 0, '不应有任何伪造条目，实际：' + JSON.stringify(r.wait_moments));
  assert.deepStrictEqual(r.wait_metrics.moments, [], '无提问时 moments 是空数组');
  assert.strictEqual(r.wait_metrics.average_sec, null, '无有效值时 average_sec 必须是 null');
  assert.notStrictEqual(r.wait_metrics.average_sec, 0, 'average_sec 不能是 0');
});

test('heatmap：LLM 分支缺 wait_sec 时规整为 null（不是默认 1 秒）', async (t) => {
  offline(t);
  // 桩掉大模型调用：heatmap 通过 ai.hasKey() / ai.chat() 走 LLM 分支
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      wait_moments: [
        { quote: '李同学，你说说为什么这样设', wait_sec: 2.5, reaction: '学生接住了' },
        { quote: '这个结论大家记住了吗', reaction: '模型没给秒数' },
      ],
      time_allocation: { teacher: 20, student: 10, interaction: 5, transition: 5 },
      segments: [
        { phase: '导入', script: '导入稿', notes: [] },
        { phase: '新授', script: '新授稿', notes: [] },
        { phase: '互动', script: '互动稿', notes: [] },
        { phase: '小结', script: '小结稿', notes: [] },
      ],
    });
  t.after(() => {
    ds.hasKey = savedHasKey;
    ds.chat = savedChat;
  });
  const r = await classroomMetrics({ transcript: TEXT_FAKE, subject: '函数单调性' });
  assert.strictEqual(r.engine, 'llm');
  assert.strictEqual(r.wait_moments.length, 2);
  assert.strictEqual(r.wait_moments[0].wait_sec, 2.5, '模型给了值就保留');
  assert.strictEqual(
    r.wait_moments[1].wait_sec,
    null,
    '缺 wait_sec 必须规整为 null，不能塞默认 1 秒'
  );
  r.wait_moments.forEach((m) => assert.strictEqual(m.source, 'model-inference'));
  assert.strictEqual(r.wait_source, 'model-inference');
  assert.strictEqual(r.wait_metrics.source, 'model-inference');
});

/* ---------- 5. 导出：提问行不再出现秒数 ---------- */

test('export：提问卡片用「文本提问」，且不输出任何等待秒数', () => {
  const html = buildExportHtml(
    analyzeRule({ transcript: TEXT_FAKE, subject: '函数单调性', durationSec: 240 }),
    { subject: '函数单调性', grade: '高一' }
  );
  assert.ok(html.indexOf('文本提问') !== -1, '提问卡片标题应为「文本提问」');
  assert.ok(html.indexOf('候选思考题') !== -1);
  assert.ok(html.indexOf('平均等待') === -1, '导出里不得出现「平均等待」');
  assert.ok(!/平均[^。]*\d+(\.\d+)?\s*秒/.test(html), '导出里不得出现等待秒数');
});
