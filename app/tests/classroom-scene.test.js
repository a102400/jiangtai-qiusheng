'use strict';

/**
 * 2D 教室场景 —— 几何与绘制契约测试
 * ------------------------------------------------------------------
 * 背景：drawClassScene() 从上线起就**零断言**。无头环境拿不到 Canvas 像素，
 * 所以这里不假装能测像素，而是把「会算错」的部分拆干净来测：
 *
 *   1. 站位与包围盒（sceneLayout）：人数变化后是否还在左半边、窄画布是否溢出；
 *   2. 命中（hitTest）：点在两人中间的空隙必须返回 null，不能就近吸附；
 *   3. 绘制契约（读源码）：0 尺寸早退、每帧重设 transform、非法角色兜底。
 *
 * 第 3 层是源码断言，看着"不优雅"，但它抓的是真实故障：
 * 之前画布在隐藏 Tab 里尺寸为 0，setTransform(0,0,...) 之后再也没恢复，
 * 切回来时整个画面消失。这种事没有断言就只能靠人眼发现。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const roster = require('../public/classroom-roster.js');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

/* ---------- 1. figSize ---------- */

test('figSize：高度够用时按高度撑满', () => {
  const s = roster.figSize(216, 223.2, 0.78);
  assert.strictEqual(s.h, 223.2);
  assert.ok(Math.abs(s.w - 223.2 * 0.78) < 1e-9);
});

test('figSize：宽度受限时回缩，且保持宽高比', () => {
  const s = roster.figSize(81, 223.2, 0.78);
  assert.strictEqual(s.w, 81);
  assert.ok(Math.abs(s.h - 81 / 0.78) < 1e-9);
  assert.ok(s.h < 223.2, '宽度吃紧时高度必须跟着降，否则人物会被压扁');
});

test('figSize：非法 ratio 回落到 0.78，不产生 NaN / Infinity', () => {
  for (const bad of [0, -1, NaN, Infinity, null, undefined, '0.5']) {
    const s = roster.figSize(200, 200, bad);
    assert.ok(isFinite(s.w) && isFinite(s.h), 'ratio=' + String(bad) + ' 产生了非有限数');
    assert.ok(s.w > 0 && s.h > 0);
  }
});

test('figSize：画布尺寸为 0 时返回 0，不返回负数', () => {
  const s = roster.figSize(0, 0, 0.78);
  assert.strictEqual(s.w, 0);
  assert.strictEqual(s.h, 0);
});

/* ---------- 2. slotRatios ---------- */

test('slotRatios：1 / 2 / 3 人的站位', () => {
  assert.deepStrictEqual(roster.slotRatios(1), [0.5]);
  assert.deepStrictEqual(roster.slotRatios(2), [0.33, 0.67]);
  assert.deepStrictEqual(roster.slotRatios(3), [0.25, 0.5, 0.75]);
});

test('slotRatios：0 人或异常输入也不返回空数组以外的怪东西', () => {
  assert.deepStrictEqual(roster.slotRatios(0), [0.5], '0 人按 1 人处理，调用方不会崩');
  assert.strictEqual(roster.slotRatios(-3).length, 1);
});

/* ---------- 3. sceneLayout ---------- */

test('sceneLayout：3 人在 800×360 画布上的站位与包围盒', () => {
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }, { key: 'drift' }], 800, 360, () => 0.78);
  assert.strictEqual(slots.length, 3);
  assert.deepStrictEqual(slots.map((s) => s.cx), [200, 400, 600]);
  const s0 = slots[0];
  assert.ok(Math.abs(s0.h - 223.2) < 1e-9);
  assert.ok(Math.abs(s0.w - 174.096) < 1e-9);
  assert.ok(Math.abs(s0.top - 81) < 1e-9, 'top = 360*0.845 - 223.2');
  assert.ok(Math.abs(s0.bottom - 304.2) < 1e-9);
  assert.ok(Math.abs(s0.left - (200 - 87.048)) < 1e-9);
});

test('sceneLayout：只剩两人时不再挤在左半边', () => {
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }], 800, 360, () => 0.78);
  assert.deepStrictEqual(slots.map((s) => s.cx), [264, 536]);
  assert.ok(slots[1].cx > 400, '第二个人必须越过中线，否则画面重心全在左');
});

test('sceneLayout：超过 3 人只取前 3 个', () => {
  const many = ['naughty', 'geek', 'drift', 'naughty', 'geek'].map((key) => ({ key }));
  assert.strictEqual(roster.sceneLayout(many, 800, 360).length, 3);
});

test('sceneLayout：空名册返回空数组，不抛错', () => {
  assert.deepStrictEqual(roster.sceneLayout([], 800, 360), []);
  assert.deepStrictEqual(roster.sceneLayout(null, 800, 360), []);
});

test('sceneLayout：画布宽 0（隐藏 Tab）时不产生 NaN', () => {
  const slots = roster.sceneLayout([{ key: 'geek' }], 0, 0, () => 0.78);
  assert.strictEqual(slots.length, 1);
  for (const v of [slots[0].cx, slots[0].top, slots[0].w, slots[0].h]) {
    assert.ok(isFinite(v), '隐藏时算出了 NaN：' + v);
  }
});

test('sceneLayout：非法 key 归空（不套用别人的人设比例），但站位照算', () => {
  const slots = roster.sceneLayout([{ key: 'constructor' }], 800, 360, (k) => (k === 'constructor' ? 2 : 0.78));
  assert.strictEqual(slots[0].key, '', '非法 key 必须清空，否则会画出不该有的角色');
  assert.ok(Math.abs(slots[0].w / slots[0].h - 0.78) < 1e-9, '非法 key 应当走默认比例，而不是攻击者给的那个');
});

