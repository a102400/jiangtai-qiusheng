'use strict';

/**
 * 问句判定 / 互动任务判定分离测试
 * ------------------------------------------------------------------
 * 背景：项目里有两套本应分开的判定，此前混在一起，导致陈述句被错当问句：
 *   ① 问句判定 —— 一句话是不是真的在向学生提问（用于等待时间推断）；
 *   ② 互动任务判定 —— 一句话是不是在组织学生互动（讨论/练习/板演/齐读…），
 *      用于教学环节分类与时间分配。
 * 混在一起的代价：
 *   · ruleTimeAllocation() 把陈述句算进「互动分钟」；
 *   · ruleSegments() 把陈述句划进「互动」环节；
 *   · 结果「互动」环节可能为空，18 分钟被误判成「过渡」。
 *
 * 本文件锁死十条（与用户给定的验收清单逐条对应）：
 *   1. 「今天我们学什么呢？」→ 问句；
 *   2. 「今天我们先看看勾股定理呢。」→ 不因句末「呢」判为问句；
 *   3. 「谁来回答？」→ 问句；
 *   4. 「请同桌讨论这道题。」→ 是互动任务，但不是问句；
 *   5. 「我们把这个过程分为几个步骤来完成。」→ 不是问句；
 *   6. 「李同学，你说说这一步为什么这样设」（无问号）→ 问句（不回退上一批能力）；
 *   7. 「大家好，今天我们讲勾股定理。」→ 不是问句；
 *   8. 「今天我们来学习如何上好一节数学课。」→ 不是问句；
 *   9. 环节切分：讲稿含「请同桌讨论这道题。谁来回答？」→「互动」环节非空；
 *  10. 时间分配：陈述句不再被算进 interaction 计数（与改造前的旧规则对比）。
 *
 * 另附两条护栏：
 *  11. 切句必须保留句末标点（问号是问句判定的关键证据）；
 *  12. 等待指标（wait_metrics）只认问句：互动任务不进等待条目。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  isQuestionSentence,
  isInteractiveSentence,
  buildTextWaitMetrics,
} = require('../lib/wait-metrics.js');
const {
  classroomMetrics,
  ruleSegments,
  ruleTimeAllocation,
  splitTeachingUnits,
} = require('../lib/heatmap.js');
const { drillRule } = require('../lib/drill.js');

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

/* 一段含真问句的讲稿（供 LLM 分支回落用例使用） */
const TEXT_WITH_QUESTION =
  '同学们好，今天我们讲勾股定理。李同学，你说说这一步为什么这样设？然后我们来看这个公式。';

/* ---------- 1. 「今天我们学什么呢？」→ 问句 ---------- */

test('验证 1：「今天我们学什么呢？」判为问句（疑问词「什么」+ 问号）', () => {
  assert.strictEqual(isQuestionSentence('今天我们学什么呢？'), true);
});

/* ---------- 2. 句末「呢」不能单独作为问句证据 ---------- */

test('验证 2：「今天我们先看看勾股定理呢。」不因句末「呢」判为问句', () => {
  assert.strictEqual(
    isQuestionSentence('今天我们先看看勾股定理呢。'),
    false,
    '句末语气词「呢」不能单独作为问句证据'
  );
  // 同一句去掉语气词，结论不变（说明判定靠的是结构，不是「呢」）
  assert.strictEqual(isQuestionSentence('今天我们先看看勾股定理。'), false);
  // 加上问号后才是问句
  assert.strictEqual(isQuestionSentence('今天我们学什么呢？'), true);
});

/* ---------- 3. 「谁来回答？」→ 问句 ---------- */

test('验证 3：「谁来回答？」判为问句', () => {
  assert.strictEqual(isQuestionSentence('谁来回答？'), true);
  // 无问号但疑问代词「谁」+ 应答动词，也必须是问句
  assert.strictEqual(isQuestionSentence('谁来回答这道题'), true);
});

/* ---------- 4. 互动任务 ≠ 问句 ---------- */

