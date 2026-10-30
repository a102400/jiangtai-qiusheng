'use strict';

/**
 * rb-fx.js 契约测试（react-bits 三个效果的原生移植）
 * ----------------------------------------------------------------
 * 这份测试盯四件事，每条都对应一次真实故障或一个容易回退的接线：
 *
 *   1. 默认值不能被 Number(null) 吃成 0。
 *      data 属性没写时 getAttribute 返回 null，Number(null) === 0，
 *      于是「光斑 220px」变成「光斑 0px」、「磁吸上限 16px」变成「永不位移」。
 *      这是本轮实际踩到的 bug，必须锁死。
 *
 *   2. 聚光要真的把指针坐标写进 CSS 变量（而不是只绑了事件）。
 *
 *   3. 磁吸要真的算出位移并写进变量，且不能超过 maxOffset。
 *
 *   4. 接线与降级：gsap 先于 ScrollTrigger，ScrollTrigger 先于 scroll-gsap，
 *      vendor 缺失时 scroll-gsap 必须直接 return 而不是抛错。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SRC = fs.readFileSync(path.join(PUB, 'rb-fx.js'), 'utf8');

/**
 * 最小 sandbox。
 * rAF 用队列 + 手动 drain，**不能同步递归执行**：同步的话
 * `raf = requestAnimationFrame(frame)` 会在 frame 内部把 raf 清 0 之后
 * 又被赋值成返回的 id，第二帧就再也起不来（真实浏览器是异步的，没这问题）。
 * extraWindow 用来注入 gsap 之类的全局（enter 需要）。
 */
function loadFx(extraWindow) {
  const queue = [];
  let seq = 0;

  const sandbox = {
    window: {},
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    requestAnimationFrame(fn) {
      seq += 1;
      queue.push({ id: seq, fn });
      return seq;
    },
    cancelAnimationFrame(id) {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].id === id) { queue.splice(i, 1); break; }
      }
    },
    performance: { now: () => 0 },
    console
  };

  sandbox.globalThis = sandbox;

  // 极简 window 事件系统：只记录监听器，测试里手动触发
  sandbox.window._listeners = {};
  sandbox.window.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  sandbox.window.removeEventListener = function () {};

  Object.keys(extraWindow || {}).forEach((k) => {
    sandbox.window[k] = extraWindow[k];
  });

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'rb-fx.js' });

  /** 把排队的帧全部跑完（上限防死循环） */
  function drain(limit) {
    const max = limit || 2000;
    let n = 0;
    while (queue.length && n < max) {
      const item = queue.shift();
      n += 1;
      item.fn(n * 16);
    }
    return n;
  }

  return { fx: sandbox.window.jtqRbFx, win: sandbox.window, drain };
}

/**
 * 假卡片。默认 rect 与 offset 尺寸一致（未变换）。
 * 传 opts 可模拟「卡片已被 3D 旋转」：此时浏览器返回的 rect 是**变换后**
 * 的轴对齐包围盒，比 offsetWidth/offsetHeight 大 —— 这正是坐标会算错的根因。
 */
function makeCard(opts) {
  const o = opts || {};
  const rect = o.rect || { left: 100, top: 200, width: 200, height: 120 };
  const vars = {};
  const classes = new Set();
  const card = {
    _vars: vars,
    _classes: classes,
    style: {
      setProperty(k, v) { vars[k] = String(v); },
      getPropertyValue(k) { return vars[k] === undefined ? '' : vars[k]; }
    },
    classList: {
      contains(c) { return classes.has(c); },
      add(c) { classes.add(c); }
    },
    offsetWidth: o.offsetWidth === undefined ? Math.round(rect.width) : o.offsetWidth,
    offsetHeight: o.offsetHeight === undefined ? Math.round(rect.height) : o.offsetHeight,
    getBoundingClientRect: () => rect,
    contains: () => true
  };
  card.closest = (sel) => (sel === '.cs-card' ? card : null);
  return card;
}

function makeBox() {
  const handlers = {};
  return {
    _handlers: handlers,
    addEventListener(type, fn) { handlers[type] = fn; },
    removeEventListener() {},
    contains: () => true
  };
}

function makeButton(width, height) {
  const vars = {};
  const classes = new Set();
  return {
    _vars: vars,
    _classes: classes,
    style: {
      setProperty(k, v) { vars[k] = String(v); },
      getPropertyValue(k) { return vars[k] === undefined ? '' : vars[k]; }
    },
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height })
  };
}

