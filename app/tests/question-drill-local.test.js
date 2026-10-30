'use strict';

/**
 * 提问与追问专项训练 · 本地文本量规（public/question-drill-rules.js）
 * ------------------------------------------------------------------
 * 这份测试锁住三件事：
 *   1. 「邀请学生表达」不能靠裸词命中 —— 教师讲授 / 陈述事实不得判成邀请；
 *   2. 「承接学生回应」要能在 20–40 字的中文长句里匹配到局部片段，
 *      同时短回答（「不会」）不能被系统性判死；
 *   3. 返回结构、文案、证据来源一个字都不能变（前端按它渲染，历史记录也按它读）。
 *
 * 纯函数文件不依赖 DOM / localStorage，所以直接在 node:vm 的最小 sandbox
 * 里跑，不用造 DOM 桩 —— 避免「测桩」而不是测规则。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'public');

function loadRules() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(PUB, 'question-drill-rules.js'), 'utf8'),
    sandbox,
    { filename: 'question-drill-rules.js' }
  );
  const api = sandbox.window.jtqQuestionDrillRules;
  assert.ok(api, 'question-drill-rules.js 必须挂到 window.jtqQuestionDrillRules');
  assert.strictEqual(
    typeof api.evaluateLocalRules,
    'function',
    '必须导出 evaluateLocalRules'
  );
  assert.strictEqual(
    typeof api.longestCommonSubstring,
    'function',
    '必须导出 longestCommonSubstring（便于单测）'
  );
  return api;
}

const RULES = loadRules();

/** 只有教师发言的会话 */
function teacherOnly(...texts) {
  return { messages: texts.map((content) => ({ role: 'teacher', content })) };
}

function dim(evaluation, key) {
  const found = evaluation.dimensions.find((d) => d.key === key);
  assert.ok(found, '缺少维度 ' + key);
  return found;
}

function spaceOf(...texts) {
  return dim(RULES.evaluateLocalRules(teacherOnly(...texts)), 'expression_space');
}

function followOf(studentText, teacherText) {
  const session = {
    messages: [
      { role: 'student', content: studentText },
      { role: 'teacher', content: teacherText },
    ],
  };
  return dim(RULES.evaluateLocalRules(session), 'follow_up_adaptation');
}

/* ================================================================
 * A. 「邀请学生表达」—— 教师讲授 / 陈述事实不得被判成邀请
 * ================================================================ */

const NOT_INVITING = [
  '我来解释一下这个公式，大家看这里。',
  '这道题有三种不同的方法。',
  '注意，解释这一步要写清楚。',
  '我们来看这个结论。',
];

NOT_INVITING.forEach((text) => {
  test('A·不邀请：' + text, () => {
    const evaluation = RULES.evaluateLocalRules(teacherOnly(text));
    const space = dim(evaluation, 'expression_space');
    const clear = dim(evaluation, 'clear_question_task');

    assert.strictEqual(space.score, 0, '不得给表达空间分：' + text);
    assert.notStrictEqual(space.evidence_status, 'observed', '不得标 observed');
    /* 这四句既没有邀请，也没有向学生发出问题/任务 → 两项都是 0，
       不能靠 clearQuote 兜底成「部分线索 1 分」 */
    assert.strictEqual(clear.score, 0, '也不该算提出明确问题或任务');
    assert.strictEqual(clear.evidence_status, 'not-found');
    assert.strictEqual(space.evidence_status, 'not-found');
  });
});

const INVITING = [
  '请说说你的思路。',
  '你为什么这么想？',
  '大家还有别的解法吗？',
  '能说说你的理由吗？',
  '谁来解释一下这一步？',
];

INVITING.forEach((text) => {
  test('A·邀请：' + text, () => {
    const space = spaceOf(text);
    assert.strictEqual(space.score, 2, '应判为邀请学生表达：' + text);
    assert.strictEqual(space.evidence_status, 'observed');
    assert.strictEqual(space.evidence_quote, text, '证据句就是这句原话');
  });
});

test('A·兜底：只有提问没有邀请展开 → 部分线索 1 分（不冒充邀请）', () => {
  const space = spaceOf('大家能理解吗？');
  assert.strictEqual(space.score, 1);
  assert.strictEqual(space.evidence_status, 'partial');
});