test('验证 4：「请同桌讨论这道题。」是互动任务，但不是问句', () => {
  const s = '请同桌讨论这道题。';
  assert.strictEqual(
    isInteractiveSentence(s),
    true,
    '「讨论」是互动任务，isInteractiveSentence 必须为 true'
  );
  assert.strictEqual(
    isQuestionSentence(s),
    false,
    '互动任务不是提问，isQuestionSentence 必须为 false'
  );
  // 其余互动任务同样成立
  ['同桌交流一下这道题。', '我们来做一做这道练习题。', '请一位同学板演这道题。', '请大家齐读一遍。'].forEach(
    (x) => {
      assert.strictEqual(isInteractiveSentence(x), true, '应判为互动任务：' + x);
      assert.strictEqual(isQuestionSentence(x), false, '互动任务不应判为问句：' + x);
    }
  );
});

/* ---------- 5. 「几个」不算疑问结构 ---------- */

test('验证 5：「我们把这个过程分为几个步骤来完成。」不判为问句', () => {
  assert.strictEqual(isQuestionSentence('我们把这个过程分为几个步骤来完成。'), false);
});

/* ---------- 6. 无问号但明显是问句（不得回退上一批能力） ---------- */

test('验证 6：「李同学，你说说这一步为什么这样设」（无问号）仍判为问句', () => {
  assert.strictEqual(
    isQuestionSentence('李同学，你说说这一步为什么这样设'),
    true,
    '疑问词不必在句首 —— 上一批修好的能力不能回退'
  );
  // 上一批契约测试锁的同一条：点名 + 无问号
  assert.strictEqual(
    isQuestionSentence('李同学，你说说这一步为什么这样设'),
    true,
    '点名式无问号问句必须仍然识别'
  );
});

/* ---------- 7. 「大家好」不是邀请式问句 ---------- */

test('验证 7：「大家好，今天我们讲勾股定理。」不判为问句', () => {
  assert.strictEqual(isQuestionSentence('大家好，今天我们讲勾股定理。'), false);
  assert.strictEqual(isQuestionSentence('大家好，我们今天开始上课。'), false);
});

/* ---------- 8. 「如何」名词用法不是问句 ---------- */

test('验证 8：「今天我们来学习如何上好一节数学课。」不判为问句', () => {
  assert.strictEqual(isQuestionSentence('今天我们来学习如何上好一节数学课。'), false);
});

/* ---------- 9. 环节切分：「互动」环节非空 ---------- */

test('验证 9：讲稿含「请同桌讨论这道题。谁来回答？」→「互动」环节非空', async (t) => {
  offline(t);
  const segs = ruleSegments('请同桌讨论这道题。谁来回答？');
  assert.strictEqual(segs.length, 4, '仍是四段结构');
  const interact = segs.find((x) => x.phase === '互动');
  assert.ok(interact, '必须有「互动」段');
  assert.ok(
    interact.script.indexOf('（本地模式') === -1,
    '「互动」环节不得是兜底空文案，实际：' + interact.script
  );
  assert.ok(interact.script.indexOf('请同桌讨论这道题') !== -1, '互动任务应在互动环节，实际：' + interact.script);
  assert.ok(interact.script.indexOf('谁来回答') !== -1, '问句应在互动环节，实际：' + interact.script);

  // 走公开接口再验一次（规则分支）
  const r = await classroomMetrics({
    transcript: '请同桌讨论这道题。谁来回答？',
    subject: '勾股定理',
  });
  assert.strictEqual(r.engine, 'rule');
  const seg = r.segments.find((x) => x.phase === '互动');
  assert.ok(seg && seg.script.indexOf('（本地模式') === -1, '公开接口的「互动」环节也必须非空');
});

/* ---------- 10. 时间分配：陈述句不再算进 interaction ---------- */

