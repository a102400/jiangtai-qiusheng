'use strict';

/**
 * 教学环节语义契约测试
 * ------------------------------------------------------------------
 * 背景：项目里曾把四套不同性质的数据都叫「环节」，混在一起导致误解：
 *   1. knowledge        —— 七环节（教学设计线索齐不齐）
 *   2. subject_knowledge—— 学科知识点（讲稿里提到哪些学科内容）
 *   3. segments         —— 四段练习稿（导入/新授/互动/小结）
 *   4. time_allocation  —— 教师/学生/互动/过渡的时间分配
 *
 * 本文件锁死三条底线：
 *   1. knowledge.covered / knowledge.missing 的取值**只能**是七环节之一；
 *   2. 模型不得覆盖 knowledge（否则「逆定理」这类学科知识点会污染七环节体系）；
 *   3. subject_knowledge 的每条证据都必须是逐字稿里的原样子串（证据不许伪造）。
 */

const test = require('node:test');
const assert = require('node:assert');

const { analyzeRule, improveScriptRule, SEVEN_PHASES } = require('../lib/analyzer.js');
const engine = require('../lib/engine.js');
const { classroomMetrics } = require('../lib/heatmap.js');
const { analyzePrompt } = require('../lib/prompts.js');

/* 七环节固定集合（与规格一致，测试里独立写一份，避免和实现同源导致一起错） */
const SEVEN = ['情境引入', '知识推导', '公式结论', '例题讲解', '课堂互动', '小结回顾', '作业布置'];

const TRANSCRIPT =
  '同学们好，今天我们学习勾股定理。先看这个直角三角形，两条直角边是 a 和 b，斜边是 c。' +
  '那么 a 平方加 b 平方等于 c 平方，这个公式是怎么来的？我们用面积法推导。' +
  '因为两个全等三角形的面积和等于 ab，所以可以得出结论。李同学，你说说看，为什么这样拼？' +
  '（停顿，默数三秒）大家想一想，如果条件反过来还成立吗？' +
  '最后我们小结一下，今天学的勾股定理公式。作业布置：课本第 45 页第 3 题。';

/* 离线确定性：测试不允许真的走大模型分支（结果不能依赖网络与密钥） */
function offline(t) {
  const savedKey = process.env.AI_API_KEY;
  const savedDeepseek = process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
    if (savedDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedDeepseek;
  });
}

/* ---------- 1. knowledge 永远只含七环节 ---------- */

test('analyzeRule：knowledge.covered 与 knowledge.missing 的每个值都 ∈ 七环节集合', () => {
  const r = analyzeRule({ transcript: TRANSCRIPT, subject: '勾股定理', durationSec: 240 });
  assert.ok(Array.isArray(r.knowledge.covered));
  assert.ok(Array.isArray(r.knowledge.missing));
  r.knowledge.covered.forEach((k) => {
    assert.ok(SEVEN.indexOf(k) !== -1, 'covered 出现非七环节的值：' + k);
  });
  r.knowledge.missing.forEach((k) => {
    assert.ok(SEVEN.indexOf(k) !== -1, 'missing 出现非七环节的值：' + k);
  });
  // covered 与 missing 必须构成七环节的一个划分（不重不漏）
  const all = r.knowledge.covered.concat(r.knowledge.missing);
  assert.strictEqual(new Set(all).size, SEVEN.length, 'covered+missing 必须恰好覆盖七环节且不重复');
  SEVEN.forEach((p) => {
    assert.ok(all.indexOf(p) !== -1, '七环节缺失：' + p);
  });
});

test('analyzeRule：knowledge 带 scheme=generic-seven-phase-cues-v1 与 source=text-keyword-rules', () => {
  const r = analyzeRule({ transcript: TRANSCRIPT, subject: '勾股定理', durationSec: 240 });
  assert.strictEqual(r.knowledge.scheme, 'generic-seven-phase-cues-v1');
  assert.strictEqual(r.knowledge.source, 'text-keyword-rules');
  assert.strictEqual(typeof r.knowledge.cover_percent, 'number');
});

test('analyzeRule：七环节常量与规格一致（7 个，顺序固定）', () => {
  assert.deepStrictEqual(SEVEN_PHASES, SEVEN);
});

/* ---------- 2. 改进稿只认七环节（防御被污染的 missing） ---------- */