test('A·假提问：「会了吗」不是邀请说思路', () => {
  /* 句子里有「方法」+ 问号，但问的是「会了吗」，学生只需点头 */
  const space = spaceOf('这个方法大家会了吗？');
  assert.notStrictEqual(space.evidence_status, 'observed');
  assert.strictEqual(space.score, 1);
});

/* ================================================================
 * B. 「承接学生回应」
 * ================================================================ */

test('B·observed：学生 33 字长句 + 教师接住局部（x 是负数）后追问', () => {
  const follow = followOf(
    '我觉得老师你写的这个公式在特殊情况下就不成立了因为如果x是负数的话',
    '你刚才说 x 是负数，能展开讲讲吗'
  );
  assert.strictEqual(follow.evidence_status, 'observed');
  assert.strictEqual(follow.score, 2);
});

test('B·observed：中英混排（因为sin所以cos）也能接住', () => {
  const follow = followOf('因为sin所以cos', '你说因为sin所以cos，为什么呢');
  assert.strictEqual(follow.evidence_status, 'observed');
  assert.strictEqual(follow.score, 2);
});

test('B·partial：接住了原话但直接换人（终止语）', () => {
  const follow = followOf('不会', '你刚才说不会，那我们换个人');
  assert.strictEqual(follow.evidence_status, 'partial');
  assert.strictEqual(follow.score, 1);
});

test('B·partial：接住了原话但跳到下一题（终止语）', () => {
  const follow = followOf('不知道为什么', '你刚才说不知道，那我们看下一题');
  assert.strictEqual(follow.evidence_status, 'partial');
  assert.strictEqual(follow.score, 1);
});

test('B·partial：继续追问但没接住学生原话', () => {
  const follow = followOf(
    '我觉得这个公式在负数情况下不成立',
    '那你说说理由？'
  );
  assert.strictEqual(follow.evidence_status, 'partial');
  assert.strictEqual(follow.score, 1);
});

test('B·not-found：既不承接也不追问 → 0 分但不是「不评分」', () => {
  const follow = followOf('我觉得这个公式不成立', '同学们把这个结论记下来。');
  assert.strictEqual(follow.evidence_status, 'not-found');
  assert.strictEqual(follow.score, 0);
});

test('B·not-observable：完全没有学生发言', () => {
  const evaluation = RULES.evaluateLocalRules(
    teacherOnly('请说说你的思路。', '你再想想。')
  );
  const follow = dim(evaluation, 'follow_up_adaptation');
  assert.strictEqual(follow.evidence_status, 'not-observable');
  assert.strictEqual(follow.score, 0);
  assert.strictEqual(follow.evidence_quote, '');
});

test('B·短回答不吃亏：学生「不会」+ 教师承接并继续追问 → observed', () => {
  const follow = followOf('不会', '你刚才说不会，那你觉得卡在哪一步呢？');
  assert.strictEqual(follow.evidence_status, 'observed');
  assert.strictEqual(follow.score, 2);
});

/* ----------------------------------------------------------------
 * B2. 终止语只作用于它所在的分句
 * ----------------------------------------------------------------
 * 「先接纳学生的顾虑，再邀请他说思路」是这套量规最该奖励的动作。
 * 旧实现是整句命中 FOLLOW_ABORT 即降级：一句「没关系」把后半句的
 * 「你再说说你的思路？」一起打死，判 0 分，比「换个人」还低，会把
 * 真实师范生教错方向。这里锁住分句级判定：
 *   任一「不含终止语的分句」带追问标记 → 继续追问，终止语不降级。
 * ---------------------------------------------------------------- */

const ACK_THEN_ASK = [
  ['不会', '没关系，你再说说你的思路？'],
  ['不会', '不要紧，那你能说说你是怎么想的吗？'],
  ['不知道为什么', '没关系，我们一起理一理，你先说第一步想到什么？'],
];

ACK_THEN_ASK.forEach(([studentText, teacherText]) => {
  test('B2·接纳后继续追问 → observed：' + teacherText, () => {
    const follow = followOf(studentText, teacherText);
    assert.strictEqual(
      follow.evidence_status,
      'observed',
      '接纳顾虑 + 继续追问必须是 observed（0 分是方向性误判）：' + teacherText
    );
    assert.strictEqual(follow.score, 2);
    assert.strictEqual(follow.evidence_quote, teacherText, '证据句是这句原话');
  });
});

const ABORT_WITHOUT_ASK = [
  ['不会', '没关系，我们看下一题'],
  ['不会', '你刚才说不会，那我们换个人'],
];

