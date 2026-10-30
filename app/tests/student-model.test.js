'use strict';

/**
 * 学生模型统一契约（单人拆台 × 三学生课堂）
 * ----------------------------------------------------------------
 * 用户 2026-10-30 的要求：单个学生也要按多人课堂的学生模型来。
 *
 * 「学生模型」= 一个对象 + 一条状态规则，具体是：
 *   { key, name, mood, hand_raise, speaking,
 *     attention, comprehension, state_reason, difficulty }
 *   portraitStateOf()：举手 > 发言 > 闭嘴
 *
 * 这份测试锁四件事：
 *   1. makeStudent() 的规整口径（非法 key / 缺失分数 / 字符串 "true"）；
 *   2. portraitStateOf() 的优先级（卡片与画布共用这一份，不能各写一套）；
 *   3. 单人模式真的走这个模型（源码级断言：makeStudent / studentCardHtml /
 *      drawClassStudent / sceneLayout），不是另写一个头像了事；
 *   4. 单人接口没有专注/理解数据 → 单人代码里不许出现伪造这两项的分支。
 *
 * 第 3、4 条是源码断言：无头环境里 DOM 依赖太多，不假装能跑起来，
 * 但「单人偷偷用自己的写法」这种退化必须能被抓住。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ROSTER_FILE = path.join(ROOT, 'public', 'classroom-roster.js');
const APP_FILE = path.join(ROOT, 'public', 'app.js');
const INDEX_FILE = path.join(ROOT, 'public', 'index.html');

function loadRoster() {
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ROSTER_FILE, 'utf8'), sandbox, { filename: 'classroom-roster.js' });
  return sandbox.window.jtqClassRoster;
}

const roster = loadRoster();
const APP_SRC = fs.readFileSync(APP_FILE, 'utf8');
const INDEX_SRC = fs.readFileSync(INDEX_FILE, 'utf8');

/** 取 app.js 里某个函数声明的源码（到下一个顶层 function / 大段注释为止） */
function fnSrc(name) {
  const start = APP_SRC.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'app.js 里找不到函数 ' + name);
  const rest = APP_SRC.slice(start + 1);
  const next = rest.search(/\n(?:\/\*|function |const |let |if \(|document\.addEventListener)/);
  return next === -1 ? rest : rest.slice(0, next);
}

/* ---------- 1. makeStudent 规整口径 ---------- */

test('makeStudent：合法 key 用名册里的名字，字段齐全', () => {
  const s = roster.makeStudent('geek');
  assert.strictEqual(s.key, 'geek');
  assert.strictEqual(s.name, '小霸');
  assert.strictEqual(s.mood, '😊');
  assert.strictEqual(s.hand_raise, false);
  assert.strictEqual(s.speaking, false);
  assert.strictEqual(s.attention, null);
  assert.strictEqual(s.comprehension, null);
  assert.strictEqual(s.state_reason, '');
  assert.strictEqual(s.difficulty, '');
});

test('makeStudent：非法 key 归空，不查原型链', () => {
  for (const bad of ['constructor', 'toString', '__proto__', '', null, undefined, 42, {}]) {
    const s = roster.makeStudent(bad);
    assert.strictEqual(s.key, '', '非法 key 必须是空串：' + String(bad));
    assert.strictEqual(s.name, '');
  }
  assert.strictEqual(roster.makeStudent('constructor', { key: 'drift' }).key, 'drift',
    '显式传入合法 key 也算数（调用方以第一个参数为准）');
});

test('makeStudent：分数缺失就是 null，不是 0', () => {
  for (const bad of ['', '   ', [], {}, true, null, undefined, NaN, Infinity]) {
    const s = roster.makeStudent('naughty', { attention: bad, comprehension: bad });
    assert.strictEqual(s.attention, null, 'attention=' + String(bad) + ' 应规整成 null');
    assert.strictEqual(s.comprehension, null);
  }
});

test('makeStudent：分数规整成 0–100 整数（字符串数字也认）', () => {
  assert.strictEqual(roster.makeStudent('naughty', { attention: '68.4' }).attention, 68);
  assert.strictEqual(roster.makeStudent('naughty', { attention: 120 }).attention, 100);
  assert.strictEqual(roster.makeStudent('naughty', { attention: -5 }).attention, 0);
  assert.strictEqual(roster.makeStudent('naughty', { attention: 0 }).attention, 0,
    '真的 0 分要保留 —— 与「没给数据」是两件事');
});

test('makeStudent：hand_raise / speaking 只认真正的 true', () => {
  const s = roster.makeStudent('naughty', { hand_raise: 'true', speaking: 1 });
  assert.strictEqual(s.hand_raise, false);
  assert.strictEqual(s.speaking, false);
  const t = roster.makeStudent('naughty', { hand_raise: true, speaking: true });
  assert.strictEqual(t.hand_raise, true);
  assert.strictEqual(t.speaking, true);
});