test('num：null / 空串 / undefined 都必须落到默认值（不能是 0）', () => {
  const { fx } = loadFx();
  assert.ok(fx.__internals, '缺少 __internals，无法锁默认值行为');

  const { num } = fx.__internals;

  assert.equal(num(null, 220), 220, 'Number(null)===0，被吃成 0 了');
  assert.equal(num('', 220), 220, 'Number("")===0，被吃成 0 了');
  assert.equal(num(undefined, 90), 90);

  assert.equal(num('120', 220), 120);
  assert.equal(num(0, 220), 0, '显式写的 0 应该保留');
  assert.equal(num('abc', 220), 220);
  assert.equal(num(NaN, 16), 16);
});

test('clamp：夹取边界', () => {
  const { fx } = loadFx();
  const { clamp } = fx.__internals;
  assert.equal(clamp(5, -16, 16), 5);
  assert.equal(clamp(-99, -16, 16), -16);
  assert.equal(clamp(99, -16, 16), 16);
});

test('spotlight：指针移动后把坐标写进卡片 CSS 变量', () => {
  const { fx } = loadFx();
  const box = makeBox();
  const card = makeCard();

  const dispose = fx.spotlight(box, '.cs-card', { size: 220 });
  assert.equal(typeof dispose, 'function');

  box._handlers.pointermove({
    target: card,
    clientX: 118, // 相对卡片左边缘 +18
    clientY: 222  // 相对卡片上边缘 +22
  });

  assert.equal(card.style.getPropertyValue('--rb-spot-x'), '18px');
  assert.equal(card.style.getPropertyValue('--rb-spot-y'), '22px');
  assert.equal(card.style.getPropertyValue('--rb-spot-on'), '1');
  assert.equal(card.style.getPropertyValue('--rb-spot-size'), '220px');

  // 卡片是动态重建的，类名必须在这一刻补上，否则 ::after 规则不生效
  assert.ok(card._classes.has('rb-spotlight'), '没有懒加 .rb-spotlight 类');

  dispose();
  assert.equal(card.style.getPropertyValue('--rb-spot-on'), '0', 'dispose 后应熄灯');
});

test('spotlight：size 不传时用 220px，不是 0px', () => {
  const { fx } = loadFx();
  const box = makeBox();
  const card = makeCard();

  fx.spotlight(box, '.cs-card', {});
  box._handlers.pointermove({ target: card, clientX: 100, clientY: 200 });

  assert.equal(
    card.style.getPropertyValue('--rb-spot-size'),
    '220px',
    '默认光斑尺寸被吃成 0px（Number(null) 回归）'
  );
});

test('spotlight：指针不在卡片上时不写变量', () => {
  const { fx } = loadFx();
  const box = makeBox();
  const card = makeCard();

  fx.spotlight(box, '.cs-card', {});
  box._handlers.pointermove({ target: { closest: () => null }, clientX: 1, clientY: 1 });

  assert.equal(card._vars['--rb-spot-on'], undefined, '不在卡片上却点亮了');
});

test('magnet：指针进入 padding 范围后写出位移，且不超过 maxOffset', () => {
  const { fx, win, drain } = loadFx();

  // 按钮 200×50，中心 (100, 25)；指针在 (110, 25) → dx=10
  const btn = makeButton(200, 50);
  const dispose = fx.magnet(btn, { padding: 90, maxOffset: 16, strength: 0.34 });
  assert.equal(typeof dispose, 'function');
  assert.ok(win._listeners.pointermove && win._listeners.pointermove.length, '没有监听 pointermove');

  win._listeners.pointermove.forEach((fn) => fn({ clientX: 110, clientY: 25 }));
  drain();

  const mx = parseFloat(btn._vars['--rb-mx']);
  const my = parseFloat(btn._vars['--rb-my']);

  assert.ok(Number.isFinite(mx), '没有写出 --rb-mx');
  assert.ok(mx > 0, '指针在右侧，位移方向应该为正：' + mx);
  assert.ok(mx <= 16, '位移超过 maxOffset：' + mx);
  assert.ok(Math.abs(my) < 0.05, '指针与按钮垂直居中，纵向不应位移：' + my);
});