/* 改造前的旧规则（照抄 heatmap.js 旧实现，仅用于对照，不参与产出） */
function legacySplitSentences(t) {
  return String(t)
    .split(/[。！？；!?;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}
function legacyTimeAllocation(transcript) {
  const total = 40;
  const sents = legacySplitSentences(transcript);
  let s = 0;
  let it = 0;
  let tr = 0;
  sents.forEach((x) => {
    if (/回答|板演|练习|齐读|朗读|讨论|上台|写一写|做一做/.test(x)) s++;
    if (/[?？]|吗|呢|谁来|说说看|想一想/.test(x)) it++;
    if (/好[，,。]|接下来|下面|我们再来|翻到|来看|注意看/.test(x)) tr++;
  });
  const n = Math.max(1, sents.length);
  const nonTeacher = (s + it + tr) / n;
  const teacher = Math.max(12, Math.round(total * Math.max(0.5, 1 - nonTeacher * 1.2)));
  const rest = total - teacher;
  const sum = s + it + tr || 1;
  const stu = Math.max(1, Math.round((rest * s) / sum));
  const inter = Math.max(1, Math.round((rest * it) / sum));
  return {
    teacher,
    student: stu,
    interaction: inter,
    transition: Math.max(0, rest - stu - inter),
    source: 'text-heuristic',
  };
}

const ALLOC_TRANSCRIPT =
  '同学们好，今天我们讲勾股定理。今天我们先看看勾股定理呢。请同桌讨论这道题。谁来回答？我们来看这个公式。';

test('验证 10：陈述句不再被算进 interaction 计数（与改造前对比）', async (t) => {
  offline(t);
  const before = legacyTimeAllocation(ALLOC_TRANSCRIPT);
  const after = ruleTimeAllocation(ALLOC_TRANSCRIPT);

  // 改造前：句末「呢」的陈述句被算进 interaction（计数 2 → 7 分钟）
  assert.strictEqual(before.interaction, 7, '旧规则把「呢」陈述句算进 interaction，实际：' + before.interaction);
  // 改造后：只有真问句计入（计数 1 → 4 分钟）
  assert.strictEqual(after.interaction, 4, '新规则只认真问句，实际：' + after.interaction);
  assert.ok(
    after.interaction < before.interaction,
    'interaction 必须比改造前少（陈述句不再计入），实际：' + after.interaction + ' vs ' + before.interaction
  );

  // 既有输出字段结构不得被破坏
  assert.deepStrictEqual(
    Object.keys(after).sort(),
    ['interaction', 'source', 'student', 'teacher', 'transition'],
    'time_allocation 的键集合是冻结契约'
  );
  ['teacher', 'student', 'interaction', 'transition'].forEach((k) => {
    assert.strictEqual(typeof after[k], 'number', 'time_allocation.' + k + ' 必须仍是数字');
  });
  assert.strictEqual(after.source, 'text-heuristic', '仍是文本估算，必须自曝来源（不是实测）');

  // 公开接口在「无可靠计时」时返回 null（不伪造），不再硬塞启发式分配
  const r = await classroomMetrics({ transcript: ALLOC_TRANSCRIPT, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'rule');
  assert.strictEqual(r.time_allocation, null, '规则分支不再伪造时间分配（无实测计时 → null）');
});

/* ---------- 11. 切句必须保留句末标点 ---------- */

test('护栏 11：教学单元切分保留句末标点（问号是问句判定的关键证据）', () => {
  const units = splitTeachingUnits('今天我们学什么呢？请同桌讨论这道题。');
  assert.deepStrictEqual(
    units,
    ['今天我们学什么呢？', '请同桌讨论这道题。'],
    '切分必须保留问号/句号，实际：' + JSON.stringify(units)
  );
  // 标点丢了，问句就判不出来 —— 这是规格里的隐患，这里锁住
  assert.strictEqual(isQuestionSentence(units[0]), true);
  assert.strictEqual(isQuestionSentence(units[1]), false);
});

/* ---------- 12. 等待指标只认问句 ---------- */

test('护栏 12：等待指标只认问句，互动任务与陈述句都不进等待条目', () => {
  const m1 = buildTextWaitMetrics('今天我们先看看勾股定理呢。');
  assert.deepStrictEqual(m1.moments, [], '句末「呢」的陈述句不得产出等待条目');
  assert.strictEqual(m1.average_sec, null);

  const m2 = buildTextWaitMetrics('请同桌讨论这道题。');
  assert.deepStrictEqual(m2.moments, [], '互动任务不是问句，不得产出等待条目');
  assert.strictEqual(m2.average_sec, null);

  const m3 = buildTextWaitMetrics('谁来回答？');
  assert.strictEqual(m3.moments.length, 1, '真问句必须产出等待条目');
  assert.ok(/[?？]/.test(m3.moments[0].quote), 'quote 必须保留问号');
  assert.strictEqual(m3.moments[0].source, 'text-heuristic');
});

/* ---------- 13. drill.js 必须复用共享问句判定（消除同名不同义） ---------- */

/* 讲稿里只有一个真问号问句；后面那一句是「呢」结尾的陈述句（不是问句），
   它的下一句带着等待标记。旧口径（drill 本地的宽松判定）会把「呢」陈述句
   也算成提问，于是「提问后写了等待」被多算 1 处。 */
const DRILL_TRANSCRIPT =
  '同学们好，今天我们讲勾股定理。李同学，你说说这一步为什么这样设？' +
  '今天我们先看看勾股定理呢。' +
  '（停顿，默数三秒）';

test('护栏 13：drill.js 不再自带同名 isQuestionSentence，改为复用 wait-metrics 的实现', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'drill.js'), 'utf8');
  assert.ok(
    src.indexOf('function isQuestionSentence') === -1,
    'drill.js 不得再定义本地 isQuestionSentence（同名不同义是维护陷阱）'
  );
  assert.ok(
    src.indexOf("require('./wait-metrics')") !== -1,
    'drill.js 必须引入 wait-metrics 的共享判定'
  );
});