ABORT_WITHOUT_ASK.forEach(([studentText, teacherText]) => {
  test('B2·只有终止语、没有追问 → 不得 observed：' + teacherText, () => {
    const follow = followOf(studentText, teacherText);
    assert.notStrictEqual(
      follow.evidence_status,
      'observed',
      '终止语之后没有任何追问标记，不能判 observed：' + teacherText
    );
    assert.ok(
      follow.score === 1 || follow.score === 0,
      '只能是 partial(1) 或 not-found(0)，实际 ' + follow.score
    );
  });
});

test('B2·同一分句里既终止又追问（换个人说说）→ 仍按终止算', () => {
  /* 终止语只对「自己所在的分句」生效；同一分句内不拆开，
     因为「换个人说说你的思路」确实不是在跟这个学生继续聊。
     这里追问标记和终止语挤在一句里，也没有承接原话 → 只能是 0，不得 observed。 */
  const follow = followOf('不会', '那我们换个人说说你的思路？');
  assert.notStrictEqual(follow.evidence_status, 'observed');
  assert.strictEqual(follow.score, 0);
});

/* ----------------------------------------------------------------
 * B2-2. 接纳语不得单独升 observed：必须带第二人称回指（B2 组第 7–9 条）
 * ----------------------------------------------------------------
 * 「没关系」是学生答错时的标准开场语，覆盖率极高。它单独就计分，
 * 等于把一个罕见漏报换成了高频误报：
 *   「没关系，那地球是什么形状？」—— 换话题了，没接这个学生；
 *   「没关系，我来解释一下平行线」—— 教师自述讲解（TEACHER_SELF_CLAUSE）；
 *   「没关系，继续说」—— 学生答对了，「没关系」本身是病句。
 * 三条都有「没关系」，且都带追问标记。规则能机械区分的唯一线索是
 * 追问分句里有没有第二人称回指（「你 / 您」）：指回学生才算承接。
 * 这三条同时锁住「排除教师自述分句」——第 2 条靠 TEACHER_SELF_CLAUSE。
 * ---------------------------------------------------------------- */

const ACK_BUT_NO_BACKREFERENCE = [
  ['我觉得三角形内角和是200度', '没关系，那地球是什么形状？'],
  ['我觉得三角形内角和是200度', '没关系，我来解释一下平行线'],
  ['我认为是180度因为平角', '没关系，继续说'],
];

ACK_BUT_NO_BACKREFERENCE.forEach(([studentText, teacherText]) => {
  test('B2·接纳语但没有第二人称回指 → 不得 observed：' + teacherText, () => {
    const follow = followOf(studentText, teacherText);
    assert.notStrictEqual(
      follow.evidence_status,
      'observed',
      '接纳语不能单独证明承接的是这个学生（悬空的「没关系」是换话题/自述讲解）：' +
        teacherText
    );
    assert.ok(
      follow.score === 1 || follow.score === 0,
      '只能是 partial(1) 或 not-found(0)，实际 ' + follow.score
    );
  });
});

/* ----------------------------------------------------------------
 * B2-3. 「没关系」只作接纳语，不作终止语
 * ----------------------------------------------------------------
 * 同一个词挂两个身份，会在**无逗号**写法上炸掉：
 *   学生「不会」→ 教师「没关系你再说说你的思路？」（整句一个分句）
 * 旧实现里 FOLLOW_ABORT 含「没关系」，这一句整句判终止 → 0/not-found。
 * 但那正是「先接住处境、再请他说思路」，比「换个人」还低分，属于方向性误判。
 * 修法是把它从 FOLLOW_ABORT 删掉（保留在 FOLLOW_ACK）。
 * 下面三条同时锁住「删了之后没有副作用」：
 *   1. 终止语「下一题」自己还在 → 仍然不得 observed；
 *   2. 无逗号写法 → 必须升到 observed(2)；
 *   3. 终止语「换个人」还在 → 仍是 partial(1)（承接了原话但收口）。
 * 第 3 条是这次的护栏：它证明删掉「没关系」没有连带削弱别的终止语。
 * ---------------------------------------------------------------- */

