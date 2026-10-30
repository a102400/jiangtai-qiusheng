'use strict';

/**
 * 时间分配（time_allocation）的「不伪造」契约
 * ------------------------------------------------------------------
 * 遗留待办 #3 的原话是：「无提问讲稿下可能退化成全 0，应返回无法测量」。
 * 这里把四种会让界面出现假数据的路径全部钉住：
 *   1. 规则分支（无 Key / 模型失败）—— 没有任何计时依据 → null
 *   2. 模型返回全 0 —— 等于什么都没测到 → null（不是「教师 0 分钟」）
 *   3. 模型漏字段 —— 不能空推 → null
 *   4. 模型给了可用值 —— 必须带 source=text-heuristic，界面才有资格说这是推断值
 * 以及两条前端契约：饼图在 null/全 0 时显示「未测量」，有值时标出来源。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { classroomMetrics } = require('../lib/heatmap.js');

/* 一段「完全没有提问」的讲稿：正是会把估算退化成全 0 的那种输入 */
const NO_QUESTION_TRANSCRIPT =
  '同学们好，今天我们学习勾股定理。两条直角边是 a 和 b，斜边是 c。' +
  '那么 a 平方加 b 平方等于 c 平方。这个公式很重要，考试一定会考。' +
  '大家把它记在笔记本上。我们再看一个例题，把数字代进去算一遍。' +
  '最后小结一下，今天的重点是记住这个公式和它的适用条件。作业是课本第 45 页。';

const MULTI_QUESTION_TRANSCRIPT =
  '同学们好，今天我们学习勾股定理。先看这个直角三角形，两条直角边是 a 和 b，斜边是 c。' +
  '李同学，你说说看，为什么这样拼？大家想一想，如果条件反过来还成立吗？' +
  '最后我们小结一下今天的公式。';

function offline(t) {
  const savedKey = process.env.AI_API_KEY;
  const savedDs = process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    if (savedKey !== undefined) process.env.AI_API_KEY = savedKey;
    if (savedDs !== undefined) process.env.DEEPSEEK_API_KEY = savedDs;
  });
}

/* 让模型分支返回指定 JSON（其余字段用一个合法骨架兜住） */
function withModel(t, payload) {
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  ds.chat = async () => JSON.stringify(payload);
  t.after(() => {
    ds.hasKey = savedHasKey;
    ds.chat = savedChat;
  });
}

const SEGMENTS = [
  { phase: '导入', script: '导入稿', notes: [] },
  { phase: '新授', script: '新授稿', notes: [] },
  { phase: '互动', script: '互动稿', notes: [] },
  { phase: '小结', script: '小结稿', notes: [] },
];

/* ---------------- 1. 后端：四种情况 ---------------- */

test('规则分支：无提问讲稿 → time_allocation 为 null（不是全 0）', async (t) => {
  offline(t);
  const r = await classroomMetrics({ transcript: NO_QUESTION_TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.time_allocation, null,
    '没有计时依据时必须给 null，界面才显示「未测量」；给全 0 会被读成「这节课 0 分钟」');
});

test('模型返回全 0：按「未测量」处理，不画零值饼图', async (t) => {
  offline(t);
  withModel(t, {
    wait_moments: [],
    time_allocation: { teacher: 0, student: 0, interaction: 0, transition: 0 },
    segments: SEGMENTS,
  });
  const r = await classroomMetrics({ transcript: NO_QUESTION_TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'llm', '前置条件：确实走了模型分支');
  assert.strictEqual(r.time_allocation, null, '全 0 不是有效测量值，必须归为 null');
});

test('模型漏掉 time_allocation：不能拿缺席的值当 0', async (t) => {
  offline(t);
  withModel(t, {
    wait_moments: [],
    segments: SEGMENTS,
  });
  const r = await classroomMetrics({ transcript: NO_QUESTION_TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'llm');
  assert.strictEqual(r.time_allocation, null);
});

test('模型返回非法值（负 / 非数字）：夹到 0 后若全为 0 仍然判未测量', async (t) => {
  offline(t);
  withModel(t, {
    wait_moments: [],
    time_allocation: { teacher: -20, student: '很多', interaction: null, transition: undefined },
    segments: SEGMENTS,
  });
  const r = await classroomMetrics({ transcript: NO_QUESTION_TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.time_allocation, null);
});

test('模型给了可用值：保留四个维度并标注 source=text-heuristic', async (t) => {
  offline(t);
  withModel(t, {
    wait_moments: [{ quote: '李同学，你说说看', wait_sec: 2.5, reaction: '接住了' }],
    time_allocation: { teacher: 20, student: 10, interaction: 6, transition: 4 },
    segments: SEGMENTS,
  });
  const r = await classroomMetrics({ transcript: MULTI_QUESTION_TRANSCRIPT, subject: '勾股定理' });
  assert.deepStrictEqual(
    { t: r.time_allocation.teacher, s: r.time_allocation.student, i: r.time_allocation.interaction, tr: r.time_allocation.transition },
    { t: 20, s: 10, i: 6, tr: 4 }
  );
  assert.strictEqual(r.time_allocation.source, 'text-heuristic',
    '推断值必须自带来源，前端才有依据告诉用户这不是实测计时');
});

/* ---------------- 2. 前端：饼图两种口径 ---------------- */

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('前端：null / 全 0 时显示「未测量」，且不计算任何百分比', () => {
  const start = APP.indexOf('function renderPie(alloc)');
  assert.ok(start !== -1, 'app.js 里必须有 renderPie');
  const body = APP.slice(start, APP.indexOf('/* 17.', start));

  assert.ok(body.indexOf('if (!total)') !== -1, 'total 为 0（含 null）必须走未测量分支');
  assert.ok(body.indexOf('时间分配未测量') !== -1, '未测量文案必须存在');
  // 未测量分支必须在画弧之前 return：否则会画出一圈 0 长度的弧 + 一个「0 分钟」中心字
  assert.ok(body.indexOf('if (!total)') < body.indexOf('items.forEach'),
    '未测量分支必须先 return，不能先画图再提示');
});

test('前端：有值时标出「按文本推断，非实测计时」', () => {
  const start = APP.indexOf('function renderPie(alloc)');
  const body = APP.slice(start, APP.indexOf('/* 17.', start));
  assert.ok(body.indexOf('非实测课堂计时') !== -1,
    '分钟数是模型按文本推断的，图上必须写清楚，不能让人当成真实课时数据');
});
