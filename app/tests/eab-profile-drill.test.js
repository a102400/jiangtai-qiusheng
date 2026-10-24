'use strict';

/**
 * E 教学任务与学情 / B 专项技能练习 —— 后端回归测试
 * ------------------------------------------------------------------
 * 覆盖：
 *   1. normalizeProfile 的字段级裁剪（非法枚举回落、数组裁剪、数值裁剪）
 *   2. deriveLevelParams 的四档 level 与 activity 系数
 *   3. drillRule 对同一段文本算出的语速与 analyzer 完全一致
 *   4. 老请求体（不带 profile）走 classroomRound / studentChat，行为与改造前一致
 *   5. /api/drill 的契约与错误码
 */

const test = require('node:test');
const assert = require('node:assert');

const { normalizeProfile, deriveLevelParams, DEFAULT_PROFILE, pickAskForLevel } = require('../lib/profile.js');
const { drillRule, SKILLS, validateLlmResult } = require('../lib/drill.js');
const { analyzeRule } = require('../lib/analyzer.js');
const { studentSystem, classroomRoundPrompt } = require('../lib/prompts.js');
const engine = require('../lib/engine.js');

const SAMPLE = '同学们好，今天我们讲函数的单调性。第一步，求导。为什么要求导呢？因为导数反映变化快慢。' +
  '大家想想，如果是分段函数，还能用同样的方法吗？（停顿）老师等三秒。那我们接着看例题。' +
  '所以，单调性由导数符号决定。听懂了吗？接下来我们小结一下，作业是课本第 12 页。';

/* ---------- 1. normalizeProfile 字段裁剪 ---------- */

test('normalizeProfile：非法枚举回落默认', () => {
  const p = normalizeProfile({
    task: { lessonType: 'xxx', assessment: 'nope' },
    class: { level: 'bad', activity: 'zzz' },
  });
  assert.strictEqual(p.task.lessonType, DEFAULT_PROFILE.task.lessonType);
  assert.strictEqual(p.task.assessment, DEFAULT_PROFILE.task.assessment);
  assert.strictEqual(p.class.level, DEFAULT_PROFILE.class.level);
  assert.strictEqual(p.class.activity, DEFAULT_PROFILE.class.activity);
  assert.strictEqual(p.version, 1);
  assert.ok(typeof p.updatedAt === 'number' && p.updatedAt > 0);
});

test('normalizeProfile：数组长度裁到 5 条、每条 ≤ 60 字', () => {
  const long = 'x'.repeat(200);
  const p = normalizeProfile({
    task: { objectives: [1, 2, 3, 4, 5, 6, 7], keyPoints: [long] },
    class: { priorKnowledge: ['a', 'b', 'c', 'd', 'e', 'f'], commonErrors: [] },
  });
  assert.strictEqual(p.task.objectives.length, 5);
  assert.strictEqual(p.task.keyPoints[0].length, 60);
  assert.strictEqual(p.class.priorKnowledge.length, 5);
  assert.deepStrictEqual(p.class.commonErrors, []);
});

test('normalizeProfile：size / durationMin 越界裁剪，topic ≤ 40 字', () => {
  const p = normalizeProfile({
    task: { topic: 'y'.repeat(100), durationMin: 9999 },
    class: { size: 999 },
  });
  assert.strictEqual(p.task.topic.length, 40);
  assert.strictEqual(p.task.durationMin, 180);
  assert.strictEqual(p.class.size, 80);
  const p2 = normalizeProfile({ class: { size: 0 }, task: { durationMin: -5 } });
  assert.strictEqual(p2.class.size, 1);
  assert.strictEqual(p2.task.durationMin, 0);
});

/* ---------- 2. deriveLevelParams ---------- */