test('improveScriptRule：missing 里混入学科知识点时，非法项被忽略，不产生针对它的补写', () => {
  const polluted = {
    knowledge: {
      covered: ['情境引入', '知识推导'],
      // 故意污染：前两项是学科知识点，不是教学环节
      missing: ['逆定理', '勾股定理公式', '课堂互动'],
      cover_percent: 40,
    },
    suggestions: [],
  };
  const out = improveScriptRule({ transcript: TRANSCRIPT, analysis: polluted, subject: '勾股定理' });

  // 非法项不得出现在补写记录里
  const changeText = out.key_changes.join(' | ');
  assert.ok(changeText.indexOf('逆定理') === -1, '补写记录不得包含「逆定理」：' + changeText);
  assert.ok(changeText.indexOf('勾股定理公式') === -1, '补写记录不得包含「勾股定理公式」：' + changeText);
  // 只补写了合法的「课堂互动」这一项
  assert.ok(changeText.indexOf('课堂互动') !== -1, '合法的「课堂互动」应被补写：' + changeText);

  // 输出稿里只应有一处补写（对应「课堂互动」），不得为学科知识点额外补写
  const addonCount = (out.improved_script.match(/（补）/g) || []).length;
  assert.strictEqual(addonCount, 1, '只应有 1 处补写（课堂互动），实际：' + addonCount + ' —— ' + out.improved_script);
  assert.ok(out.improved_script.indexOf('（补）现在请同桌两人互相讲一遍') !== -1,
    '合法的「课堂互动」仍应被补写：' + out.improved_script);
});

test('improveScriptRule：missing 全是学科知识点时，一句补写都不产生', () => {
  const polluted = {
    knowledge: { covered: [], missing: ['逆定理', '勾股定理公式'], cover_percent: 0 },
    suggestions: [],
  };
  const out = improveScriptRule({ transcript: TRANSCRIPT, analysis: polluted, subject: '勾股定理' });
  assert.ok(out.improved_script.indexOf('（补）') === -1, '没有合法缺失环节时不应有任何补写');
  assert.ok(!out.key_changes.some((c) => c.indexOf('补齐了缺失环节') !== -1),
    '不应报告「补齐了缺失环节」');
});

/* ---------- 3. 规则分支的 subject_knowledge ---------- */

test('analyzeRule：规则分支返回 subject_knowledge，covered/needs_review 是数组、scope_note 非空', () => {
  const r = analyzeRule({ transcript: TRANSCRIPT, subject: '勾股定理', durationSec: 240 });
  assert.ok(r.subject_knowledge, '规则分支必须有 subject_knowledge');
  assert.ok(Array.isArray(r.subject_knowledge.covered), 'covered 必须是数组');
  assert.ok(Array.isArray(r.subject_knowledge.needs_review), 'needs_review 必须是数组');
  assert.strictEqual(typeof r.subject_knowledge.scope_note, 'string');
  assert.ok(r.subject_knowledge.scope_note.length > 0, 'scope_note 不得为空');
  // 规则引擎没有可靠依据做学科判断 → 必须诚实地不给出结论
  assert.deepStrictEqual(r.subject_knowledge.covered, [], '规则分支不得凭空声称覆盖了学科知识点');
  assert.deepStrictEqual(r.subject_knowledge.needs_review, []);
  // scope_note 必须说明算不出覆盖率
  assert.ok(r.subject_knowledge.scope_note.indexOf('不能计算') !== -1,
    'scope_note 必须诚实说明不能计算覆盖率：' + r.subject_knowledge.scope_note);
});

/* ---------- 4. LLM 合并层：模型不得覆盖 knowledge ---------- */

test('engine.analyze（LLM 分支）：模型伪造的 knowledge 被丢弃，合并后仍只含七环节', async (t) => {
  offline(t);
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      overall_score: 88,
      summary: '模型返回的结果',
      // 故意伪造：把学科知识点塞进 knowledge，还想改掉覆盖率
      knowledge: {
        covered: ['逆定理', '勾股定理公式'],
        missing: ['逆定理', '面积法'],
        cover_percent: 99,
      },
      subject_knowledge: {
        covered: [],
        needs_review: [],
        scope_note: '没有完整教案或知识点清单，不能计算学科知识覆盖率。',
      },
    });
  t.after(() => {
    ds.hasKey = savedHasKey;
    ds.chat = savedChat;
  });

  const merged = await engine.analyze({ transcript: TRANSCRIPT, subject: '勾股定理', durationSec: 240 });
  const base = analyzeRule({ transcript: TRANSCRIPT, subject: '勾股定理', durationSec: 240 });

  // 模型给的 covered/missing 必须被规则引擎的值替换掉
  merged.knowledge.covered.forEach((k) => {
    assert.ok(SEVEN.indexOf(k) !== -1, '合并后 covered 出现非七环节的值：' + k);
  });
  merged.knowledge.missing.forEach((k) => {
    assert.ok(SEVEN.indexOf(k) !== -1, '合并后 missing 出现非七环节的值：' + k);
  });
  assert.ok(merged.knowledge.covered.indexOf('逆定理') === -1, '模型伪造的「逆定理」不得进入 covered');
  assert.ok(merged.knowledge.missing.indexOf('逆定理') === -1, '模型伪造的「逆定理」不得进入 missing');

  // cover_percent 必须等于规则版（模型改不动）
  assert.strictEqual(merged.knowledge.cover_percent, base.knowledge.cover_percent,
    'cover_percent 必须等于规则引擎算出的值');
  assert.strictEqual(merged.knowledge.scheme, 'generic-seven-phase-cues-v1');
  assert.strictEqual(merged.knowledge.source, 'text-keyword-rules');
});