test('B2·「没关系」不再算终止语：无逗号「没关系你再说说你的思路？」→ observed(2)', () => {
  /* 整句只有一个分句，旧实现靠 FOLLOW_ABORT 里的「没关系」把它整句打死。 */
  const follow = followOf('不会', '没关系你再说说你的思路？');
  assert.strictEqual(
    follow.evidence_status,
    'observed',
    '接纳处境 + 同一句里请他说思路，是这套量规最该奖励的动作，不得判 0'
  );
  assert.strictEqual(follow.score, 2);
  assert.strictEqual(follow.evidence_quote, '没关系你再说说你的思路？');
});

test('B2·删掉「没关系」后仍挡得住：「没关系，我们看下一题」→ 不得 observed', () => {
  /* 靠后半句的「下一题」终止，且前后都没有追问标记 → 0。
     这条防止「为了修无逗号写法，把终止判定整体放松」。 */
  const follow = followOf('不会', '没关系，我们看下一题');
  assert.notStrictEqual(
    follow.evidence_status,
    'observed',
    '「下一题」还在终止语里，不能因为删了「没关系」就变成 observed'
  );
  assert.strictEqual(follow.score, 0, '没有任何追问标记，应为 not-found(0)');
  assert.strictEqual(follow.evidence_status, 'not-found');
});

test('B2·删掉「没关系」后仍挡得住：「你刚才说不会，那我们换个人」→ partial(1)', () => {
  /* 前半句接住了「不会」（LCS），后半句「换个人」终止 → 承接成立、追问不成立。 */
  const follow = followOf('不会', '你刚才说不会，那我们换个人');
  assert.strictEqual(follow.evidence_status, 'partial');
  assert.strictEqual(follow.score, 1);
});

/* ----------------------------------------------------------------
 * B3. 答对场景的肯定语也算承接（与接纳语完全同条件）
 * ----------------------------------------------------------------
 * 「肯定 + 追问理由」是标准教学动作：
 *   学生「我认为是180度因为平角」→ 教师「说得对，你再说说为什么是平角？」
 * 旧实现只认接纳语（答错场景），这一句判 partial(1)，等于惩罚正确行为。
 * 但肯定语绝不能开后门：它和接纳语一样，只是课堂通用开场语，
 * 单独不能证明承接的是这个学生。所以**必须同时**满足
 *   ① 有追问分句；② 该分句含第二人称回指（你/您）
 * 才升 observed。下面三条分别锁住「成立」「无追问」「无回指」三个分支。
 * ---------------------------------------------------------------- */

test('B3·肯定语 + 追问 + 第二人称回指 → observed(2)', () => {
  const follow = followOf('我认为是180度因为平角', '说得对，你再说说为什么是平角？');
  assert.strictEqual(
    follow.evidence_status,
    'observed',
    '肯定 + 对同一个学生追问理由，是正确行为，不得判 partial'
  );
  assert.strictEqual(follow.score, 2);
  assert.strictEqual(follow.evidence_quote, '说得对，你再说说为什么是平角？');
});

test('B3·肯定语但没有追问 → 不得 observed：「很好，我们看下一题」', () => {
  /* 「很好」既可能在肯定，也可能在收场。没有追问分句就只是收场。 */
  const follow = followOf('我认为是180度因为平角', '很好，我们看下一题');
  assert.notStrictEqual(
    follow.evidence_status,
    'observed',
    '只有肯定没有追问，不能证明教师还在跟这个学生聊'
  );
  assert.strictEqual(follow.score, 0);
});

test('B3·肯定语 + 追问但无第二人称回指 → 不得 observed（保守口径）', () => {
  /* 「那如果换成负数呢？」在追问，但没指回「你」，可能是问全班/引出下一步。
     肯定语不得因为「有追问」就绕过回指约束 —— 与接纳语同一条线。 */
  const follow = followOf('我认为是180度因为平角', '答对了，那如果换成负数呢？');
  assert.notStrictEqual(
    follow.evidence_status,
    'observed',
    '肯定语不得开后门：没有第二人称回指时走保守口径'
  );
  assert.strictEqual(follow.score, 1, '追问成立、承接未确认 → partial(1)');
  assert.strictEqual(follow.evidence_status, 'partial');
});

/* ================================================================
 * 最长公共子串（导出的纯函数）
 * ================================================================ */

test('LCS：找出中文长句里的局部片段，而不是贪婪整句', () => {
  const lcs = RULES.longestCommonSubstring;
  assert.strictEqual(lcs('abc', 'xabcx'), 'abc');
  assert.strictEqual(lcs('', 'abc'), '');
  assert.strictEqual(lcs('负数情况', 'x是负数，'), '负数');
  assert.strictEqual(
    lcs('我觉得这个公式不成立', '你说这个公式不成立'),
    '这个公式不成立'
  );
});