test('sceneLayout：不同角色用各自的宽高比（立绘不等宽）', () => {
  const ratioOf = (k) => (k === 'geek' ? 0.5 : 0.9);
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }], 1200, 360, ratioOf);
  assert.ok(slots[0].w > slots[1].w, '宽高比大的应当更宽');
});

/* ---------- 4. hitTest ---------- */

test('hitTest：点在人身上命中', () => {
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }, { key: 'drift' }], 800, 360, () => 0.78);
  assert.strictEqual(roster.hitTest(slots, 200, 300).key, 'naughty');
  assert.strictEqual(roster.hitTest(slots, 400, 300).key, 'geek');
  assert.strictEqual(roster.hitTest(slots, 600, 300).key, 'drift');
});

test('hitTest：点在两人中间的空隙返回 null，不做就近吸附', () => {
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }, { key: 'drift' }], 800, 360, () => 0.78);
  assert.strictEqual(roster.hitTest(slots, 300, 300), null, '空隙不能点名');
  assert.strictEqual(roster.hitTest(slots, 500, 300), null);
});

test('hitTest：点在人物头顶上方不命中', () => {
  const slots = roster.sceneLayout([{ key: 'geek' }], 800, 360, () => 0.78);
  assert.strictEqual(roster.hitTest(slots, 400, 10), null, '黑板区域不能点名');
});

test('hitTest：pad 只向外扩，不扩大到隔壁', () => {
  const slots = roster.sceneLayout([{ key: 'naughty' }, { key: 'geek' }], 800, 360, () => 0.78);
  // 小皮右边界 ≈ 264-87=177? 不，2 人时 cx=[264,536]，halfW=87.048 → 小皮右边界 351.05
  const rightEdge = slots[0].right;
  assert.strictEqual(roster.hitTest(slots, rightEdge + 2, 300), null);
  assert.strictEqual(roster.hitTest(slots, rightEdge + 2, 300, 4).key, 'naughty', 'pad 应让它可点');
});

test('hitTest：非法输入不抛错', () => {
  assert.strictEqual(roster.hitTest(null, 1, 1), null);
  assert.strictEqual(roster.hitTest([null, undefined], 1, 1), null);
  assert.strictEqual(roster.hitTest([], 1, 1), null);
});

/* ---------- 5. 绘制契约（读源码） ---------- */

test('drawClassScene：画布尺寸为 0 时提前退出（隐藏 Tab 里不画）', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassScene()'), APP_SRC.indexOf('function classBubble'));
  assert.ok(/if \(!rect\.width \|\| !rect\.height\) return;/.test(fn),
    '0 尺寸必须早退，否则会画出 0×0 的画布并留下错误的 transform');
  assert.ok(/if \(!classSceneCtx \|\| !classSceneCanvas \|\| classMode\.hidden\) return;/.test(fn));
});

test('drawClassScene：每帧重设 transform（dpr 缩放不能被上一帧残留）', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassScene()'), APP_SRC.indexOf('function classBubble'));
  const setT = fn.indexOf('ctx.setTransform(dpr, 0, 0, dpr, 0, 0)');
  const clear = fn.indexOf('ctx.clearRect');
  assert.ok(setT !== -1 && clear !== -1);
  assert.ok(setT < clear, '必须先设 transform 再清屏，否则 clearRect 只清掉左上角一小块');
});

test('drawClassScene：宽高变化时才重设 canvas.width（每次重设都会清空画布）', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassScene()'), APP_SRC.indexOf('function classBubble'));
  assert.ok(/if \(classSceneCanvas\.width !== w \|\| classSceneCanvas\.height !== h\)/.test(fn),
    '无条件赋值 canvas.width 会每帧清空并导致闪烁');
});

test('drawClassScene：站位来自 sceneLayout，不再内联一份比例数组', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassScene()'), APP_SRC.indexOf('function classBubble'));
  assert.ok(/sceneLayout\(seated, W, H, ratioOf\)/.test(fn));
  assert.strictEqual(fn.indexOf('[0.25, 0.5, 0.75]'), -1, '站位比例只能有一份（在 roster 里）');
});

test('drawClassScene：绘制后保存站位供点击命中', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassScene()'), APP_SRC.indexOf('function classBubble'));
  assert.ok(/lastClassSlots = slots;/.test(fn));
});

test('drawClassStudent：尺寸公式来自 figSize，与命中盒子同源', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassStudent'), APP_SRC.indexOf('function drawClassScene'));
  assert.ok(/const size = figSize\(maxW, maxH, ratio\)/.test(fn));
  assert.strictEqual(/let figH = maxH;/.test(fn), false, '旧的尺寸公式必须删掉，否则两套公式会漂移');
});

test('drawClassStudent：非法 key 回落到小皮，不查原型链', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassStudent'), APP_SRC.indexOf('function drawClassScene'));
  assert.ok(/hasClassKey\(s && s\.key\) \? s\.key : 'naughty'/.test(fn));
});

test('drawClassStudent：注意力为 null 时不画分数条（缺失不伪装成 0）', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function drawClassStudent'), APP_SRC.indexOf('function drawClassScene'));
  assert.ok(/if \(attention !== null\)/.test(fn), 'null 分数必须跳过填充，否则会画出 0 长度的红条');
});

test('2D 场景：没有引入任何外部图片/字体依赖', () => {
  const fn = APP_SRC.slice(APP_SRC.indexOf('function setupClassScene'), APP_SRC.indexOf('function classBubble'));
  assert.strictEqual(/new Image\(/.test(fn), false, '不能 new Image，立绘必须走已烘焙的缓存');
  assert.strictEqual(/https?:\/\//.test(fn), false, '场景里不许出现外链资源');
});
