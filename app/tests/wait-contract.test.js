'use strict';

/**
 * wait_metrics 统一等待指标契约测试
 * ------------------------------------------------------------------
 * 背景：「等待时间」此前有两套来源（/api/analyze 的平均等待、/api/heatmap 的逐次等待），
 * 各自实现、各自表述，用户容易被误导。本批把等待值收敛成唯一字段 wait_metrics，
 * 并要求每个值都自曝来源。
 *
 * 本文件锁死七条口径：
 *   1. 有问号的讲稿 → 规则推断能产出 moments（问句判定不能因为切句丢标点而失效）；
 *   2. 真无问句 → moments 为空数组、average_sec 为 null（不伪造 0 秒片段）；
 *   3. 陈述句不被误判（「那么」「同学们好」都不算问句）；
 *   4. 模型缺 wait_sec → null（不塞默认 1 秒）；
 *   5. summarizeWaitMoments：空数组 → null，有值 → 平均值保留一位小数；
 *   6. 一致性：/api/analyze 与 /api/heatmap 的规则分支给出逐字相同的 moments；
 *   7. 上一批口径不被破坏：questions.avg_wait_sec 恒为 null、source 恒为 unmeasured。
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  buildTextWaitMetrics,
  normalizeModelWaitMoments,
  summarizeWaitMoments,
} = require('../lib/wait-metrics.js');
const { analyzeRule } = require('../lib/analyzer.js');
const { classroomMetrics } = require('../lib/heatmap.js');

/* 离线确定性：不允许走大模型分支（否则结果依赖网络与密钥） */
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

/* 三段讲稿 */
const TEXT_WITH_QUESTION =
  '同学们好，今天我们讲函数的单调性。李同学，你说说这一步为什么这样设？然后我们来看这个公式。';
const TEXT_NO_QUESTION =
  '同学们好，今天我们学习函数的单调性。那么，先求出导，再看导数的符号，最后判断函数的增减性。';
const TEXT_STATEMENT_ONLY =
  '同学们好，那么我们今天开始上课。这节课我们讲三角函数的图像与性质，先从单位圆上的点出发。';

/* ---------- 1. 有问号的讲稿能产出 moments ---------- */

test('buildTextWaitMetrics：含问号的讲稿能产出 moments，quote 保留问号且含点名', () => {
  const m = buildTextWaitMetrics(TEXT_WITH_QUESTION);
  assert.ok(Array.isArray(m.moments), 'moments 必须是数组');
  assert.ok(m.moments.length > 0, '有问号的讲稿必须产出 moments，实际：' + JSON.stringify(m.moments));
  const first = m.moments[0];
  assert.ok(first.quote.indexOf('李同学') !== -1, 'quote 应含「李同学」，实际：' + first.quote);
  assert.ok(/[?？]/.test(first.quote), 'quote 必须保留问号，实际：' + first.quote);
  assert.strictEqual(typeof first.wait_sec, 'number', '识别到问句后必须给出推断的等待秒数');
  assert.strictEqual(first.source, 'text-heuristic', '每条都必须自曝来源');
  assert.strictEqual(m.source, 'text-heuristic');
  assert.strictEqual(typeof m.average_sec, 'number', '有问句时 average_sec 必须有值');
  assert.ok(m.note.indexOf('不是音频时间戳实测值') !== -1, 'note 必须说明不是实测值');
});

/* ---------- 2. 真无问句 → 空数组 + null（不是 0） ---------- */

test('buildTextWaitMetrics：真无问句的讲稿 → moments 为空数组、average_sec 为 null', () => {
  const m = buildTextWaitMetrics(TEXT_NO_QUESTION);
  assert.deepStrictEqual(m.moments, [], '无提问时不得伪造任何条目，实际：' + JSON.stringify(m.moments));
  assert.strictEqual(m.average_sec, null, '无有效值时 average_sec 必须是 null，不能是 0');
  assert.notStrictEqual(m.average_sec, 0, 'average_sec 不能是 0（会被读成「等了 0 秒」）');
  assert.strictEqual(m.source, 'text-heuristic');
});

/* ---------- 3. 陈述句不被误判 ---------- */

test('buildTextWaitMetrics：含「那么」「同学们好」的陈述句不被误判为问句', () => {
  const m = buildTextWaitMetrics(TEXT_STATEMENT_ONLY);
  assert.deepStrictEqual(
    m.moments,
    [],
    '陈述句不得被判成问句，实际：' + JSON.stringify(m.moments)
  );
  assert.strictEqual(m.average_sec, null);
  // 单独再锁两条最容易被误判的句子
  assert.deepStrictEqual(buildTextWaitMetrics('那么接下来我们讲第二个例子。').moments, []);
  assert.deepStrictEqual(buildTextWaitMetrics('大家好，我们今天开始上课。').moments, []);
});