test('deriveLevelParams：四档 level 的难度/深度/偏移符合规格 §2.5', () => {
  const weak = deriveLevelParams('weak', 'mid', 45);
  assert.strictEqual(weak.difficulty, 'basic');
  assert.strictEqual(weak.askDepth, 1);
  assert.strictEqual(weak.baseAttentionDelta, -8);
  assert.strictEqual(weak.baseComprehensionDelta, -12);
  assert.ok(weak.respondStyle.indexOf('需点名') !== -1, 'weak 的回应风格应为「需点名才答」');

  const basic = deriveLevelParams('basic', 'mid', 45);
  assert.strictEqual(basic.difficulty, 'basic');
  assert.strictEqual(basic.askDepth, 1);
  assert.strictEqual(basic.baseAttentionDelta, -4);

  const good = deriveLevelParams('good', 'mid', 45);
  assert.strictEqual(good.difficulty, 'core');
  assert.strictEqual(good.askDepth, 2);
  assert.strictEqual(good.baseAttentionDelta, 0);

  const excellent = deriveLevelParams('excellent', 'mid', 45);
  assert.strictEqual(excellent.difficulty, 'advanced');
  assert.strictEqual(excellent.askDepth, 3);
  assert.strictEqual(excellent.baseAttentionDelta, 6);
  assert.strictEqual(excellent.baseComprehensionDelta, 6);
});

test('deriveLevelParams：activity 系数乘到 handRaiseRate 且上限 0.9', () => {
  const low = deriveLevelParams('good', 'low', 45);
  const mid = deriveLevelParams('good', 'mid', 45);
  const high = deriveLevelParams('good', 'high', 45);
  assert.ok(Math.abs(low.handRaiseRate - 0.55 * 0.85) < 1e-6);
  assert.ok(Math.abs(mid.handRaiseRate - 0.55) < 1e-6);
  assert.ok(Math.abs(high.handRaiseRate - 0.55 * 1.15) < 1e-6);
  const max = deriveLevelParams('excellent', 'high', 80);
  assert.ok(max.handRaiseRate <= 0.9, 'handRaiseRate 上限 0.9');
});

/* ---------- 3. drillRule 与 analyzer 口径一致 ---------- */

test('drillRule：语速与 analyzer.analyzeRule 算出的完全一致', () => {
  const r = drillRule({ skill: 'pace_filler', transcript: SAMPLE, durationSec: 180 });
  const a = analyzeRule({ transcript: SAMPLE, subject: '本节课', grade: '', durationSec: 180 });
  assert.strictEqual(r.metrics.chars_per_min, a.speech_rate.chars_per_min);
  assert.strictEqual(r.metrics.filler_total, a.filler_words.total);
  assert.strictEqual(r.metrics.questions_asked, a.questions.asked);
  assert.strictEqual(r.metrics.genuine_questions, a.questions.genuine_questions);
  assert.strictEqual(r.metrics.fake_questions, a.questions.fake_questions);
  assert.strictEqual(r.metrics.avg_wait_sec, a.questions.avg_wait_sec);
  assert.strictEqual(r.metrics.cover_percent, a.knowledge.cover_percent);
  assert.strictEqual(r.engine, 'rule');
});

test('drillRule：evidence 的 quote 100% 是讲稿原样子串，且契约字段齐全', () => {
  for (const sk of SKILLS) {
    const r = drillRule({ skill: sk.key, transcript: SAMPLE, durationSec: 180 });
    r.evidence.forEach((e) => {
      assert.ok(SAMPLE.indexOf(e.quote) !== -1, `${sk.key} 的 evidence 不是原文子串：${e.quote}`);
      assert.ok(e.quote.length <= 40);
    });
    assert.strictEqual(r.skill, sk.key);
    assert.strictEqual(r.skill_label, sk.label);
    assert.strictEqual(typeof r.score, 'number');
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(['优秀', '合格', '需改进'].indexOf(r.grade) !== -1);
    assert.ok(r.dimensions.length >= 3 && r.dimensions.length <= 5);
    assert.ok(r.suggestions.length >= 1 && r.suggestions.length <= 5);
    assert.ok(r.next_drill && r.next_drill.skill);
    assert.ok(r.source_note.indexOf('本地规则判定') !== -1);
    assert.strictEqual(r.engine, 'rule');
  }
});

test('drillRule：分数分档符合规格（≥85 优秀 / 60-84 合格 / <60 需改进）', () => {
  const r = drillRule({ skill: 'question_wait', transcript: SAMPLE, durationSec: 180 });
  const expect = r.score >= 85 ? '优秀' : r.score >= 60 ? '合格' : '需改进';
  assert.strictEqual(r.grade, expect);
});