test('magnet：指针远超 padding 时回中', () => {
  const { fx, win, drain } = loadFx();

  const btn = makeButton(200, 50);
  fx.magnet(btn, { padding: 90, maxOffset: 16 });

  win._listeners.pointermove.forEach((fn) => fn({ clientX: 100, clientY: 25 }));
  drain();
  win._listeners.pointermove.forEach((fn) => fn({ clientX: 5000, clientY: 5000 }));
  drain();

  const mx = parseFloat(btn._vars['--rb-mx']);
  assert.ok(Math.abs(mx) < 0.05, '远离按钮后应回到 0，实际 ' + mx);
});

/* ---------------- 接线与降级 ---------------- */

test('index.html 接线：vendor 与脚本顺序', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

  const at = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i > -1, 'index.html 缺少 ' + needle);
    return i;
  };

  const gsap = at('vendor/gsap.min.js');
  const st = at('vendor/ScrollTrigger.min.js');
  const rbfx = at('rb-fx.js');
  const app = at('src="app.js');
  const scroll = at('scroll-gsap.js');

  assert.ok(gsap < st, 'gsap 必须在 ScrollTrigger 之前加载');
  assert.ok(st < scroll, 'ScrollTrigger 必须在 scroll-gsap.js 之前加载');
  assert.ok(rbfx < app, 'rb-fx.js 必须在 app.js 之前加载（app.js 会调用 refreshGlare）');
  assert.ok(app < scroll, 'scroll-gsap.js 应在 app.js 之后，确保标题已在 DOM 里');

  assert.ok(at('rb-fx.css') > -1, 'index.html 缺少 rb-fx.css');

  assert.ok(/data-rb-spotlight="\.cs-card"/.test(html), '学生卡容器缺少 data-rb-spotlight');
  assert.ok(/id="analyzeBtn"[^>]*data-rb-magnet/.test(html), '主按钮缺少 data-rb-magnet');
  assert.ok(/id="metricsGrid"[^>]*data-rb-glare/.test(html), '指标区缺少 data-rb-glare');
});

test('scroll-gsap.js：vendor 缺失时必须静默降级', () => {
  const src = fs.readFileSync(path.join(PUB, 'scroll-gsap.js'), 'utf8');
  assert.ok(
    /if\s*\(\s*!gsap\s*\|\|\s*!ScrollTrigger\s*\)\s*return/.test(src),
    '缺少 gsap / ScrollTrigger 缺失时的提前 return，旧缓存页面会抛错'
  );
  assert.ok(/prefers-reduced-motion/.test(src), '没有处理 prefers-reduced-motion');
});

test('rb-fx.css：三个效果的移动降级与进度条样式', () => {
  const css = fs.readFileSync(path.join(PUB, 'rb-fx.css'), 'utf8');
  const blocks = css.split('prefers-reduced-motion').length - 1;
  assert.ok(blocks >= 3, '聚光 / 磁吸 / 光带都要有 reduced-motion 降级，实际 ' + blocks);
  assert.ok(css.includes('.rb-scroll-progress'), '缺少阅读进度条样式');
});

test('vendor 文件真实存在、版本正确，且不引 CDN', () => {
  const gsap = path.join(PUB, 'vendor', 'gsap.min.js');
  const st = path.join(PUB, 'vendor', 'ScrollTrigger.min.js');
  assert.ok(fs.existsSync(gsap), 'vendor/gsap.min.js 不存在');
  assert.ok(fs.existsSync(st), 'vendor/ScrollTrigger.min.js 不存在');

  const head = fs.readFileSync(gsap, 'utf8').slice(0, 240);
  assert.ok(/GSAP 3\.13\.0/.test(head), 'vendor 里的 GSAP 版本不是 3.13.0');

  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.equal(
    /src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap/.test(html),
    false,
    'index.html 引了 CDN 版 GSAP，离线版会失效'
  );
});

test('构建脚本必须把 vendor 与 rb-fx 全部内联', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-standalone.js'), 'utf8');
  ['vendor/gsap.min.js', 'vendor/ScrollTrigger.min.js', 'rb-fx.js', 'scroll-gsap.js'].forEach((f) => {
    assert.ok(build.includes("'" + f + "'"), '构建脚本没有内联 ' + f);
  });
  assert.ok(build.includes("'rb-fx.css'"), '构建脚本没有内联 rb-fx.css');
});

/* ---------------- 坐标反推：倾斜与聚光叠加的唯一正确算法 ---------------- */