/* ---------- 4. 模型缺 wait_sec → null（不是 1） ---------- */

test('normalizeModelWaitMoments：缺 wait_sec 的条目 → wait_sec 为 null（不是 1）', () => {
  const m = normalizeModelWaitMoments([
    { quote: '李同学，你说说为什么这样设', wait_sec: 2.5, reaction: '学生接住了' },
    { quote: '这个结论大家记住了吗', reaction: '模型没给秒数' },
  ]);
  assert.strictEqual(m.moments.length, 2);
  assert.strictEqual(m.moments[0].wait_sec, 2.5, '模型给了值就保留');
  assert.strictEqual(
    m.moments[1].wait_sec,
    null,
    '缺 wait_sec 必须规整为 null，不能塞默认 1 秒（实际：' + m.moments[1].wait_sec + '）'
  );
  m.moments.forEach((x) => assert.strictEqual(x.source, 'model-inference', '每条都必须自曝来源'));
  assert.strictEqual(m.source, 'model-inference');
  // 值要夹在 0–10
  const clamped = normalizeModelWaitMoments([{ quote: 'x', wait_sec: 99 }, { quote: 'y', wait_sec: -3 }]);
  assert.strictEqual(clamped.moments[0].wait_sec, 10);
  assert.strictEqual(clamped.moments[1].wait_sec, 0);
});

/* ---------- 5. summarizeWaitMoments ---------- */

test('summarizeWaitMoments：空数组 → average_sec 为 null；有值 → 平均值保留一位小数', () => {
  const empty = summarizeWaitMoments([], 'text-heuristic', '说明');
  assert.strictEqual(empty.average_sec, null, '空数组必须返回 null');
  assert.deepStrictEqual(empty.moments, []);

  const one = summarizeWaitMoments([{ quote: 'a', wait_sec: 0.8 }], 'text-heuristic', '说明');
  assert.strictEqual(one.average_sec, 0.8);

  const many = summarizeWaitMoments(
    [
      { quote: 'a', wait_sec: 1 },
      { quote: 'b', wait_sec: 2 },
      { quote: 'c', wait_sec: 3.4 },
    ],
    'text-heuristic',
    '说明'
  );
  assert.strictEqual(many.average_sec, 2.1, '6.4 / 3 = 2.133… → 2.1');

  // 缺值的条目不参与平均（null 不能被当成 0 拉低均值）
  const withNull = summarizeWaitMoments(
    [
      { quote: 'a', wait_sec: 2 },
      { quote: 'b', wait_sec: null },
    ],
    'text-heuristic',
    '说明'
  );
  assert.strictEqual(withNull.average_sec, 2, 'null 不得按 0 计入平均');
});

/* ---------- 6. 一致性：/api/analyze 与 /api/heatmap 规则分支逐字相同 ---------- */

test('一致性：analyzeRule 与 heatmap 规则分支的 wait_metrics.moments 逐字相同', async (t) => {
  offline(t);
  const analysis = analyzeRule({
    transcript: TEXT_WITH_QUESTION,
    subject: '函数单调性',
    durationSec: 240,
  });
  const heat = await classroomMetrics({
    transcript: TEXT_WITH_QUESTION,
    subject: '函数单调性',
  });
  assert.strictEqual(heat.engine, 'rule', '本测试必须走规则分支');
  assert.deepStrictEqual(
    analysis.wait_metrics.moments,
    heat.wait_metrics.moments,
    '同一讲稿在两处必须给出逐字相同的 moments'
  );
  assert.deepStrictEqual(analysis.wait_metrics, heat.wait_metrics, '整个 wait_metrics 必须一致');

  // 无问句时也必须一致（都是空数组 + null）
  const a2 = analyzeRule({ transcript: TEXT_NO_QUESTION, subject: '函数单调性', durationSec: 240 });
  const h2 = await classroomMetrics({ transcript: TEXT_NO_QUESTION, subject: '函数单调性' });
  assert.deepStrictEqual(a2.wait_metrics.moments, h2.wait_metrics.moments);
  assert.deepStrictEqual(a2.wait_metrics.moments, []);
  assert.strictEqual(a2.wait_metrics.average_sec, null);
  assert.strictEqual(h2.wait_metrics.average_sec, null);
});

/* ---------- 7. 上一批口径不被破坏 ---------- */