test('validateLlmResult：非原文引文被丢弃，维度全废则判不可用', () => {
  const bad = validateLlmResult(
    {
      score: 70,
      summary: '还行',
      dimensions: [{ key: 'a', label: 'A', score: 70, weight: 1, evidence: '', fix: '' }],
      evidence: [{ quote: '这句话不在讲稿里', reason: 'r', fix: 'f' }],
      suggestions: [],
    },
    { skill: 'pace_filler', transcript: SAMPLE, durationSec: 180 }
  );
  assert.ok(bad);
  assert.strictEqual(bad.evidence.length, 0, '非原文引文必须被丢弃');

  const good = validateLlmResult(
    {
      score: 88,
      summary: '稳',
      dimensions: [{ key: 'a', label: 'A', score: 88, weight: 1, evidence: 'e', fix: 'f' }],
      evidence: [{ quote: '第一步，求导', reason: 'r', fix: 'f' }],
      suggestions: [{ title: 't', detail: 'd' }],
    },
    { skill: 'pace_filler', transcript: SAMPLE, durationSec: 180 }
  );
  assert.strictEqual(good.grade, '优秀');
  assert.strictEqual(good.evidence.length, 1);

  const unusable = validateLlmResult({ dimensions: [] }, { skill: 'pace_filler', transcript: SAMPLE });
  assert.strictEqual(unusable, null);
});

/* ---------- 4. 向后兼容：不带 profile 时行为与改造前一致 ---------- */

test('向后兼容：无 profile 时 studentSystem prompt 与改造前逐字相同', () => {
  const legacy = `你扮演一名中学生，正在听实习老师讲《勾股定理》。
你的性格设定：${require('../lib/prompts.js').PERSONAS.naughty.desc}

铁律（每一条都必须遵守）：
1. 每次只输出一个问题，不超过 40 个字，用口语，像一个真实学生会说的话。
2. 必须基于【老师刚才讲的内容】来问——可以挑边界条件、可以超纲、也可以答非所问，但不能凭空瞎扯。
3. 老师回答后你可以顺着追问，但禁止重复已经问过的问题；追问时如果记得老师前面的原话，用「老师你刚才说「……」」引出来。
4. 禁止夸奖老师、禁止替老师解答、禁止使用"首先/其次/综上所述"这类书面语。
5. 绝对不能暴露你是 AI，有人问就说你是班里的学生。
6. 只输出说话内容本身，不要输出任何括号里的动作描写。

【老师刚才讲的内容】
最近讲的内容`;
  const out = studentSystem({ topic: '勾股定理', persona: 'naughty', recentChunk: '最近讲的内容' });
  assert.strictEqual(out, legacy, '无 profile 时 studentSystem 必须与改造前逐字相同');
});

test('向后兼容：无 profile 时 classroomRoundPrompt 不含学情痕迹', () => {
  const out = classroomRoundPrompt({ roundNo: 1, topic: '勾股定理', recentChunk: '内容' });
  assert.ok(out.indexOf('本次教学任务与班级学情') === -1, '无 profile 时不应拼接学情块');
  assert.ok(out.indexOf('本班基线为') === -1, '无 profile 时不应拼接基线说明');
});

test('向后兼容：无 profile 时 classroomRound 的基线与数值等于原 STUDENT_STATE_BASE', async () => {
  const r = await engine.classroomRound({
    topic: '勾股定理',
    transcript: '同学们好，今天讲勾股定理。第一步，写出公式。',
    teacherAnswer: '',
    pressure: 0,
    history: [],
  });
  assert.strictEqual(r.profile_applied, false);
  assert.strictEqual(r.profile_effect, '');
  assert.strictEqual(r.students.length, 3);
  const expect = {
    naughty: { attention: 52, comprehension: 62 },
    geek: { attention: 88, comprehension: 90 },
    drift: { attention: 42, comprehension: 35 },
  };
  r.students.forEach((s) => {
    assert.strictEqual(s.difficulty, 'core');
    assert.strictEqual(s.base_state.attention, expect[s.key].attention);
    assert.strictEqual(s.base_state.comprehension, expect[s.key].comprehension);
  });
  // 无 profile 时 hand_raise 与改造前一致（naughty/drift 举手，geek 不举）
  assert.strictEqual(r.students[0].hand_raise, true);
  assert.strictEqual(r.students[1].hand_raise, false);
  assert.strictEqual(r.students[2].hand_raise, true);
});

test('向后兼容：无 profile 时 studentChat 的字段与改造前一致', async () => {
  const r = await engine.studentChat({ messages: [], persona: 'naughty', topic: '勾股定理' });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.persona, 'naughty');
  assert.strictEqual(r.label, '调皮型');
  assert.strictEqual(r.profile_applied, false);
  assert.strictEqual(r.difficulty, 'core');
  assert.strictEqual(r.profile_summary, '');
});