test('localPoint：卡片被 3D 旋转后，坐标仍按未变换尺寸反推', () => {
  const { fx } = loadFx();
  const { localPoint } = fx.__internals;

  // 未变换：200×120，left 100 / top 200 → 中心 (200, 260)
  const plain = localPoint(makeCard(), { clientX: 118, clientY: 222 });
  assert.equal(plain.x, 18);
  assert.equal(plain.y, 22);
  assert.ok(Math.abs(plain.nx - -0.82) < 1e-9, 'nx 应为 -0.82，实际 ' + plain.nx);

  // 已旋转：浏览器给的是变换后的包围盒 210×130，中心仍在 (200, 260)
  const tilted = localPoint(
    makeCard({ rect: { left: 95, top: 195, width: 210, height: 130 }, offsetWidth: 200, offsetHeight: 120 }),
    { clientX: 118, clientY: 222 }
  );

  assert.equal(tilted.x, 18, '用 rect 宽高算会让坐标偏 ' + (tilted.x - 18) + 'px');
  assert.equal(tilted.y, 22);
  assert.ok(
    Math.abs(tilted.nx - plain.nx) < 1e-9,
    '旋转前后归一化坐标必须一致，否则光斑会随倾斜自己漂'
  );
});

test('localPoint：尺寸为 0 时返回 null（元素在隐藏 tab 里）', () => {
  const { fx } = loadFx();
  const card = makeCard({ rect: { left: 0, top: 0, width: 0, height: 0 } });
  assert.equal(fx.__internals.localPoint(card, { clientX: 1, clientY: 1 }), null);
});

/* ---------------- TiltedCard ---------------- */

test('tilt：指针偏移写出双轴旋转，幅度不超过 amplitude', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();
  const card = makeCard();

  const dispose = fx.tilt(box, '.cs-card', { amplitude: 8 });
  assert.equal(typeof dispose, 'function');

  // 中心 (200,260)，指针右半 +50 / 上半 -30 → nx=0.5 ny=-0.5
  box._handlers.pointermove({ target: card, clientX: 250, clientY: 230 });
  drain();

  const rx = parseFloat(card._vars['--rb-rx']);
  const ry = parseFloat(card._vars['--rb-ry']);

  assert.ok(Math.abs(rx - -4) < 0.05, 'rotateX 应为 -4deg（指针偏上，顶边前倾），实际 ' + rx);
  assert.ok(Math.abs(ry - -4) < 0.05, 'rotateY 应为 -4deg（指针偏右，右边后退），实际 ' + ry);
  assert.ok(Math.abs(rx) <= 8 && Math.abs(ry) <= 8, '超出 amplitude');

  // 类名必须懒加：卡片是 innerHTML 重建的，HTML 里写不进这个类
  assert.ok(card._classes.has('rb-tilt'), '没有懒加 .rb-tilt 类，transform 规则不生效');

  dispose();
});

test('tilt：指针移到卡片最角上时被夹到 amplitude，不会越界', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();
  const card = makeCard();

  fx.tilt(box, '.cs-card', { amplitude: 8 });
  box._handlers.pointermove({ target: card, clientX: 9999, clientY: 9999 });
  drain();

  assert.equal(parseFloat(card._vars['--rb-rx']), 8);
  assert.equal(parseFloat(card._vars['--rb-ry']), -8);
});

test('tilt：指针离开后回正到 0deg', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();
  const card = makeCard();

  fx.tilt(box, '.cs-card', { amplitude: 8 });
  box._handlers.pointermove({ target: card, clientX: 280, clientY: 250 });
  drain();
  assert.ok(Math.abs(parseFloat(card._vars['--rb-rx'])) > 0.5, '先说应该已经倾斜');

  box._handlers.pointerleave();
  drain();
  assert.equal(parseFloat(card._vars['--rb-rx']), 0);
  assert.equal(parseFloat(card._vars['--rb-ry']), 0);
});

test('tilt：卡片重建后新节点能接管，旧节点的变量被清零', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();
  const oldCard = makeCard();
  const newCard = makeCard();

  fx.tilt(box, '.cs-card', { amplitude: 8 });

  box._handlers.pointermove({ target: oldCard, clientX: 280, clientY: 250 });
  drain();
  assert.ok(oldCard._classes.has('rb-tilt'));

  // renderClassStudents() 重建了 innerHTML
  box._handlers.pointermove({ target: newCard, clientX: 280, clientY: 250 });
  drain();

  assert.ok(newCard._classes.has('rb-tilt'), '新卡片没有拿到 .rb-tilt，倾斜会失效');
  assert.equal(oldCard._vars['--rb-rx'], '0deg', '旧节点没被摆平，会留在倾斜状态');
  assert.ok(Math.abs(parseFloat(newCard._vars['--rb-ry'])) > 0.5, '新卡片没有写旋转变量');
});