test('analyzeRule：questions.avg_wait_sec 恒为 null、source 恒为 unmeasured', () => {
  const r = analyzeRule({
    transcript: TEXT_WITH_QUESTION,
    subject: '函数单调性',
    durationSec: 240,
  });
  assert.strictEqual(r.questions.avg_wait_sec, null, 'avg_wait_sec 必须为 null');
  assert.strictEqual(r.questions.source, 'unmeasured');
  assert.strictEqual(r.questions.wait_source, 'unmeasured');
  // 新字段与旧字段并存，不互相覆盖
  assert.ok(r.wait_metrics, '必须带 wait_metrics');
  assert.strictEqual(r.wait_metrics.average_sec, 2.5, '规则版 average_sec 应为推断值');
});

/* ---------- 8. 契约形状与来源标记 ---------- */

test('契约形状：wait_metrics 恰为 {moments, average_sec, source, note}，每条 moment 都带 source', () => {
  const m = buildTextWaitMetrics(TEXT_WITH_QUESTION);
  assert.deepStrictEqual(
    Object.keys(m).sort(),
    ['average_sec', 'moments', 'note', 'source'],
    'wait_metrics 的键集合是冻结契约'
  );
  m.moments.forEach((x) => {
    assert.deepStrictEqual(
      Object.keys(x).sort(),
      ['quote', 'reaction', 'source', 'wait_sec'],
      'moment 的键集合是冻结契约'
    );
    assert.ok(typeof x.source === 'string' && x.source.length > 0, '每个值都必须带 source');
  });
});

test('预留时间戳口径：summarizeWaitMoments 支持 source=timestamp（本批不产出该值）', () => {
  const m = summarizeWaitMoments([{ quote: 'a', wait_sec: 3 }], 'timestamp', '时间戳实测');
  assert.strictEqual(m.source, 'timestamp');
  assert.strictEqual(m.moments[0].source, 'timestamp');
  assert.strictEqual(m.average_sec, 3);
});

/* ---------- 9. heatmap 的兼容字段 ---------- */

test('heatmap 规则分支：wait_metrics 与旧字段并存，wait_moments 指向同一份数组', async (t) => {
  offline(t);
  const r = await classroomMetrics({ transcript: TEXT_WITH_QUESTION, subject: '函数单调性' });
  assert.ok(r.wait_metrics, '必须带 wait_metrics');
  assert.strictEqual(r.wait_moments, r.wait_metrics.moments, '兼容字段必须指向同一份数组');
  assert.strictEqual(r.wait_source, r.wait_metrics.source, '旧 wait_source 跟随新来源');
  assert.strictEqual(r.wait_note, r.wait_metrics.note, '旧 wait_note 跟随新说明');
  assert.strictEqual(r.wait_source, 'text-heuristic');
});

test('heatmap 规则分支：无提问时兼容字段是空数组（前端必须能处理空数组）', async (t) => {
  offline(t);
  const r = await classroomMetrics({ transcript: TEXT_NO_QUESTION, subject: '函数单调性' });
  assert.deepStrictEqual(r.wait_moments, [], '无提问时兼容字段也是空数组');
  assert.strictEqual(r.wait_metrics.average_sec, null);
});

test('heatmap LLM 分支：wait_metrics.source 为 model-inference，缺值仍为 null', async (t) => {
  offline(t);
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
  const r = await classroomMetrics({ transcript: TEXT_WITH_QUESTION, subject: '函数单调性' });
  assert.strictEqual(r.engine, 'llm');
  assert.strictEqual(r.wait_metrics.source, 'model-inference');
  assert.strictEqual(r.wait_moments, r.wait_metrics.moments);
  assert.strictEqual(r.wait_moments[1].wait_sec, null, '缺值必须为 null');
  // 模型分支的平均值只对有值的条目求平均（2.5 / 1 = 2.5）
  assert.strictEqual(r.wait_metrics.average_sec, 2.5);
});

/* ---------- 10. 回归：单字「等」曾把数学句误判成等待信号 ---------- */

/* 「等」必须带上下文：等一等 / 等一下 / 等会 / 稍等 / 等同学 / 等大家 / 等回答。
   「等于」「不等」「等于号」「等于式」是数学词，不能命中等待信号规则。 */
const TEXT_NEXT_IS_EQUALS =
  '同学们好，今天我们学习勾股定理。李同学，你说说这一步为什么这样设？' +
  '然后我们来看这个公式，就是 a 平方加 b 平方等于 c 平方。';
const TEXT_NEXT_IS_WAIT_SIGNAL =
  '同学们好，今天我们讲勾股定理。李同学，你说说这一步为什么这样设？然后我们等一等再继续。';
const TEXT_NEXT_IS_EQUALS_ONLY =
  '同学们好，今天我们讲勾股定理。李同学，你说说这一步为什么这样设？a 加 b 等于 c。';

