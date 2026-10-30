/* fx.js 特效层运行时契约测试
 *
 * 没有浏览器环境，就用最小 DOM 桩把 fx.js 真跑一遍 —— 验证的是
 * 「脚本在真实调用序列下不抛错、图层确实挂上、粒子确实在动、
 *   prefers-reduced-motion 与掉帧降级确实生效」。
 * 这些是纯前端脚本，用桩跑比"看代码觉得没问题"可靠。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'fx.js'), 'utf8');

/* ---------- 最小 DOM 桩 ---------- */
function makeCtx() {
  const calls = { arc: 0, fill: 0, clear: 0, translate: 0, save: 0, restore: 0 };
  const arcs = [];                      // 记录每次 arc 的坐标与半径，用于验证深度视差
  return {
    calls,
    arcs,
    fillStyle: '',
    setTransform() {},
    clearRect() { calls.clear++; },
    save() { calls.save++; },
    restore() { calls.restore++; },
    translate() { calls.translate++; },
    beginPath() {},
    arc(x, y, r) { calls.arc++; arcs.push({ x, y, r }); },
    fill() { calls.fill++; }
  };
}

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    id: '',
    width: 0,
    height: 0,
    offsetWidth: 0,
    parentNode: null,
    _cls: new Set(),
    classList: {
      add(c) { el._cls.add(c); },
      remove(c) { el._cls.delete(c); },
      contains(c) { return el._cls.has(c); }
    },
    setAttribute() {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(c) { c.parentNode = el; el.children.unshift(c); return c; },
    contains(c) { return el === c; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 200 }; },
    getContext() { return el._ctx || (el._ctx = makeCtx()); }
  };
  return el;
}

function makeEnv(opts = {}) {
  const body = makeEl('body');
  const doc = {
    hidden: false,
    body,
    documentElement: makeEl('html'),
    listeners: {},
    createElement: makeEl,
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    dispatchEvent(ev) {
      (doc.listeners[ev.type] || []).forEach(fn => fn(ev));
      return true;
    }
  };
  body.firstChild = null;

  const rafQueue = [];
  const win = {
    innerWidth: opts.w || 1280,
    innerHeight: opts.h || 800,
    devicePixelRatio: opts.dpr || 2,
    scrollY: 0,
    listeners: {},
    matchMedia(q) {
      if (q.includes('prefers-reduced-motion')) return { matches: !!opts.reduceMotion };
      if (q.includes('pointer: fine')) return { matches: true };
      return { matches: false };
    },
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    addEventListener(type, fn) { (win.listeners[type] = win.listeners[type] || []).push(fn); },
    setTimeout,
    clearTimeout
  };

  const sandbox = { window: win, document: doc, requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame, setTimeout, clearTimeout, Math, console };
  sandbox.globalThis = sandbox;
  return { sandbox, win, doc, body, rafQueue };
}

function run(env) {
  vm.runInNewContext(SRC, env.sandbox, { filename: 'fx.js' });
}

function step(env, t) {
  const fn = env.rafQueue.shift();
  if (fn) fn(t);
}

/* ---------- 用例 ---------- */
test('fx.js：正常环境下挂载 #fxAurora 与 #fxCanvas，且不抛错', () => {
  const env = makeEnv();
  assert.doesNotThrow(() => run(env));
  const ids = env.body.children.map(c => c.id);
  assert.ok(ids.includes('fxAurora'), '应创建背景极光层');
  assert.ok(ids.includes('fxCanvas'), '应创建粒子画布');
});

test('fx.js：prefers-reduced-motion 时不创建任何图层', () => {
  const env = makeEnv({ reduceMotion: true });
  run(env);
  assert.strictEqual(env.body.children.length, 0, '减少动效偏好下不应注入特效层');
});

test('fx.js：帧循环确实在画粒子并位移极光', () => {
  const env = makeEnv();
  run(env);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  assert.ok(canvas, '画布应存在');
  const ctx = canvas._ctx;
  step(env, 0);
  step(env, 16);
  step(env, 32);
  assert.ok(ctx.calls.arc > 0, '应绘制粒子圆点');
  assert.ok(ctx.calls.clear > 0, '每帧应先清屏');
  const aurora = env.body.children.find(c => c.id === 'fxAurora');
  assert.match(aurora.style.transform || '', /translate3d/, '极光层应随滚动做位移');
});

test('fx.js：高分屏封顶 2 倍，画布不按 3 倍采样', () => {
  const env = makeEnv({ dpr: 3, w: 1000, h: 700 });
  run(env);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  assert.strictEqual(canvas.width, 2000, 'devicePixelRatio=3 时应封顶为 2 倍');
});