/* ================================================================
 * C. 不可回归项：结构 / 文案 / 证据来源
 * ================================================================ */

test('C·返回结构的字段名与取值与历史版本一致', () => {
  const evaluation = RULES.evaluateLocalRules({
    messages: [
      { role: 'teacher', content: '请说说你的思路。' },
      { role: 'student', content: '我不太确定。' },
      { role: 'teacher', content: '你刚才说不太确定，能说说卡在哪吗？' },
    ],
  });

  assert.deepStrictEqual(Object.keys(evaluation).sort(), [
    'boundary_note',
    'dimensions',
    'evaluation_source',
    'rubric_version',
    'status',
    'summary',
  ]);
  assert.strictEqual(evaluation.status, 'complete');
  assert.strictEqual(evaluation.evaluation_source, 'local-heuristic');
  /* 规则语义已实质变更（拒绝裸词、改 LCS 判据、加接纳语分支 + 第二人称
     回指约束），v1 打的分和现在的分不可比，因此升到 v2。旧历史记录里
     存的 v1 是事实记录，不改写。 */
  assert.strictEqual(evaluation.rubric_version, 'question-drill-v2');
  assert.strictEqual(
    evaluation.summary,
    '本反馈只依据文本中可观察到的表达线索。规则未识别到某项行为，不代表该行为一定没有发生。'
  );
  assert.strictEqual(
    evaluation.boundary_note,
    '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。'
  );

  /* 规则在 vm 里跑，数组来自另一个 realm；用 Array.from 转回本 realm 再比较，
     否则 deepStrictEqual 会因为原型不同而报「结构相同但非同一引用」 */
  assert.deepStrictEqual(
    Array.from(evaluation.dimensions, (d) => d.key),
    ['clear_question_task', 'expression_space', 'follow_up_adaptation']
  );

  evaluation.dimensions.forEach((d) => {
    assert.deepStrictEqual(Object.keys(d).sort(), [
      'evidence_quote',
      'evidence_status',
      'feedback',
      'key',
      'score',
    ]);
    assert.ok(typeof d.feedback === 'string' && d.feedback.length > 0);
    assert.ok([0, 1, 2].includes(d.score));
    assert.ok(
      ['observed', 'partial', 'not-observable', 'not-found'].includes(
        d.evidence_status
      )
    );
  });
});

test('C·不新增总分 / 求合字段', () => {
  const evaluation = RULES.evaluateLocalRules({
    messages: [{ role: 'teacher', content: '请说说你的思路。' }],
  });
  ['total', 'total_score', 'score', 'sum', 'average'].forEach((key) => {
    assert.strictEqual(key in evaluation, false, '不得出现 ' + key);
  });
});

test('C·evidence_quote 必须是教师原话的子串（不得编造）', () => {
  const teacherLines = [
    '同学们看这个公式。',
    '你刚才说 x 是负数，能展开讲讲吗？',
  ];
  const evaluation = RULES.evaluateLocalRules({
    messages: [
      { role: 'teacher', content: teacherLines[0] },
      { role: 'student', content: '因为如果x是负数的话分母就为零了' },
      { role: 'teacher', content: teacherLines[1] },
    ],
  });

  evaluation.dimensions.forEach((d) => {
    if (!d.evidence_quote) return;
    assert.ok(
      teacherLines.some((line) => line.includes(d.evidence_quote)),
      '证据句必须出自教师发言：' + d.evidence_quote
    );
  });
});

test('C·空 / 残缺 session 不抛错', () => {
  [undefined, {}, { messages: null }, { messages: [null, {}] }].forEach((s) => {
    const evaluation = RULES.evaluateLocalRules(s);
    assert.strictEqual(evaluation.status, 'complete');
    assert.strictEqual(evaluation.dimensions.length, 3);
    assert.strictEqual(
      dim(evaluation, 'follow_up_adaptation').evidence_status,
      'not-observable'
    );
  });
});

/* ================================================================
 * 接线：页面 / 构建脚本 / 调用方
 * ================================================================ */