test('tilt：amplitude 为 0 时不接管指针', () => {
  const { fx } = loadFx();
  const box = makeBox();
  const card = makeCard();

  assert.equal(fx.tilt(box, '.cs-card', { amplitude: 0 }), null, 'amplitude 0 应直接返回 null');
  assert.equal(card._classes.has('rb-tilt'), false);
});

test('tilt：默认 12°，透视距离按卡片宽度自适应（3 倍）', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();
  const card = makeCard(); // 200×120

  fx.tilt(box, '.cs-card', {});
  // 卡片中心是 (200,260)，两个方向都给到角上才能同时拿到 ±1 的归一化坐标
  box._handlers.pointermove({ target: card, clientX: 9999, clientY: 9999 });
  drain();

  assert.equal(parseFloat(card._vars['--rb-rx']), 12, '默认角度应是 12°，6° 在 200px 宽的卡上几乎看不出立体');
  assert.equal(card._vars['--rb-persp'], '600px', '200px 宽 → 3 倍 = 600px');
});

test('tilt：窄卡片用更近的透视，并被夹在 260–900px', () => {
  const { fx, drain } = loadFx();
  const box = makeBox();

  const narrow = makeCard({
    rect: { left: 0, top: 0, width: 100, height: 90 },
    offsetWidth: 100,
    offsetHeight: 90
  });
  fx.tilt(box, '.cs-card', {});
  box._handlers.pointermove({ target: narrow, clientX: 100, clientY: 45 });
  drain();
  assert.equal(narrow._vars['--rb-persp'], '300px', '100px 宽应当收紧到 300px 透视');

  // 极窄（50px）→ 150px 会被夹到下限 260px：再近会明显畸变
  const tiny = makeCard({
    rect: { left: 0, top: 0, width: 50, height: 50 },
    offsetWidth: 50,
    offsetHeight: 50
  });
  box._handlers.pointermove({ target: tiny, clientX: 25, clientY: 25 });
  drain();
  assert.equal(tiny._vars['--rb-persp'], '260px', '透视下限没夹住');
});

/* ---------------- AnimatedContent ---------------- */

function makeFakeGsap() {
  const calls = { kill: [], set: [], to: [] };
  return {
    _calls: calls,
    killTweensOf(list) { calls.kill.push(list); },
    set(list, vars) { calls.set.push({ list, vars }); },
    to(list, vars) { calls.to.push({ list, vars }); return { kill() {} }; }
  };
}

function makeContainer(children) {
  const touches = [];
  return {
    _children: children,
    _touches: touches,
    querySelectorAll: () => children,
    style: {
      setProperty(k, v) { touches.push([k, v]); },
      getPropertyValue() { return ''; }
    }
  };
}

test('enter：gsap 没加载时直接返回，绝不能把内容藏起来', () => {
  // 这是最重要的一条。上游 AnimatedContent 把 visibility:hidden 写进 JSX 的
  // style 里，照抄的话 gsap 一挂整个报告区就是空白。
  const { fx } = loadFx(); // window 上故意不放 gsap
  const box = makeContainer([{ _name: 'm1' }, { _name: 'm2' }]);

  assert.equal(fx.enter(box, { selector: '.metric' }), null);

  assert.equal(box._touches.length, 0, '不该碰容器样式');
  assert.equal(box._children[0].style, undefined, '不该给子元素写任何内联样式');
});

test('enter：gsap 可用时先停旧 tween、再从不可见推到可见', () => {
  const gsap = makeFakeGsap();
  const { fx } = loadFx({ gsap });
  const kids = [{ _n: 1 }, { _n: 2 }, { _n: 3 }];
  const box = makeContainer(kids);

  const tw = fx.enter(box, { selector: '.metric', stagger: 0.05, distance: 18 });
  assert.ok(tw, '没有返回 tween');

  assert.equal(gsap._calls.kill.length, 1, '连点分析时旧 tween 没被停掉，会闪一下再重播');
  const hit = gsap._calls.set[0].list;
  assert.equal(hit.length, 3, 'selector 命中的元素数不对');
  kids.forEach((k, i) => assert.equal(hit[i], k, '第 ' + i + ' 个目标不是 selector 命中的元素'));
  assert.equal(gsap._calls.set[0].vars.opacity, 0, '起始必须是不可见');
  assert.equal(gsap._calls.set[0].vars.y, 18);

  const to = gsap._calls.to[0];
  assert.equal(to.vars.opacity, 1);
  assert.equal(to.vars.y, 0);
  assert.equal(to.vars.stagger, 0.05);
  assert.ok(
    String(to.vars.clearProps).includes('opacity'),
    '结束时必须清掉内联 opacity，否则压住 .metric 自己的过渡'
  );
});