test('fx.js：持续掉帧时粒子数降级到 12', () => {
  const env = makeEnv();
  run(env);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  const ctx = canvas._ctx;
  // 每帧 40ms（25fps），连续 100 帧触发降级
  let t = 0;
  for (let i = 0; i < 100; i++) { t += 40; step(env, t); }
  const before = ctx.calls.arc;
  step(env, t + 40);
  const perFrame = ctx.calls.arc - before;
  assert.strictEqual(perFrame, 12, '掉帧后应只剩 12 个粒子，实际 ' + perFrame);
});

/* ---------- 拆台高光 ---------- */
function strike(env) {
  const row = makeEl('div');
  row.getBoundingClientRect = () => ({ left: 100, top: 200, width: 300, height: 120 });
  env.doc.dispatchEvent({ type: 'jtq:student-strike', detail: { el: row } });
  return row;
}

test('fx.js：收到 jtq:student-strike 后建红闪层并抖动该条消息', () => {
  const env = makeEnv();
  run(env);
  step(env, 0);
  const row = strike(env);
  const flash = env.body.children.find(c => c.id === 'fxFlash');
  assert.ok(flash, '应懒创建全屏红闪层');
  assert.ok(Number(flash.style.opacity) > 0, '红闪应立刻可见，实际 ' + flash.style.opacity);
  assert.ok(row.classList.contains('fx-strike-shake'), '被点名的那条消息应抖动');
});

test('fx.js：爆散只在触发后短暂存在，衰减完自动清空', () => {
  const env = makeEnv();
  run(env);
  step(env, 0);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  const ctx = canvas._ctx;

  const quietBefore = ctx.calls.arc;
  step(env, 16);
  const dust = ctx.calls.arc - quietBefore;       // 平静时每帧只画粉笔灰

  strike(env);
  const burstStart = ctx.calls.arc;
  step(env, 32);
  const withSparks = ctx.calls.arc - burstStart;  // 爆散帧应明显多于粉笔灰
  assert.ok(withSparks > dust, '爆散帧的圆点应多于平静帧：' + withSparks + ' vs ' + dust);

  // 跑够 120 帧（≈2s），爆散早该衰减完，回到平静帧水平
  let t = 32;
  for (let i = 0; i < 120; i++) { t += 16; step(env, t); }
  const settled = ctx.calls.arc;
  step(env, t + 16);
  assert.strictEqual(ctx.calls.arc - settled, dust, '爆散结束后应回到平静帧水平');
});

test('fx.js：减少动效偏好下不监听拆台事件、不建红闪层', () => {
  const env = makeEnv({ reduceMotion: true });
  run(env);
  strike(env);
  assert.strictEqual(env.body.children.length, 0, '不应注入任何特效层');
  assert.strictEqual((env.doc.listeners['jtq:student-strike'] || []).length, 0, '不应注册拆台监听');
});

/* ---------------- D：粒子深度视差（不引 Three.js） ---------------- */

test('fx.js：视差改成逐粒深度位移，不再整体平移画布', () => {
  const env = makeEnv();
  run(env);
  step(env, 16);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  assert.strictEqual(
    canvas._ctx.calls.translate, 0,
    '整体 translate 会让所有粒子同幅位移，读不出纵深；应改为逐粒按 z 位移'
  );
});

test('fx.js：半径按深度缩放，同一帧里有明显的远近层次', () => {
  const env = makeEnv();
  run(env);
  step(env, 16);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  const rs = canvas._ctx.arcs.map(a => a.r);
  assert.ok(rs.length > 0, '应绘制粒子');
  const min = Math.min(...rs), max = Math.max(...rs);
  assert.ok(max / min > 2.5, '最大/最小半径应拉开距离（有 z 才有层次），实际 ' + (max / min).toFixed(2) + ' 倍');
});

test('fx.js：鼠标移动后各粒子位移幅度不同（近处大、远处小）', () => {
  const env = makeEnv();
  run(env);
  step(env, 16);
  const canvas = env.body.children.find(c => c.id === 'fxCanvas');
  const n = canvas._ctx.arcs.length;
  const before = canvas._ctx.arcs.slice(-n);

  // 把指针挪到屏幕最右侧
  (env.win.listeners['pointermove'] || []).forEach(fn =>
    fn({ clientX: env.win.innerWidth - 10, clientY: env.win.innerHeight / 2, target: { closest: () => null } })
  );
  let t = 16;
  for (let i = 0; i < 12; i++) { t += 16; step(env, t); }
  const after = canvas._ctx.arcs.slice(-n);

  const dx = after.map((a, i) => a.x - before[i].x);
  assert.ok(Math.max(...dx) > 4, '整体应向右位移，实际最大 ' + Math.max(...dx).toFixed(1) + 'px');
  assert.ok(
    Math.max(...dx) - Math.min(...dx) > 2,
    '各粒子位移应有差别（按 z 缩放），实际跨度 ' + (Math.max(...dx) - Math.min(...dx)).toFixed(1) + 'px'
  );
});