/* ---------- 5. 学情生效时的行为 ---------- */

test('学情生效：weak 档课堂基线整体下降且 profile_applied=true', async () => {
  const r = await engine.classroomRound({
    topic: '勾股定理',
    transcript: '同学们好，今天讲勾股定理。',
    teacherAnswer: '',
    pressure: 0,
    history: [],
    profile: { class: { level: 'weak' } },
  });
  assert.strictEqual(r.profile_applied, true);
  assert.ok(r.profile_effect.length > 0);
  r.students.forEach((s) => {
    assert.ok(s.base_state.attention <= 44, 'weak 档 attention 基线应 ≤44，实际 ' + s.base_state.attention);
    assert.ok(s.base_state.comprehension <= 50, 'weak 档 comprehension 基线应 ≤50，实际 ' + s.base_state.comprehension);
    assert.strictEqual(s.difficulty, 'basic');
  });
});

test('学情生效：excellent 档小走 difficulty 为 basic、小霸为 advanced', async () => {
  const r = await engine.classroomRound({
    topic: '勾股定理', transcript: '内容', history: [],
    profile: { class: { level: 'excellent' } },
  });
  const byKey = {};
  r.students.forEach((s) => { byKey[s.key] = s; });
  assert.strictEqual(byKey.geek.difficulty, 'advanced');
  assert.strictEqual(byKey.drift.difficulty, 'basic');
});

test('学情生效：pickAskForLevel 按水平重排提问池，good 维持原顺序', () => {
  const pool = ['老师你一直在讲公式，可是我连为什么要这样设都还没搞懂诶。', '如果我把条件反过来，答案会不会整个反过来？'];
  const good = pickAskForLevel(pool, 'good');
  assert.deepStrictEqual(good, pool);
  const weak = pickAskForLevel(pool, 'weak');
  assert.strictEqual(weak[0], pool[0], '弱档应优先「为什么/怎么算」类基础概念问题');
});

/* ---------- 6. drill 接口契约 ---------- */

test('engine.drill：返回符合规格 §3.5 的 data 结构', async () => {
  const r = await engine.drill({ skill: 'question_wait', transcript: SAMPLE, durationSec: 180 });
  ['skill', 'skill_label', 'duration_sec', 'score', 'grade', 'summary', 'dimensions',
    'evidence', 'suggestions', 'next_drill', 'metrics', 'engine', 'source_note'].forEach((k) => {
    assert.ok(Object.prototype.hasOwnProperty.call(r, k), '缺少字段 ' + k);
  });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.duration_sec, 180);
  ['chars_per_min', 'filler_total', 'questions_asked', 'genuine_questions', 'fake_questions',
    'avg_wait_sec', 'cover_percent', 'pause_count', 'matched_markers'].forEach((k) => {
    assert.ok(Object.prototype.hasOwnProperty.call(r.metrics, k), 'metrics 缺少 ' + k);
  });
});

test('engine.drill：讲稿过短报错、未知技能报错', async () => {
  await assert.rejects(() => engine.drill({ skill: 'question_wait', transcript: '太短' }), /偏短|太短/);
  await assert.rejects(() => engine.drill({ skill: 'nope', transcript: SAMPLE }), /未知技能/);
});

test('engine.drillSkills：五项技能且 key 与规格一致', () => {
  const r = engine.drillSkills();
  assert.strictEqual(r.skills.length, 5);
  assert.strictEqual(r.default_skill, 'question_wait');
  assert.strictEqual(r.duration_sec, 180);
  assert.strictEqual(r.engine, 'rule');
  assert.deepStrictEqual(
    r.skills.map((s) => s.key),
    ['question_wait', 'pace_filler', 'board_structure', 'intro_design', 'transition']
  );
  r.skills.forEach((s) => {
    assert.ok(s.label && s.focus && s.brief && s.starter);
    assert.ok(Array.isArray(s.checklist) && s.checklist.length >= 3 && s.checklist.length <= 5);
  });
});

/* ---------- 6. dimensions[].key 规范 key 统一 ---------- */

