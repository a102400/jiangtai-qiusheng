'use strict';

/**
 * intro_design 语义切分回归测试
 * ------------------------------------------------------------------
 * 锁定「导入段」不再按字数盲切前 15%，而是沿句子边界找到
 * 「导入 → 新授」的语义断点（命中 INTRO_END_MARKERS 即止）。
 */

const test = require('node:test');
const assert = require('node:assert');

const { extractIntroSegment, INTRO_END_MARKERS } = require('../lib/drill.js');

test('语义切分：在「进入新课」信号处截断，导入段不含新授内容', () => {
  const t = '同学们，上节课我们学习了分数的加减法。今天我们来学习分数的乘除法。首先，回忆一下通分的方法。';
  const seg = extractIntroSegment(t);
  // 导入段应包含开头那句复习衔接
  assert.ok(seg.text.indexOf('上节课我们学习了分数的加减法') !== -1, '导入段应包含复习衔接句');
  // 命中「今天我们来学习」断点，新授内容不计入导入
  assert.ok(seg.text.indexOf('今天我们来学习') === -1, '导入段不应包含新授开始句');
  assert.ok(seg.text.indexOf('通分的方法') === -1, '导入段不应包含新授内容');
  assert.strictEqual(seg.sentences.length, 1, '导入段只取断点前的句子');
});

test('语义切分：上来就讲定义（无情境）应得到很短/空的导入段，而非盲切 15%', () => {
  const t = '今天我们学习勾股定理。勾股定理说的是直角三角形两直角边平方和等于斜边平方。下面我们来看例题。';
  const seg = extractIntroSegment(t);
  // 第一句即含「今天我们学习」断点 → 导入段为空，体现「直接开讲」的低导入分
  assert.strictEqual(seg.text, '', '无情境直接开讲时导入段应为空（不伪造 15% 内容）');
  assert.strictEqual(seg.sentences.length, 0);
});

test('语义切分：全文无断点时导入段有上界（不超过 8 句且 ≤35% 字数）', () => {
  const one = '这是导入环节的内容。';
  const t = new Array(12).fill(one).join('');
  const seg = extractIntroSegment(t);
  // 包含首句
  assert.ok(seg.text.indexOf('这是导入环节的内容。') !== -1, '应至少包含首句');
  // 受上界约束，不应把整篇都算成导入
  assert.ok(seg.sentences.length <= 8, '导入段句子数受 8 句上界约束，实际：' + seg.sentences.length);
  const bodyLen = t.replace(/\s/g, '').length;
  assert.ok(seg.text.replace(/\s/g, '').length <= Math.round(bodyLen * 0.35) + one.replace(/\s/g, '').length,
    '导入段字数受 35% 上界约束');
  assert.ok(seg.text.indexOf(one.repeat(9)) === -1, '导入段不应覆盖全文');
});

test('INTRO_END_MARKERS 确实是导入 → 新授的断点信号', () => {
  assert.ok(Array.isArray(INTRO_END_MARKERS) && INTRO_END_MARKERS.length > 0);
  assert.ok(INTRO_END_MARKERS.includes('今天我们来学习'));
  assert.ok(INTRO_END_MARKERS.includes('进入新课'));
});

/* ---------------- 长导入回归（此前的真实缺陷） ---------------- */
// 缺陷现象：字数上界按「全文 35%」算，短讲稿里上限比导入本身还短，
// 断点还没到就被字数砍掉，「这是为什么呢 / 大家先猜一猜」这类关键提问整段丢失。
const LONG_INTRO =
  '同学们好。上课之前老师想先问大家一个问题。你们有没有注意过，下雨天走路的时候，裤脚总是先湿？' +
  '这是为什么呢。我们来看看小明昨天的经历。他走过一段积水路面，裤脚湿了一大片。' +
  '可是旁边的高个子同学裤脚却是干的。同样的路，为什么结果不同呢。大家先猜一猜。' +
  '好，进入新课，我们今天要学的是三角形的相似。';

test('语义切分：长导入里有断点时，提问句不被 35% 字数上限提前砍掉', () => {
  const seg = extractIntroSegment(LONG_INTRO);
  assert.ok(seg.text.indexOf('这是为什么呢') !== -1, '断点之前的追问应计入导入段');
  assert.ok(seg.text.indexOf('大家先猜一猜') !== -1, '断点之前的邀请式提问应计入导入段');
  assert.ok(seg.text.indexOf('进入新课') === -1, '断点句本身仍不计入导入');
  assert.ok(seg.sentences.length > 3, '有断点时应走到断点，而不是第 3 句就停：' + seg.sentences.length);
});

test('语义切分：有断点时允许超过 8 句（断点优先于句数上界）', () => {
  const body = new Array(11).fill('这是导入的一个情境描述。').join('');
  const seg = extractIntroSegment(body + '今天我们来学习分数的除法。');
  assert.strictEqual(seg.sentences.length, 11, '有断点时按断点切，不受 8 句上界约束');
});

test('语义切分：「出示情境图」不算新授开始，不应误判断点', () => {
  const t = '老师出示一张情境图。图上有一个小朋友在分蛋糕。大家看看他分得公平吗？进入新课，我们今天学习分数。';
  const seg = extractIntroSegment(t);
  assert.ok(seg.text.indexOf('出示一张情境图') !== -1, '出示情境属于导入动作，不应被当成断点');
  assert.ok(seg.text.indexOf('分得公平吗') !== -1, '导入中的提问应保留');
  assert.ok(seg.text.indexOf('进入新课') === -1, '真正的新课信号仍要截断');
});


/* ---------------- 打分侧联动 ---------------- */
const { scoreIntroDesign } = require('../lib/drill.js');

test('打分联动：长导入修好后，「导入提问」不再被判成 0 分', () => {
  const r = scoreIntroDesign({ transcript: LONG_INTRO });
  const by = Object.fromEntries(r.components.map((c) => [c.key, c.points]));
  assert.strictEqual(by.ask, 20, '导入段里确实有提问，应拿满 20 分');
  assert.strictEqual(by.signal, 50, '有情境/复习/问题信号，应拿满 50 分');
  assert.ok(by.length > 0, '导入写够 40 字，长度项应为正分');
});

test('打分联动：上来就讲定义仍应低分（没有被修宽）', () => {
  const r = scoreIntroDesign({
    transcript: '今天我们学习勾股定理。勾股定理说的是直角三角形两直角边平方和等于斜边平方。'
  });
  const by = Object.fromEntries(r.components.map((c) => [c.key, c.points]));
  assert.ok(by.ask === 0, '无导入则无导入提问');
  assert.ok(by.length < 15, '导入过短不应拿满长度分');
});

test('已知口径缺口：导入占比未参与打分（先锁定现状，改动需产品确认）', () => {
  const seg = extractIntroSegment(LONG_INTRO);
  // 这段讲稿里导入占了九成，当前实现仍给满 15 分长度分 —— 与 SKILLS 里「不超过 15%」的标准不一致
  assert.ok(seg.ratio > 0.8, '该样本导入占比应超过 80%，实际 ' + seg.ratio.toFixed(3));
  const r = scoreIntroDesign({ transcript: LONG_INTRO });
  const length = r.components.find((c) => c.key === 'length');
  assert.strictEqual(length.points, 15, '现状：只看绝对字数，不看占比');
});