test('接线：index.html 先引 rules 再引 question-drill，版本号成对', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const rules = html.match(/<script src="question-drill-rules\.js\?v=([^"]+)"/);
  const drill = html.match(/<script src="question-drill\.js\?v=([^"]+)"/);
  assert.ok(rules, 'index.html 必须引用 question-drill-rules.js');
  assert.ok(drill, 'index.html 必须引用 question-drill.js');
  assert.strictEqual(rules[1], drill[1], '两个文件必须用同一个版本号');
  assert.ok(
    html.indexOf('question-drill-rules.js') < html.indexOf('question-drill.js'),
    'rules 必须在 question-drill.js 之前加载，否则运行时取不到规则'
  );
});

test('接线：构建脚本内联顺序 rules → question-drill', () => {
  const build = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'build-standalone.js'),
    'utf8'
  );
  const list = build.match(/const LOCAL_SCRIPTS = \[([\s\S]*?)\];/);
  assert.ok(list, '未找到 LOCAL_SCRIPTS');
  const files = list[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.ok(files.includes('question-drill-rules.js'), '必须内联规则文件');
  assert.ok(
    files.indexOf('question-drill-rules.js') < files.indexOf('question-drill.js'),
    '离线版里 rules 也必须排在前面，否则双击打开就报错'
  );
});

test('接线：question-drill.js 走规则模块，且不再残留旧判定正则', () => {
  const code = fs.readFileSync(path.join(PUB, 'question-drill.js'), 'utf8');
  assert.ok(
    code.indexOf('window.jtqQuestionDrillRules') !== -1,
    '必须调用 window.jtqQuestionDrillRules'
  );
  assert.ok(
    code.indexOf('evaluateLocalRules') !== -1,
    '必须调用 evaluateLocalRules'
  );
  assert.ok(
    code.indexOf('本地文本规则未能加载') !== -1,
    '规则缺失时必须有降级提示（不能白屏抛错）'
  );
  /* 旧实现的三条特征正则不得回来 */
  assert.strictEqual(code.indexOf('spacePattern'), -1, '旧的 spacePattern 必须移除');
  assert.strictEqual(code.indexOf('followPattern'), -1, '旧的 followPattern 必须移除');
  assert.strictEqual(
    code.indexOf('[\\u4e00-\\u9fff]{2,}'),
    -1,
    '贪婪整句分词正则必须移除（它是长句漏判的根源）'
  );
});

/* ================================================================
 * D. 集成：真的把 question-drill.js 跑起来（含规则缺失的降级）
 * ----------------------------------------------------------------
 * 只实现这个模块真正调用到的 DOM API；这里要验的不是 DOM，而是
 * 「规则接上了没有」和「规则缺失时不白屏、不伪造分数」。
 * ================================================================ */