test('规范 key：五个技能的 drillRule 输出 key 全部落在 canonicalKeys 集合内', () => {
  const { canonicalKeys } = require('../lib/drill.js');
  SKILLS.forEach((s) => {
    const r = drillRule({ skill: s.key, transcript: SAMPLE, durationSec: 180 });
    const allowed = canonicalKeys(s.key);
    assert.ok(allowed.length >= 3 && allowed.length <= 5, `${s.key} 规范 key 数量应在 3–5`);
    r.dimensions.forEach((d) => {
      assert.ok(
        allowed.indexOf(d.key) !== -1,
        `${s.key} 出现非规范 key：${d.key}（允许：${allowed.join(',')}）`
      );
    });
    // 规范 key 集合必须完整出现（不多不少）
    assert.deepStrictEqual(
      r.dimensions.map((d) => d.key).slice().sort(),
      allowed.slice().sort(),
      `${s.key} 规则路径的维度 key 集合应与规范集完全一致`
    );
  });
});

test('规范 key：规则路径与 LLM 路径（validateLlmResult）产出的 key 集合完全一致', () => {
  const { canonicalKeys } = require('../lib/drill.js');
  // 用内部 key / 别名 / 中文 label 构造模型返回，验证映射能力
  const MODEL_DIMS = {
    question_wait: [
      { key: 'density', label: '有效提问密度' },
      { key: 'wait', label: '提问后留白' },
      { key: 'marker', label: '等待标记' },
      { key: 'fake', label: '假提问扣分' },
    ],
    pace_filler: [
      { key: 'pace', label: '语速' },
      { key: 'filler', label: '口头禅数量' },
      { key: 'density', label: '口头禅密度' },
    ],
    board_structure: [
      { key: 'board', label: '板书承担设计' },
      { key: 'structure', label: '板书结构标记' },
      { key: 'cover', label: '环节覆盖' },
      { key: 'missing', label: '缺失环节扣分' },
    ],
    intro_design: [
      { key: 'signal', label: '导入信号' },
      { key: 'ask', label: '导入提问' },
      { key: 'length', label: '导入长度' },
      { key: 'concrete', label: '情境具体度' },
    ],
    transition: [
      { key: 'transition', label: '过渡句' },
      { key: 'cover', label: '环节覆盖' },
      { key: 'cover_penalty', label: '覆盖不足扣分' },
      { key: 'close', label: '收口' },
    ],
  };
  SKILLS.forEach((s) => {
    const ruleKeys = drillRule({ skill: s.key, transcript: SAMPLE, durationSec: 180 })
      .dimensions.map((d) => d.key);
    const llm = validateLlmResult(
      {
        score: 80,
        summary: '模型自评',
        dimensions: MODEL_DIMS[s.key].map((d) => ({
          key: d.key,
          label: d.label,
          score: 70,
          weight: 0.25,
          evidence: '依据',
          fix: '改法',
        })),
        evidence: [],
        suggestions: [{ title: 't', detail: 'd' }],
      },
      { skill: s.key, transcript: SAMPLE, durationSec: 180 }
    );
    assert.ok(llm, `${s.key} LLM 结果应可用`);
    const llmKeys = llm.dimensions.map((d) => d.key);
    assert.deepStrictEqual(
      llmKeys.slice().sort(),
      ruleKeys.slice().sort(),
      `${s.key} 规则路径与 LLM 路径的维度 key 集合应完全一致`
    );
    assert.deepStrictEqual(
      llmKeys.slice().sort(),
      canonicalKeys(s.key).slice().sort(),
      `${s.key} LLM 路径映射后的 key 集合应等于规范集`
    );
  });
});

test('规范 key：LLM 返回的 key 走「规范 key → aliases → label 关键词」三级映射', () => {
  const { mapToCanonicalKey } = require('../lib/drill.js');
  // 1. 规范 key 精确命中
  assert.strictEqual(mapToCanonicalKey('pace_filler', 'speech_rate', '语速'), 'speech_rate');
  // 2. aliases 命中
  assert.strictEqual(mapToCanonicalKey('pace_filler', 'filler_total', 'x'), 'filler_count');
  // 3. label 关键词兜底
  assert.strictEqual(mapToCanonicalKey('question_wait', 'zzz', '等待时长控制'), 'wait_time');
  // 4. 完全匹配不上 → null（调用方保留模型原 key）
  assert.strictEqual(mapToCanonicalKey('question_wait', 'zzz', 'zzz'), null);
});