test('回归：下一句只含数学词「等于」时，不得命中等待信号规则（应为点名 2.5，不是 3）', () => {
  const m = buildTextWaitMetrics(TEXT_NEXT_IS_EQUALS);
  assert.strictEqual(m.moments.length, 1, '应识别出 1 条问句');
  assert.strictEqual(
    m.moments[0].wait_sec,
    2.5,
    '「等于」不是等待信号，必须走点名留白规则 2.5，实际：' + m.moments[0].wait_sec
  );
  assert.notStrictEqual(m.moments[0].wait_sec, 3, '不得被单字「等」误判成 3 秒');
  assert.strictEqual(m.average_sec, 2.5);
});

test('回归：下一句是真等待信号（等一等）时，命中 3 秒规则', () => {
  const m = buildTextWaitMetrics(TEXT_NEXT_IS_WAIT_SIGNAL);
  assert.strictEqual(m.moments.length, 1, '应识别出 1 条问句');
  assert.strictEqual(
    m.moments[0].wait_sec,
    3,
    '「等一等」是等待信号，必须命中 3 秒规则，实际：' + m.moments[0].wait_sec
  );
});

test('回归：下一句只有「等于」这一个数学词时，不产生任何等待条目（无问句 → 空数组）', () => {
  // 断言 1：字面讲稿里没有问句 → 按契约就是空数组 + null（不伪造条目）
  const literal = buildTextWaitMetrics('同学们好。a 加 b 等于 c。');
  assert.deepStrictEqual(literal.moments, [], '无问句时不得伪造条目');
  assert.strictEqual(literal.average_sec, null);

  // 断言 2：把同一句放到问句之后 → 走点名规则（2.5），不得命中 3 秒
  const afterQuestion = buildTextWaitMetrics(TEXT_NEXT_IS_EQUALS_ONLY);
  assert.strictEqual(afterQuestion.moments.length, 1);
  assert.strictEqual(afterQuestion.moments[0].wait_sec, 2.5);
  assert.notStrictEqual(afterQuestion.moments[0].wait_sec, 3, '「等于」不得触发 3 秒规则');
});

test('回归：数学词表里的「等」字一个都不能触发等待信号', () => {
  const mathWords = ['等于', '不等于', '等于号', '等于式', 'a 等于 b', '两边相等'];
  mathWords.forEach((w) => {
    const m = buildTextWaitMetrics('同学们好，今天我们讲勾股定理。李同学，你说说这一步为什么这样设？' + w);
    assert.strictEqual(m.moments.length, 1, '应识别出 1 条问句：' + w);
    assert.notStrictEqual(
      m.moments[0].wait_sec,
      3,
      '数学词「' + w + '」不得触发等待信号规则，实际：' + m.moments[0].wait_sec
    );
  });
});

/* ---------- 11. average_sec 口径必须写在文案里 ---------- */

test('average_sec 口径：note 必须写明「逐条推断值的平均，不是实测平均等待」', () => {
  const t = buildTextWaitMetrics(TEXT_WITH_QUESTION);
  assert.ok(
    t.note.indexOf('average_sec 是逐条推断值的平均') !== -1,
    'note 必须写明 average_sec 是逐条推断值的平均，实际：' + t.note
  );
  assert.ok(t.note.indexOf('不是实测平均等待') !== -1, 'note 必须写明不是实测平均等待');
  assert.ok(t.note.indexOf('不是音频时间戳实测值') !== -1, 'note 必须写明不是实测值');
});

test('LLM 合并分支（桩掉模型）：wait_metrics 仍取规则版，等字回归同样生效', async (t) => {
  offline(t);
  // 本地无 API Key 余额，用桩法走 LLM 分支（参考 tests/wait-metric.test.js 的既有桩法）
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      overall_score: 80,
      summary: '桩返回',
      questions: { asked: 9, avg_wait_sec: 4.2 },
    });
  t.after(() => {
    ds.hasKey = savedHasKey;
    ds.chat = savedChat;
  });
  const engine = require('../lib/engine.js');
  const r = await engine.analyze({
    transcript: TEXT_NEXT_IS_EQUALS,
    subject: '勾股定理',
    durationSec: 240,
  });
  assert.strictEqual(r.engine, 'llm', '本测试必须走 LLM 分支');
  // 合并层以规则版 wait_metrics 为准 → 同样不得被「等于」误判成 3 秒
  assert.strictEqual(r.wait_metrics.moments.length, 1);
  assert.strictEqual(r.wait_metrics.moments[0].wait_sec, 2.5);
  assert.strictEqual(r.wait_metrics.source, 'text-heuristic');
  // 上一批口径不受影响
  assert.strictEqual(r.questions.avg_wait_sec, null);
  assert.strictEqual(r.questions.source, 'unmeasured');
});