test('enter：selector 没命中时退化为整体入场', () => {
  const gsap = makeFakeGsap();
  const { fx } = loadFx({ gsap });
  const box = makeContainer([]);

  fx.enter(box, { selector: '.nothing' });
  assert.equal(gsap._calls.to[0].list.length, 1);
  assert.equal(gsap._calls.to[0].list[0], box);
});

test('enterMetrics：报告卡专用入口存在且带 stagger', () => {
  const gsap = makeFakeGsap();
  const { fx } = loadFx({ gsap });
  const box = makeContainer([{ _n: 1 }, { _n: 2 }]);

  assert.equal(typeof fx.enterMetrics, 'function');
  fx.enterMetrics(box);

  assert.equal(gsap._calls.to[0].list.length, 2);
  assert.ok(gsap._calls.to[0].vars.stagger > 0, '分批入场没有 stagger 就成了一起闪');
});

/* ---------------- 接线 ---------------- */

test('index.html：学生卡容器同时挂了聚光与倾斜', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(
    /id="classStudents"[^>]*data-rb-spotlight="\.cs-card"[^>]*data-rb-tilt="\.cs-card"/.test(html),
    '学生卡容器缺少 data-rb-tilt'
  );
});

test('app.js：指标卡重建后要调 enterMetrics，否则报告卡不会有入场', () => {
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const at = src.indexOf('metricsGrid.innerHTML');
  assert.ok(at > -1, '找不到 metricsGrid 渲染处');
  const after = src.slice(at, at + 2000);
  assert.ok(/enterMetrics\s*\(/.test(after), 'metricsGrid 重建后没有调 enterMetrics');
  assert.ok(/refreshGlare\s*\(/.test(after), 'metricsGrid 重建后没有重新挂 GlareHover 类名');
});

test('index.html：rb-fx.css 与 rb-fx.js 版本号必须一致', () => {
  // 这是本项目连踩过五次的坑：内容改了但 ?v= 没提，浏览器/CDN 吃旧缓存。
  // 现有测试只比「两边相等」，所以两边一起不动照样绿；这里额外锁住
  // 「本轮改过的文件必须与本轮代号一致」，由下面的 tilt1 标记保证。
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const cssV = (html.match(/rb-fx\.css\?v=([^"]+)"/) || [])[1];
  const jsV = (html.match(/rb-fx\.js\?v=([^"]+)"/) || [])[1];

  assert.ok(cssV, 'index.html 的 rb-fx.css 缺版本号');
  assert.ok(jsV, 'index.html 的 rb-fx.js 缺版本号');
  assert.strictEqual(cssV, jsV, 'rb-fx.css / rb-fx.js 版本号不一致：' + cssV + ' vs ' + jsV);
});

test('rb-fx.js 不得出现上游那种把内容藏起来的写法', () => {
  const src = SRC;
  assert.equal(
    /visibility\s*:\s*['"]hidden['"]/.test(src),
    false,
    '出现了 visibility:hidden —— 上游是靠 gsap 再显示回来，gsap 一挂就是空白'
  );
});

test('rb-fx.css：倾斜样式存在，且去掉了 .cs-card 的 transition:all', () => {
  const css = fs.readFileSync(path.join(PUB, 'rb-fx.css'), 'utf8');
  assert.ok(/\.cs-card\.rb-tilt/.test(css), '缺少 .cs-card.rb-tilt 样式');

  const idx = css.indexOf('.cs-card.rb-tilt {');
  // 块内注释里就写着「原本是 transition: all .3s」，必须先剥注释再断言
  const block = css
    .slice(idx, css.indexOf('\n}', idx))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/transition\s*:\s*all/.test(block),
    '.cs-card 原本是 transition:all .3s，留着会和每帧写变量叠加成拖尾'
  );
  assert.ok(/(^|\n)\s*transition\s*:/.test(block), '应显式列出只保留的过渡属性');
});
