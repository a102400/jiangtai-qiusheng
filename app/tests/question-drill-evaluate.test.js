'use strict';

/**
 * 模块二·专项：/api/question-drill/{student,evaluate} 契约
 * 全部用桩（stub deepseek.hasKey / deepseek.chat），不打真实网络。
 *
 * 核心不变量：缺失 / 非法 / 引用不实 / 模型失败时返回 status:'unavailable'，绝不伪造分数。
 */

const { test } = require('node:test');
const assert = require('node:assert');

const ds = require('../lib/deepseek.js');
const engine = require('../lib/engine.js');

// 合法返回：三个维度顺序固定，引用来自教师原话，分数合法
const VALID = {
  dimensions: [
    { key: 'clear_question_task', score: 2, evidence_quote: '请说说你的思路', feedback: '问题明确' },
    { key: 'expression_space', score: 1, evidence_quote: '', feedback: '稍有引导' },
    { key: 'follow_up_adaptation', score: 0, evidence_quote: '', feedback: '未追问' },
  ],
  summary: '整体偏向直接给答案',
  boundary_note: 'x',
};

function teacherMsgs(extra) {
  return [{ role: 'teacher', content: '请说说你的思路' }].concat(extra || []);
}

test('无 Key → status=unavailable / reason=model-not-configured', async () => {
  ds.hasKey = () => false;
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'model-not-configured');
  assert.deepStrictEqual(r.dimensions, []);
  assert.strictEqual(r.rubric_version, 'question-drill-v1');
  assert.ok(r.boundary_note.includes('不代表已经测得'));
});

test('模型返回 3 个合法维度 → status=complete 且顺序/分数归一化', async () => {
  ds.hasKey = () => true;
  ds.chat = async () => JSON.stringify(VALID);
  const r = await engine.questionDrillEvaluate({
    goal: '提问与追问',
    quote: '为什么',
    messages: teacherMsgs(),
  });
  assert.strictEqual(r.status, 'complete');
  assert.strictEqual(r.reason, undefined);
  assert.strictEqual(r.dimensions.length, 3);
  assert.deepStrictEqual(
    r.dimensions.map((d) => d.key),
    ['clear_question_task', 'expression_space', 'follow_up_adaptation']
  );
  assert.deepStrictEqual(r.dimensions.map((d) => d.score), [2, 1, 0]);
  assert.strictEqual(r.dimensions[0].evidence_quote, '请说说你的思路');
  assert.strictEqual(r.rubric_version, 'question-drill-v1');
});

test('维度数量 != 3 → unavailable(invalid-evaluation-response)', async () => {
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({ dimensions: VALID.dimensions.slice(0, 2), summary: '' });
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'invalid-evaluation-response');
});

test('缺少约定维度之一 → unavailable(invalid-evaluation-response)', async () => {
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      dimensions: [
        { key: 'clear_question_task', score: 1, evidence_quote: '', feedback: '' },
        { key: 'expression_space', score: 1, evidence_quote: '', feedback: '' },
        { key: 'wrong_key', score: 1, evidence_quote: '', feedback: '' },
      ],
      summary: '',
    });
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'invalid-evaluation-response');
});

test('分数超出 0/1/2 → unavailable(invalid-evaluation-response)，不夹逼为 0', async () => {
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      dimensions: [
        { key: 'clear_question_task', score: 3, evidence_quote: '', feedback: '' },
        { key: 'expression_space', score: 1, evidence_quote: '', feedback: '' },
        { key: 'follow_up_adaptation', score: 0, evidence_quote: '', feedback: '' },
      ],
      summary: '',
    });
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'invalid-evaluation-response');
});

test('引用不是教师原话 → unavailable(invalid-evaluation-response)', async () => {
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      dimensions: [
        { key: 'clear_question_task', score: 2, evidence_quote: '这句老师根本没说过', feedback: '' },
        { key: 'expression_space', score: 1, evidence_quote: '', feedback: '' },
        { key: 'follow_up_adaptation', score: 0, evidence_quote: '', feedback: '' },
      ],
      summary: '',
    });
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'invalid-evaluation-response');
});

test('chat 抛错（限流/欠费）→ unavailable(evaluation-request-failed)', async () => {
  ds.hasKey = () => true;
  ds.chat = async () => {
    throw Object.assign(new Error('rate'), { code: 'rate_limit_exceeded', status: 429 });
  };
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'evaluation-request-failed');
});

test('chat 返回非 JSON → extractJson 为空 → unavailable(invalid-evaluation-response)', async () => {
  ds.hasKey = () => true;
  ds.chat = async () => '抱歉我无法完成';
  const r = await engine.questionDrillEvaluate({ messages: teacherMsgs() });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'invalid-evaluation-response');
});

test('无教师发言 → unavailable(no-teacher-messages)，不调用模型', async () => {
  let called = false;
  ds.hasKey = () => true;
  ds.chat = async () => { called = true; return JSON.stringify(VALID); };
  const r = await engine.questionDrillEvaluate({ messages: [{ role: 'student', content: '我不会' }] });
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'no-teacher-messages');
  assert.strictEqual(called, false);
});

test('messages 缺省/非法不抛错，无教师发言 → unavailable(no-teacher-messages)', async () => {
  ds.hasKey = () => true;
  let called = false;
  ds.chat = async () => { called = true; return JSON.stringify(VALID); };
  const r = await engine.questionDrillEvaluate({});
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.reason, 'no-teacher-messages');
  assert.deepStrictEqual(r.dimensions, []);
  assert.strictEqual(called, false);
});

test('questionDrillStudent 无待练原句 → 抛错', async () => {
  ds.hasKey = () => false;
  await assert.rejects(
    () => engine.questionDrillStudent({ topic: '勾股定理', messages: [] }),
    /待练原句/
  );
});

test('questionDrillStudent 无 Key → rule 分支返回固定误区首句', async () => {
  ds.hasKey = () => false;
  const r = await engine.questionDrillStudent({
    topic: '勾股定理',
    quote: '这公式大家能理解吗？',
    misconceptionKey: 'fixed_formula',
    messages: [],
  });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.persona, 'question-drill');
  assert.strictEqual(r.misconception_key, 'fixed_formula');
  assert.strictEqual(r.reply, '我觉得这个结论不管什么情况都能用，对吧？');
  assert.strictEqual(r.rubric_version, 'question-drill-v1');
});

test('questionDrillStudent 有 Key 且模型返回 → llm 分支', async () => {
  ds.hasKey = () => true;
  ds.chat = async () => '可是书上说这个永远成立啊';
  const r = await engine.questionDrillStudent({
    topic: '勾股定理',
    quote: '这公式大家能理解吗？',
    misconceptionKey: 'memorized_answer',
    messages: [],
  });
  assert.strictEqual(r.engine, 'llm');
  assert.strictEqual(r.misconception_key, 'memorized_answer');
  assert.ok(r.reply.length > 0);
});