test('makeStudent：difficulty 只认白名单', () => {
  assert.strictEqual(roster.makeStudent('geek', { difficulty: 'advanced' }).difficulty, 'advanced');
  assert.strictEqual(roster.makeStudent('geek', { difficulty: 'ADVANCED' }).difficulty, '');
  assert.strictEqual(roster.makeStudent('geek', { difficulty: 'excellent' }).difficulty, '');
});

test('makeStudent：name 允许调用方覆盖（单人模式的自定义人设）', () => {
  assert.strictEqual(roster.makeStudent('drift', { name: '定制学生' }).name, '定制学生');
  assert.strictEqual(roster.makeStudent('drift', { name: '   ' }).name, '小走', '空白名回到名册');
});

test('makeStudent：非法 patch 不抛错', () => {
  for (const bad of [null, undefined, 'x', 3, []]) {
    assert.doesNotThrow(() => roster.makeStudent('naughty', bad));
  }
});

/* ---------- 2. portraitStateOf 优先级 ---------- */

test('portraitStateOf：五种状态的优先级（举手发言 > 举手 > 发言 > 走神 > 闭嘴）', () => {
  // 举手且发言 → speak-raise（张嘴 + 举手）
  assert.strictEqual(roster.portraitStateOf({ hand_raise: true, speaking: true }), 'speak-raise');
  // 只举手 → raise（闭嘴举手，示意还没开口）
  assert.strictEqual(roster.portraitStateOf({ hand_raise: true, speaking: false }), 'raise');
  // 只发言 → default（张嘴，手放下）
  assert.strictEqual(roster.portraitStateOf({ hand_raise: false, speaking: true }), 'default');
  // 沉默 → closed
  assert.strictEqual(roster.portraitStateOf({ hand_raise: false, speaking: false }), 'closed');
  // 专注度低且没发言 → idle-down（低头走神）
  assert.strictEqual(roster.portraitStateOf({ attention: 20 }), 'idle-down');
  assert.strictEqual(roster.portraitStateOf({ attention: 44 }), 'idle-down');
  // 分数够高不算走神
  assert.strictEqual(roster.portraitStateOf({ attention: 45 }), 'closed');
  assert.strictEqual(roster.portraitStateOf({ attention: 88 }), 'closed');
  // 举手 / 发言优先于走神判定
  assert.strictEqual(roster.portraitStateOf({ attention: 10, hand_raise: true }), 'raise');
  assert.strictEqual(roster.portraitStateOf({ attention: 10, speaking: true }), 'default');
});

test('portraitStateOf：分数缺失不判走神（缺失不伪装成结论）', () => {
  assert.strictEqual(roster.portraitStateOf({}), 'closed');
  assert.strictEqual(roster.portraitStateOf({ attention: null }), 'closed');
  assert.strictEqual(roster.portraitStateOf({ attention: '   ' }), 'closed');
  assert.strictEqual(roster.portraitStateOf({ attention: [] }), 'closed');
});

test('portraitStateOf：空对象 / null / 字符串 "true" 一律闭嘴', () => {
  assert.strictEqual(roster.portraitStateOf(null), 'closed');
  assert.strictEqual(roster.portraitStateOf(undefined), 'closed');
  assert.strictEqual(roster.portraitStateOf({}), 'closed');
  assert.strictEqual(roster.portraitStateOf({ hand_raise: 'true' }), 'closed');
});

test('idleRoster：默认名册也是同一套模型（三个学生，全 null 分）', () => {
  const list = roster.idleRoster();
  assert.strictEqual(list.length, 3);
  list.forEach((s) => {
    assert.ok(roster.hasKey(s.key));
    assert.strictEqual(s.attention, null);
    assert.strictEqual(s.speaking, false);
  });
});

/* ---------- 3. 单人模式真的走这个模型（源码契约） ---------- */

test('drawClassStudent：立绘状态来自 portraitStateOf，不内联三元表达式', () => {
  const fn = fnSrc('drawClassStudent');
  assert.ok(/const artState = portraitStateOf\(s\);/.test(fn),
    '画布状态判定必须读学生模型的那一份');
  assert.strictEqual(/hand_raise\) \? 'raise' :/.test(fn), false,
    '不许在绘制处再写一遍举手/发言判定，否则卡片和画布会各说一套');
});