/* ---------- 5. subject_knowledge 证据不许伪造 ---------- */

test('engine：subject_knowledge.covered 的 evidence_quote 若不在逐字稿原文中，被丢弃', () => {
  const fake = engine.normalizeSubjectKnowledge(
    {
      covered: [
        { point: '勾股定理', evidence_quote: '这是一句逐字稿里根本没有的话' },
        { point: '面积法', evidence_quote: '我们用面积法推导' }, // 真句子
      ],
      needs_review: [{ point: '逆定理', reason: '当前讲稿没有足够证据确认是否讲解' }],
      scope_note: '没有完整教案或知识点清单，不能计算学科知识覆盖率。',
    },
    TRANSCRIPT
  );
  assert.strictEqual(fake.covered.length, 1, '伪造证据必须被丢弃');
  assert.strictEqual(fake.covered[0].point, '面积法');
  // 保留下来的那条，证据必须是原文子串
  assert.ok(TRANSCRIPT.indexOf(fake.covered[0].evidence_quote) !== -1, '证据必须是原文子串');
  // needs_review 不做证据校验（它本来就是「证据不足」的清单）
  assert.strictEqual(fake.needs_review.length, 1);
  assert.strictEqual(fake.needs_review[0].point, '逆定理');
  assert.ok(fake.scope_note.length > 0);
});

test('engine：subject_knowledge 缺字段时前端可容错（空数组 + 非空 scope_note）', () => {
  const r = engine.normalizeSubjectKnowledge(undefined, TRANSCRIPT);
  assert.deepStrictEqual(r.covered, []);
  assert.deepStrictEqual(r.needs_review, []);
  assert.ok(typeof r.scope_note === 'string' && r.scope_note.length > 0);
  // scope_note 里若模型编了覆盖率数字，必须换成诚实的规范说明
  const withPct = engine.normalizeSubjectKnowledge({ scope_note: '学科知识覆盖率 92%' }, TRANSCRIPT);
  assert.ok(withPct.scope_note.indexOf('%') === -1, 'scope_note 不得含编造的覆盖率：' + withPct.scope_note);
  assert.ok(withPct.scope_note.indexOf('不能计算') !== -1);
});

/* ---------- 6. time_allocation 带来源标注 ---------- */

test('heatmap：规则分支无可靠计时 → time_allocation 为 null（不伪造「全算讲授」）', async (t) => {
  offline(t);
  const r = await classroomMetrics({ transcript: TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.time_allocation, null,
    '规则分支没有任何实测/可靠计时依据，必须返回 null 而非伪造分配（含「全算教师讲授」兜底）');
});

test('heatmap：LLM 分支的 time_allocation 也带 source=text-heuristic', async (t) => {
  offline(t);
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  ds.chat = async () =>
    JSON.stringify({
      wait_moments: [{ quote: '李同学，你说说看', wait_sec: 2.5, reaction: '学生接住了' }],
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
  const r = await classroomMetrics({ transcript: TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'llm');
  assert.strictEqual(r.time_allocation.source, 'text-heuristic');
  assert.strictEqual(r.time_allocation.teacher, 20);
});

/* ---------- 7. prompt 契约 ---------- */

test('analyzePrompt：不再要求模型返回 knowledge，且要求用 subject_knowledge', () => {
  const p = analyzePrompt({ transcript: TRANSCRIPT, subject: '勾股定理', grade: '八年级' });
  // JSON 契约里不再有 "knowledge" 这个键
  // （注意只查带冒号的键名形式：prompt 正文里"不要返回 knowledge 字段"这句说明是允许的）
  assert.ok(p.indexOf('"knowledge":') === -1, 'prompt 的 JSON 契约不得再要求模型返回 knowledge');
  assert.ok(p.indexOf('"subject_knowledge"') !== -1, 'prompt 必须要求模型返回 subject_knowledge');
  assert.ok(p.indexOf('"evidence_quote"') !== -1, 'subject_knowledge 必须要求证据字段');
  assert.ok(p.indexOf('"needs_review"') !== -1);
  assert.ok(p.indexOf('"scope_note"') !== -1);
  // 不再让模型产出 cover_percent
  assert.ok(p.indexOf('cover_percent') === -1, 'prompt 不得再让模型产出 cover_percent');
  // 硬性要求写清楚：不给百分比、不把「没出现」当「漏讲」
  assert.ok(p.indexOf('不要生成任何"学科知识覆盖率"百分比') !== -1);
  assert.ok(p.indexOf('漏讲') !== -1);
});