test('护栏 13：drill 的「呢」陈述句不再被算成提问（等待处数不多算）', () => {
  const r = drillRule({ skill: 'question_wait', transcript: DRILL_TRANSCRIPT, durationSec: 180 });
  const waitDim = r.dimensions.find((d) => d.key === 'wait_time');
  assert.ok(waitDim, '必须有 wait_time 维度');
  assert.ok(
    waitDim.evidence.indexOf('提问后写了等待 0 处') !== -1,
    '「呢」结尾的陈述句不得被算成提问（等待处数应为 0），实际：' + waitDim.evidence
  );
  // 维度 key 不得被改动
  assert.deepStrictEqual(
    r.dimensions.map((d) => d.key).slice().sort(),
    ['fake_question', 'question_design', 'wait_marker', 'wait_time'],
    '规范维度 key 是冻结契约，不能变'
  );
});

/* ---------- 14. LLM 分支回落：source 必须是 text-heuristic ---------- */

test('护栏 14：模型没给 wait_moments → 回落规则版，wait_metrics.source 必须是 text-heuristic', async (t) => {
  offline(t);
  const ds = require('../lib/deepseek.js');
  const savedHasKey = ds.hasKey;
  const savedChat = ds.chat;
  ds.hasKey = () => true;
  // 模型只给了 segments，没给 wait_moments → LLM 分支不成立，必须回落规则版
  ds.chat = async () =>
    JSON.stringify({
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

  const r = await classroomMetrics({ transcript: TEXT_WITH_QUESTION, subject: '勾股定理' });
  assert.strictEqual(r.engine, 'rule', '模型没给 wait_moments → 整份结果回落规则版');
  assert.strictEqual(
    r.wait_metrics.source,
    'text-heuristic',
    '回落时来源必须是 text-heuristic，不得冒用 model-inference，实际：' + r.wait_metrics.source
  );
  assert.strictEqual(r.wait_source, 'text-heuristic');
  assert.ok(r.wait_metrics.moments.length > 0, '回落后应给出规则推断的等待条目');
});

/* ---------- 15. drill 的等待维度：分子分母必须同源（句级问句判定） ---------- */

/* team-lead 给的复现 case：问号计数 = 0，但「李同学，你说说这一步为什么这样设。」
   明确是提问，且后面紧跟「（停顿）」——改造前会被误报成「整段未检测到提问」。 */
const DRILL_REPRO = '李同学，你说说这一步为什么这样设。我们（停顿）一下。';

test('护栏 15：无问号但明确的提问，不得再被报成「整段未检测到提问」', () => {
  const r = drillRule({ skill: 'question_wait', transcript: DRILL_REPRO, durationSec: 180 });
  const waitDim = r.dimensions.find((d) => d.key === 'wait_time');
  assert.ok(waitDim, '必须有 wait_time 维度');
  assert.ok(
    waitDim.evidence.indexOf('整段未检测到提问') === -1,
    '有明确提问时不得报「整段未检测到提问」，实际：' + waitDim.evidence
  );
  assert.ok(
    waitDim.evidence.indexOf('提问后写了等待 1 处 / 共 1 个提问') !== -1,
    '必须是「1 处 / 共 1 个提问」，实际：' + waitDim.evidence
  );
  assert.ok(waitDim.score > 0, '识别到提问后留白，分数必须 > 0，实际：' + waitDim.score);
});

test('护栏 15：等待维度的分子（等待标记数）永远 ≤ 分母（句级提问数）', () => {
  const { buildStat } = require('../lib/drill.js');
  const { splitSentencesKeepPunct, isQuestionSentence } = require('../lib/wait-metrics.js');
  const CASES = [
    '同学们好，今天我们讲函数的单调性。为什么要求导呢？因为导数反映变化快慢。李同学，你说说看。公式就是这样。',
    '李同学，你说说这一步为什么这样设。我们（停顿）一下。',
    '同学们好，今天我们讲勾股定理。今天我们先看看勾股定理呢。（停顿，默数三秒）',
    '同学们好，今天我们讲勾股定理。两条直角边是 a 和 b，斜边是 c。a 平方加 b 平方等于 c 平方。',
  ];
  CASES.forEach((t) => {
    const s = buildStat({ transcript: t, durationSec: 180 });
    // 分母必须等于「共享切句 + 共享问句判定」数出来的句级提问数（同源）
    const expected = splitSentencesKeepPunct(t).filter((x) => isQuestionSentence(x)).length;
    assert.strictEqual(s.questionCount, expected, '句级提问数必须与共享判定同源');
    assert.ok(
      s.waitAfterQuestions <= s.questionCount,
      '分子不得大于分母（等待 ' + s.waitAfterQuestions + ' / 提问 ' + s.questionCount + '）'
    );
  });
});

test('护栏 15：drill.js 不得再出现自己写的松散问号正则（问号判定一律走共享实现）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'drill.js'), 'utf8');
  assert.ok(
    src.indexOf('[?？]') === -1,
    'drill.js 不得再出现独立的问号正则 —— 问句判定一律用 wait-metrics.isQuestionSentence'
  );
  assert.ok(
    src.indexOf('splitSentencesKeepPunct') !== -1,
    'drill.js 的问句计数必须用 wait-metrics 的配套切句（判定与切句同源）'
  );
});

/* ---------- 16. question_design 与 wait_time 必须同源（同一张卡片不能自相矛盾） ---------- */

/* 复现 case：明确提问但没写问号。
   改造前：question_design=0「每分钟 0.00 个需要思考的提问」（问号计数口径）
           wait_time=100「提问后写了等待 1 处 / 共 1 个提问」（句级口径）→ 同卡片打架 */
const DRILL_REPRO2 = '李同学，你说说这一步为什么这样设。我们（停顿）一下。';

test('护栏 16：question_design 与 wait_time 用同一个句级提问数，不再自相矛盾', () => {
  const { buildStat } = require('../lib/drill.js');
  const r = drillRule({ skill: 'question_wait', transcript: DRILL_REPRO2, durationSec: 180 });
  const st = buildStat({ transcript: DRILL_REPRO2, durationSec: 180 });

  // 句级口径：1 个提问、0 个封闭式 → 1 个需要思考的提问
  assert.strictEqual(st.questionCount, 1, '句级提问数应为 1');
  assert.strictEqual(st.closedCount, 0, '句级封闭式提问数应为 0');
  assert.strictEqual(st.thinkingCount, 1, '句级需要思考的提问数应为 1');
  assert.strictEqual(
    st.thinkingCount,
    st.questionCount - st.closedCount,
    '需要思考的提问 = 句级提问数 − 句级封闭式提问数'
  );

  const design = r.dimensions.find((d) => d.key === 'question_design');
  const wait = r.dimensions.find((d) => d.key === 'wait_time');
  // 两个维度看到的提问数必须一致（都来自句级口径）
  assert.ok(
    wait.evidence.indexOf('共 1 个提问') !== -1,
    'wait_time 必须是「共 1 个提问」，实际：' + wait.evidence
  );
  assert.ok(
    design.evidence.indexOf('约每 3 分钟 1 个需要思考的提问') !== -1,
    'question_design 的密度文案必须保真（0.33/min 不得显示成 0），实际：' + design.evidence
  );
  assert.ok(
    design.evidence.indexOf('0.00') === -1,
    '不得再出现「0.00 个」这种伪精确写法，实际：' + design.evidence
  );
  assert.ok(
    design.evidence.indexOf('每分钟 0 个') === -1,
    '非零密度绝不允许显示成「每分钟 0 个」，实际：' + design.evidence
  );
  // summary 必须把真实个数说出来，避免卡片上出现「0 个」却又说共 1 个提问
  assert.ok(
    r.summary.indexOf('需要思考的提问 1 个') !== -1,
    'summary 必须如实写明句级需要思考的提问数，实际：' + r.summary
  );
});

test('护栏 16：正常讲稿（有问号）的分数不被这次改动搞坏', () => {
  const NORMAL = '李同学，你说说这一步为什么这样设？然后我们来看公式。';
  const r = drillRule({ skill: 'question_wait', transcript: NORMAL, durationSec: 180 });
  const design = r.dimensions.find((d) => d.key === 'question_design');
  const wait = r.dimensions.find((d) => d.key === 'wait_time');
  // 有问号的讲稿：句级口径与问号计数口径一致，分数与改造前相同
  assert.strictEqual(design.score, 65, 'question_design 应为 65，实际：' + design.score);
  assert.strictEqual(wait.score, 0, 'wait_time 应为 0（没写等待标记），实际：' + wait.score);
  assert.ok(wait.evidence.indexOf('共 1 个提问') !== -1, '实际：' + wait.evidence);
  assert.strictEqual(r.dimensions.map((d) => d.key).slice().sort().join(','),
    'fake_question,question_design,wait_marker,wait_time', '维度 key 是冻结契约');
});

test('护栏 16：密度文案与建议文案用同一口径（≥1 用「每分钟 X 个」，<1 用「约每 M 分钟 1 个」）', () => {
  // ① 密度 ≥1：句级 3 个提问 / 3 分钟 = 1.0 → 写成「1.0 个」
  const r = drillRule({
    skill: 'question_wait',
    transcript:
      '同学们好，今天讲函数的单调性。为什么要求导呢？因为导数反映变化快慢。李同学，你说说看。（停顿，默数三秒）大家想一想，为什么导数能判断增减？',
    durationSec: 180,
  });
  const design = r.dimensions.find((d) => d.key === 'question_design');
  assert.ok(
    design.evidence.indexOf('每分钟 1.0 个需要思考的提问') !== -1,
    '≥1 时保留 1 位小数，实际：' + design.evidence
  );

  // ② 密度 <1：0.33/min → 用间隔表述「约每 3 分钟 1 个」（不写 0）
  const r2 = drillRule({ skill: 'question_wait', transcript: DRILL_REPRO2, durationSec: 180 });
  const design2 = r2.dimensions.find((d) => d.key === 'question_design');
  assert.ok(
    design2.evidence.indexOf('约每 3 分钟 1 个需要思考的提问') !== -1,
    '<1 时用间隔表述保真，实际：' + design2.evidence
  );
  assert.ok(
    design2.evidence.indexOf('每分钟 0 个') === -1,
    '非零密度不得显示成 0，实际：' + design2.evidence
  );
  const sug = r2.suggestions.find((x) => x.title.indexOf('加密有效提问') !== -1);
  assert.ok(sug, '密度不足时应有「加密有效提问」建议');
  assert.ok(
    sug.detail.indexOf('当前约每 3 分钟 1 个需要思考的提问') !== -1,
    '建议文案必须与维度文案同一口径，实际：' + sug.detail
  );
  assert.ok(
    sug.detail.indexOf('0.00') === -1,
    '建议文案不得再出现「0.00 个」这种伪精确写法，实际：' + sug.detail
  );
});

test('护栏 16：封闭式提问要从「需要思考的提问」里扣掉', () => {
  const { buildStat } = require('../lib/drill.js');
  const T = '同学们好，今天我们讲勾股定理。听懂了吗？那我们来看公式。李同学，你说说为什么这样设？';
  const st = buildStat({ transcript: T, durationSec: 180 });
  assert.strictEqual(st.questionCount, 2, '句级提问数应为 2');
  assert.strictEqual(st.closedCount, 1, '「听懂了吗？」是句级封闭式提问');
  assert.strictEqual(st.thinkingCount, 1, '需要思考的提问 = 2 − 1');
});

/* ---------- 17. 密度显示必须保真：非零绝不显示成 0 ---------- */

test('护栏 17：密度显示三档边界（0 / ≈0.33 / ≈1.2）', () => {
  const { buildStat } = require('../lib/drill.js');

  const cases = [
    {
      label: '① density = 0（真无提问）',
      transcript:
        '同学们好，今天我们讲勾股定理。两条直角边是 a 和 b，斜边是 c。a 平方加 b 平方等于 c 平方。我们用面积法推导。',
      durationSec: 180,
      expect: '每分钟 0 个需要思考的提问',
    },
    {
      label: '② density ≈ 0.33（1 个提问 / 3 分钟）',
      transcript: '同学们好。李同学，你说说为什么？听懂了吗？',
      durationSec: 180,
      expect: '约每 3 分钟 1 个需要思考的提问',
    },
    {
      label: '③ density ≈ 1.2（6 个提问 / 5 分钟）',
      transcript:
        '李同学，你说说为什么这样设？李同学，你说说为什么这样推？李同学，你说说为什么这样算？李同学，你说说为什么这样证？李同学，你说说为什么这样想？李同学，你说说为什么这样讲？',
      durationSec: 300,
      expect: '每分钟 1.2 个需要思考的提问',
    },
  ];

  cases.forEach((c) => {
    const r = drillRule({ skill: 'question_wait', transcript: c.transcript, durationSec: c.durationSec });
    const st = buildStat({ transcript: c.transcript, durationSec: c.durationSec });
    const density = st.thinkingCount / (c.durationSec / 60);
    const design = r.dimensions.find((d) => d.key === 'question_design');
    assert.ok(
      design.evidence.indexOf(c.expect) !== -1,
      c.label + ' 显示应为「' + c.expect + '」，实际：' + design.evidence
    );
    // 硬规则：密度非零时，文案里不得出现「每分钟 0 个」
    if (density > 0) {
      assert.ok(
        design.evidence.indexOf('每分钟 0 个') === -1,
        c.label + ' 非零密度不得显示成 0，实际：' + design.evidence
      );
    }
    // 建议文案与维度文案必须同一口径
    const sug = r.suggestions.find((x) => x.title.indexOf('加密有效提问') !== -1);
    if (sug) {
      assert.ok(
        sug.detail.indexOf(c.expect) !== -1,
        c.label + ' 建议文案与维度文案不一致：' + sug.detail + ' vs ' + design.evidence
      );
    }
  });
});