test('单人模式：重建学生与改状态都走 makeStudent(currentPersona, …)', () => {
  const reset = fnSrc('resetSoloStudent');
  assert.ok(/makeStudent\(currentPersona/.test(reset), '换人设时要重建同一套学生对象');
  assert.ok(/renderSoloStudent\(\)/.test(reset), '重建后必须重绘卡片与场景');
  const setState = fnSrc('setSoloState');
  assert.ok(/makeStudent\(currentPersona/.test(setState), '改状态也必须过模型，不能直接改 DOM');
});

test('单人模式：卡片用 studentCardHtml，与课堂同一份模板', () => {
  const cls = fnSrc('renderClassStudents');
  assert.ok(/studentCardHtml\(s\)/.test(cls), '课堂卡片应复用模板');
  const solo = fnSrc('renderSoloStudent');
  assert.ok(/studentCardHtml\(/.test(solo), '单人卡片必须复用同一个模板');
});

test('单人模式：场景复用 drawClassStudent / sceneLayout / drawClassOverlay', () => {
  const fn = fnSrc('drawSoloScene');
  assert.ok(/sceneLayout\(\[s\], W, H, ratioOf\)/.test(fn), '1 人也用同一套站位几何（居中）');
  assert.ok(/drawClassStudent\(ctx, cx, baseY, s, maxW, maxH\)/.test(fn), '同一个立绘绘制函数');
  assert.ok(/drawClassOverlay\(ctx, cx, baseY, s, maxW, maxH\)/.test(fn), '同一张名牌与专注条');
  assert.ok(/drawClassroomLayer\(ctx, W, H, 'backdrop'\)/.test(fn), '同一块教室背景');
  assert.ok(/drawClassroomLayer\(ctx, W, H, 'desks'\)/.test(fn), '同一层课桌');
});

test('单人模式：0 尺寸画布早退，且每帧先设 transform 再清屏', () => {
  const fn = fnSrc('drawSoloScene');
  assert.ok(/if \(!rect\.width \|\| !rect\.height\) return;/.test(fn));
  const setT = fn.indexOf('ctx.setTransform(dpr, 0, 0, dpr, 0, 0)');
  const clear = fn.indexOf('ctx.clearRect');
  assert.ok(setT !== -1 && clear !== -1 && setT < clear);
  assert.ok(/if \(soloSceneCanvas\.width !== w \|\| soloSceneCanvas\.height !== h\)/.test(fn),
    '无条件重设 canvas.width 会每帧闪一下');
});

test('单人模式：不伪造专注/理解分数（单人接口没有这两项）', () => {
  const body = APP_SRC.slice(APP_SRC.indexOf('function resetSoloStudent'), APP_SRC.indexOf('function addBubble'));
  assert.strictEqual(/attention:\s*\d/.test(body), false, '单人代码不许写死 attention 数字');
  assert.strictEqual(/comprehension:\s*\d/.test(body), false, '单人代码不许写死 comprehension 数字');
});

test('单人模式：状态机含举手→发言两段，且定时器会被清掉', () => {
  const fn = fnSrc('callStudent');
  assert.ok(/hand_raise: true,\s*speaking: false/.test(fn), '先举手');
  assert.ok(/soloRaiseTimer = setTimeout\(\(\) => setSoloState\(\{ hand_raise: false, speaking: true \}/.test(fn));
  assert.ok(/clearTimeout\(soloRaiseTimer\)/.test(fn), '重开/出错时必须清掉待触发的举手定时器');
});

test('单人模式：气泡头像与卡片同一张立绘，失败退回「学」字', () => {
  const fn = fnSrc('soloAvatarHtml');
  assert.ok(/jtqStudentArt\.srcOf\(key, portraitStateOf\(soloStudent\)\)/.test(fn),
    '头像状态也要走学生模型');
  assert.ok(/'<span class="av">学<\/span>'/.test(fn), '拿不到立绘要有文字兜底');
});

/* ---------- 4. 页面结构 ---------- */

test('index.html：单人模式里有场景画布与学生卡容器', () => {
  const soloStart = INDEX_SRC.indexOf('<div id="soloMode">');
  const soloEnd = INDEX_SRC.indexOf('<!-- Tab4');
  assert.ok(soloStart !== -1 && soloEnd > soloStart);
  const block = INDEX_SRC.slice(soloStart, soloEnd);
  assert.ok(/id="soloSceneCanvas"/.test(block), '单人模式必须有场景画布');
  assert.ok(/id="soloStudents"/.test(block), '单人模式必须有学生卡容器');
  assert.ok(/aria-label="单人拆台场景/.test(block), '画布要有无障碍描述');
});

test('index.html：两个画布都引用同一份学生立绘脚本', () => {
  const before = INDEX_SRC.indexOf('students-art.js');
  const app = INDEX_SRC.indexOf('app.js?v=');
  assert.ok(before !== -1 && before < app, 'students-art.js 必须先于 app.js 加载');
});