function makeDrillEnv({ withRules, seed } = {}) {
  const registry = {};

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this._text = '';
      this.value = '';
      this.hidden = false;
      this.disabled = false;
      this.className = '';
      this.style = {};
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this._id = '';
    }
    set id(v) { this._id = v; registry[v] = this; }
    get id() { return this._id; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
    append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
    appendChild(n) { if (n) { n.parent = this; this.children.push(n); } return n; }
    insertBefore(n, ref) {
      const i = this.children.indexOf(ref);
      if (i < 0) this.appendChild(n); else this.children.splice(i, 0, n);
      return n;
    }
    replaceChildren(...nodes) {
      this.children.forEach((c) => { c.parent = null; });
      this.children = nodes;
      nodes.forEach((c) => { c.parent = this; });
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener() {}
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
    focus() {}
    get firstElementChild() { return this.children[0] || null; }
    click() { (this.listeners.click || []).forEach((fn) => fn({ type: 'click' })); }
  }

  const docListeners = {};
  const document = {
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => new El(tag),
    querySelector: () => new El('button'),
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    dispatchEvent(event) { (docListeners[event.type] || []).forEach((fn) => fn(event)); },
  };

  [
    'trainingInput', 'pane-chat', 'analyzeBtn',
    'questionDrillPanel', 'questionDrillGoal', 'questionDrillQuote',
    'questionDrillStart', 'questionDrillStatus', 'questionDrillConversation',
    'questionDrillForm', 'questionDrillTeacherInput', 'questionDrillFinish',
    'questionDrillRoundInfo', 'questionDrillReport', 'questionDrillHistory',
    'questionDrillHistoryList',
  ].forEach((id) => { const el = new El('div'); el.id = id; });

  const store = Object.assign({}, seed || {});
  const sandbox = {
    document,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { search: '' },
    console,
    JSON,
    Date,
    Math,
    Promise,
    URLSearchParams,
    JTQ_DEMO_PAGE: false,
    window: { crypto: { randomUUID: () => 'uuid-free' } },
    post: async () => ({ reply: '我不太确定。', engine: 'llm' }),
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  if (withRules) {
    vm.runInContext(
      fs.readFileSync(path.join(PUB, 'question-drill-rules.js'), 'utf8'),
      sandbox,
      { filename: 'question-drill-rules.js' }
    );
  }
  vm.runInContext(
    fs.readFileSync(path.join(PUB, 'question-drill.js'), 'utf8'),
    sandbox,
    { filename: 'question-drill.js' }
  );

  return { registry, store, sandbox };
}

/* 已进行到第 2 轮的草稿，直接点「结束」即可触发评价 */
const DRAFT = {
  status: 'in-progress',
  session_id: 'local-test-1',
  goal: { key: 'leave-space', label: '给学生留下表达思路的空间' },
  misconception_label: '会记结论，但说不清理由',
  topic: '负指数幂',
  practice_quote: '大家能理解吗？',
  teacher_turns: 2,
  is_demo: false,
  messages: [
    { role: 'teacher', content: '请说说你的思路。' },
    { role: 'student', content: '我觉得这个公式在负数情况下不成立' },
    { role: 'teacher', content: '你说这个公式在负数情况下不成立，能展开讲讲吗？' },
  ],
};

/* 桩的 textContent 只存自身文本，取整段文字要递归（真实 DOM 是递归的） */
function collectText(node) {
  let out = typeof node.textContent === 'string' ? node.textContent : '';
  (node.children || []).forEach((child) => { out += ' ' + collectText(child); });
  return out;
}

test('集成：规则接上后，结束训练会写入带 evidence_status 的评价', () => {
  const env = makeDrillEnv({
    withRules: true,
    seed: { jtq_question_drill_draft: JSON.stringify(DRAFT) },
  });

  assert.strictEqual(
    env.registry.questionDrillForm.hidden,
    false,
    '草稿恢复后表单应可见'
  );
  assert.strictEqual(
    env.registry.questionDrillConversation.children.length,
    3,
    '草稿里的 3 条对话应恢复渲染'
  );

  env.registry.questionDrillFinish.click();

  const saved = JSON.parse(env.store['jtq_question_drill_sessions'] || '[]');
  assert.strictEqual(saved.length, 1, '完成会话应写入本机记录');
  const evaluation = saved[0].evaluation;
  assert.strictEqual(evaluation.evaluation_source, 'local-heuristic');
  /* 本机新写入的历史记录必须是 v2：v1 的分和 v2 的分不可比。 */
  assert.strictEqual(evaluation.rubric_version, 'question-drill-v2');
  assert.strictEqual(evaluation.dimensions.length, 3);
  assert.strictEqual(
    evaluation.dimensions.find((d) => d.key === 'expression_space').score,
    2,
    '「请说说你的思路」应判为邀请展开'
  );
  assert.strictEqual(
    evaluation.dimensions.find((d) => d.key === 'follow_up_adaptation')
      .evidence_status,
    'observed',
    '长句承接 + 继续追问应判 observed'
  );
  assert.ok(
    env.registry.questionDrillReport.children.length > 0,
    '反馈面板要有内容'
  );
});

test('集成：规则模块缺失时降级——不抛错、不写入、不伪造分数', () => {
  const env = makeDrillEnv({
    withRules: false,
    seed: { jtq_question_drill_draft: JSON.stringify(DRAFT) },
  });

  assert.doesNotThrow(() => env.registry.questionDrillFinish.click());

  assert.strictEqual(
    env.store['jtq_question_drill_sessions'],
    undefined,
    '规则缺失时不得写入任何评价（更不能写 0 分）'
  );
  assert.ok(
    String(env.registry.questionDrillStatus.textContent).indexOf(
      '本地文本规则未能加载'
    ) !== -1,
    '必须给出人话提示：' + env.registry.questionDrillStatus.textContent
  );
  assert.ok(
    collectText(env.registry.questionDrillConversation).indexOf(
      '本地文本规则未能加载'
    ) !== -1,
    '对话区必须留一条系统提示，而不是静默失败'
  );
});
