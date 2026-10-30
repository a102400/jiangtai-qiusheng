/* msg.js 对话消息入场 契约测试
 *
 * 这组断言钉住的是「消息到底有没有真的弹起来」，以及三件容易翻车的事：
 *   1. 历史恢复时不能整屏乱弹（只对观察开始后新增的节点生效）
 *   2. 入场期间要和 fx.js 的拆台抖动错开，否则两个 transform 互相覆盖
 *   3. 脚本没跑 / reduced-motion 时消息必须照常可见，不能变成一片空白
 * 用最小 DOM 桩跑真脚本，不是读代码猜。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'msg.js'), 'utf8');

/* ---------------- 最小 DOM 桩 ---------------- */

let uid = 0;

function matchAny(el, sel) {
  return String(sel).split(',').some((one) => {
    const s = one.trim();
    if (!s) return false;
    if (s.charAt(0) === '.') return el._cls.has(s.slice(1));
    if (s.charAt(0) === '#') return el._attrs.id === s.slice(1);
    return el.tagName === s.toUpperCase();
  });
}

function makeEl(tag) {
  const el = {
    _id: ++uid,
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    _cls: new Set(),
    _attrs: {},
    _text: null,
    children: [],
    parentNode: null,
    style: {}
  };
  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    contains(c) { return el._cls.has(c); }
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.hasAttribute = (k) => k in el._attrs;
  el.removeAttribute = (k) => { delete el._attrs[k]; };
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = (c) => {
    const i = el.children.indexOf(c);
    if (i !== -1) el.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.contains = (c) => {
    if (el === c) return true;
    return el.children.some((ch) => ch.contains && ch.contains(c));
  };
  el.querySelectorAll = (sel) => {
    const out = [];
    (function walk(node) {
      for (const c of node.children) {
        if (matchAny(c, sel)) out.push(c);
        walk(c);
      }
    })(el);
    return out;
  };
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  el.matches = (sel) => matchAny(el, sel);
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._cls).join(' '); },
    set(v) {
      el._cls.clear();
      String(v).split(/\s+/).forEach((c) => { if (c) el._cls.add(c); });
    }
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text !== null ? el._text : el.children.map((c) => c.textContent).join(''); },
    set(v) { el._text = String(v); el.children.length = 0; }
  });
  return el;
}

function makeEnv(opts = {}) {
  const body = makeEl('body');
  const htmlEl = makeEl('html');
  htmlEl._cls.add('js');

  const doc = {
    body,
    documentElement: htmlEl,
    createElement: makeEl,
    _containers: new Map(),
    querySelector(sel) {
      if (sel.charAt(0) === '#') return doc._containers.get(sel.slice(1)) || null;
      return body.querySelector(sel);
    },
    addEventListener() {}
  };

  const observers = [];
  class FakeMO {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.targets = []; }
    // 测试里手动投递变更记录
    fire(records) { this.cb(records, this); }
  }

  const rafQ = [];
  const timers = [];
  const win = {
    matchMedia: (q) => (q.includes('prefers-reduced-motion') ? { matches: !!opts.reduce } : { matches: true }),
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame(fn) { rafQ.push(fn); return rafQ.length; }
  };

  const sandbox = {
    window: win,
    document: doc,
    MutationObserver: FakeMO,
    requestAnimationFrame: win.requestAnimationFrame,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    console
  };
  sandbox.globalThis = sandbox;
  return { sandbox, win, doc, body, htmlEl, rafQ, timers, observers };
}

function run(env) {
  vm.runInNewContext(SRC, env.sandbox, { filename: 'msg.js' });
}

/* 建一个容器并按 msg.js 的观察方式挂好 */
function withContainer(env, id) {
  const box = makeEl('div');
  box.setAttribute('id', id);
  env.body.appendChild(box);
  env.doc._containers.set(id, box);
  return box;
}

/* 冲掉 rAF（msg.js 是「两帧后才加 is-in」） */
function flushRaf(env) {
  for (let i = 0; i < 6 && env.rafQ.length; i++) {
    const fns = env.rafQ.splice(0, env.rafQ.length);
    fns.forEach((fn) => fn(16 * (i + 1)));
  }
}
function flushTimers(env) {
  const list = env.timers.splice(0, env.timers.length);
  list.forEach((t) => t.fn());
}

/* 模拟一次 DOM 追加，并把变更投给容器上的观察器 */
function push(env, box, ...nodes) {
  nodes.forEach((n) => box.appendChild(n));
  const recs = [{ type: 'childList', addedNodes: nodes, target: box }];
  env.observers
    .filter((o) => o.targets.indexOf(box) !== -1)
    .forEach((o) => o.fire(recs));
  flushTimers(env);   // msg.js 用 setTimeout(flush, 0) 合并同批
}

function msg(cls) {
  const el = makeEl('div');
  el.className = cls;
  return el;
}

/* ---------------- 用例 ---------------- */

test('msg.js：模拟学生消息从下方弹入，并加上入场类', () => {
  const env = makeEnv();
  const box = withContainer(env, 'questionDrillConversation');
  run(env);

  const el = msg('question-drill-message student');
  el.appendChild(makeEl('p'));
  push(env, box, el);

  assert.strictEqual(el.getAttribute('data-side'), 'up', '学生消息应向上浮入');
  assert.ok(el.classList.contains('msg-enter'), '必须挂 .msg-enter（起始态）');
  assert.ok(!el.classList.contains('is-in'), '同帧不能直接 is-in，否则过渡不播');

  flushRaf(env);
  assert.ok(el.classList.contains('is-in'), '隔帧后才进入结束态');
});

test('msg.js：教师消息从右侧进入，系统提示只淡入', () => {
  const env = makeEnv();
  const box = withContainer(env, 'questionDrillConversation');
  run(env);

  const t = msg('question-drill-message teacher');
  const s = msg('question-drill-message system');
  push(env, box, t);
  push(env, box, s);

  assert.strictEqual(t.getAttribute('data-side'), 'right', '教师气泡右对齐，方向应一致');
  assert.strictEqual(s.getAttribute('data-side'), 'fade', '系统提示不该位移入场');
});

test('msg.js：主对话的 .msg.out 也认成教师侧', () => {
  const env = makeEnv();
  const box = withContainer(env, 'chatLog');
  run(env);

  const out = msg('msg out');
  const stu = msg('msg');
  push(env, box, out, stu);

  assert.strictEqual(out.getAttribute('data-side'), 'right');
  assert.strictEqual(stu.getAttribute('data-side'), 'up');
});

test('msg.js：同批新增多条按 50ms 递增错峰', () => {
  const env = makeEnv();
  const box = withContainer(env, 'questionDrillConversation');
  run(env);

  const a = msg('question-drill-message student');
  const b = msg('question-drill-message student');
  const c = msg('question-drill-message student');
  push(env, box, a, b, c);

  assert.ok(!a.style.transitionDelay, '第一条不延迟，实际 ' + JSON.stringify(a.style.transitionDelay));
  assert.strictEqual(b.style.transitionDelay, '50ms', '第二条 50ms（AnimatedList stagger 默认值）');
  assert.strictEqual(c.style.transitionDelay, '100ms');
});

test('msg.js：三点占位行不播入场（它自己会跳）', () => {
  const env = makeEnv();
  const box = withContainer(env, 'questionDrillConversation');
  run(env);

  const typing = msg('question-drill-message student question-drill-typing');
  const dots = makeEl('span');
  dots.className = 'msg-typing';
  typing.appendChild(dots);
  push(env, box, typing);

  assert.ok(!typing.classList.contains('msg-enter'), '等待指示器不该再弹一次');
});

test('msg.js：入场期间打 data-entering，收尾后释放并补光标', () => {
  const env = makeEnv();
  const box = withContainer(env, 'questionDrillConversation');
  run(env);

  const el = msg('question-drill-message student');
  const p = makeEl('p');
  el.appendChild(p);
  push(env, box, el);
  flushRaf(env);

  assert.strictEqual(
    el.getAttribute('data-entering'), '1',
    '入场期间必须打标记，否则 fx.js 的抖动会和入场 transition 抢 transform'
  );

  flushTimers(env);   // 620ms 后的收尾
  assert.strictEqual(el.getAttribute('data-entering'), null, '入场结束必须释放标记');
  assert.strictEqual(el.style.transitionDelay, '', '错峰延迟也要清掉，否则后续动画全被拖慢');
  assert.ok(p.querySelector('.msg-caret'), '学生消息末尾应出现打字光标');
});

test('msg.js：光标会自己消失，不留残留节点', () => {
  const env = makeEnv();
  const box = withContainer(env, 'chatLog');
  run(env);

  const el = msg('msg');
  el.className = 'msg';
  const bub = makeEl('div');
  bub.className = 'bub';
  el.appendChild(bub);
  push(env, box, el);
  flushRaf(env);
  flushTimers(env);

  const caret = bub.querySelector('.msg-caret');
  assert.ok(caret, '应先插入光标');
  flushTimers(env);   // 2100ms 后的清除
  assert.strictEqual(bub.querySelector('.msg-caret'), null, '光标必须自清，长对话不能一直堆 span');
});

test('msg.js：晚创建的容器（专项练习面板）也能被挂上观察', () => {
  const env = makeEnv();
  withContainer(env, 'chatLog');        // 只有主对话容器静态存在
  run(env);

  // 此时 #questionDrillConversation 还不存在，观察器只挂在 chatLog 上
  const drill = withContainer(env, 'questionDrillConversation');

  // 触发 body 上的补救观察（模拟面板插入 DOM）
  const late = env.observers.filter((o) => o.targets.indexOf(env.body) !== -1);
  assert.ok(late.length > 0, '容器缺失时必须临时观察 body，否则永远等不到它');
  late.forEach((o) => o.fire([{ type: 'childList', addedNodes: [drill], target: env.body }]));

  const el = msg('question-drill-message student');
  push(env, drill, el);
  assert.ok(el.classList.contains('msg-enter'), '面板出现后新增的消息必须能入场');
});

test('msg.js：全部容器找齐后撤掉 body 上的临时观察（不留常驻开销）', () => {
  const env = makeEnv();
  withContainer(env, 'chatLog');
  run(env);

  const drill = withContainer(env, 'questionDrillConversation');
  const late = env.observers.filter((o) => o.targets.indexOf(env.body) !== -1);
  late.forEach((o) => o.fire([{ type: 'childList', addedNodes: [drill], target: env.body }]));

  const stillWatchingBody = env.observers.filter((o) => o.targets.indexOf(env.body) !== -1);
  assert.strictEqual(stillWatchingBody.length, 0, '容器齐了就该 disconnect，subtree 观察不能常驻');
});

test('msg.js：reduced-motion 时完全不注册观察器（消息直接可见）', () => {
  const env = makeEnv({ reduce: true });
  withContainer(env, 'chatLog');
  run(env);

  assert.strictEqual(env.observers.length, 0, '无障碍偏好下不该有任何观察开销');

  const box = env.doc._containers.get('chatLog');
  const el = msg('msg');
  push(env, box, el);
  assert.ok(!el.classList.contains('msg-enter'), '不能给隐藏态，否则内容永远不出现');
});

test('msg.css：隐藏态全部门控在 html.js 下，脚本没跑不会白屏', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'msg.css'), 'utf8');
  const lines = css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/opacity:\s*0[;\s}]/.test(lines[i])) continue;
    let j = i;
    while (j > 0 && !lines[j].includes('{')) j--;
    const sel = lines[j].trim();
    // @keyframes 里的帧（0%, 70%, 100%）不是选择器，跳过
    if (/^[\d\s%,]+{/.test(sel)) continue;
    // 结尾态的 opacity 由 .is-in 覆盖，起始态必须带 html.js
    assert.ok(
      /html\.js/.test(sel) || /^\.msg-caret/.test(sel),
      'msg.css 第 ' + (j + 1) + ' 行的 opacity:0 没有 html.js 门控：' + sel
    );
  }
});

test('msg.css：弹簧曲线与 react-bits AnimatedList 的采样点一致', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'msg.css'), 'utf8');
  const m = css.match(/--rb-spring:\s*linear\(([^;]+)\)/);
  assert.ok(m, '必须保留 linear() 弹簧曲线，否则只剩普通缓动');
  const pts = m[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  assert.ok(pts.length >= 25, 'AnimatedList 是 29 点曲线，实际 ' + pts.length);
  const peak = Math.max(...pts);
  assert.ok(peak > 1 && peak < 1.15, '峰值应在 1~1.15 之间（约 8% 过冲），实际 ' + peak);
  assert.strictEqual(pts[0], 0, '起点必须是 0');
  assert.strictEqual(pts[pts.length - 1], 1, '终点必须是 1');
});

test('msg.js：容器始终不出现时，临时观察 8 秒后自动撤掉', () => {
  const env = makeEnv();
  withContainer(env, 'chatLog');
  run(env);

  // 此时仍有面板没找到，body 上挂着临时观察
  const before = env.observers.filter((o) => o.targets.indexOf(env.body) !== -1);
  assert.strictEqual(before.length, 1, '缺容器时应临时观察 body');

  // 冲掉 8 秒兜底定时器
  const timers = env.timers.splice(0, env.timers.length);
  timers.forEach((t) => t.fn());

  const after = env.observers.filter((o) => o.targets.indexOf(env.body) !== -1);
  assert.strictEqual(after.length, 0, '超时后必须断开，落地页不该永远扫全站 DOM');
});

test('接线：只有真带对话区的页面才引 msg，且 msg.css 排在 ui.css 之后', () => {
  const dir = path.join(__dirname, '..', 'public');
  for (const page of ['index.html', 'landing.html', 'workbench.html']) {
    const html = fs.readFileSync(path.join(dir, page), 'utf8');
    const hasChat = html.indexOf('id="chatLog"') !== -1
      || html.indexOf('questionDrillConversation') !== -1;
    const wired = html.indexOf('msg.css') !== -1 && html.indexOf('msg.js') !== -1;
    assert.strictEqual(
      wired, hasChat,
      page + ' 的接线与「有没有对话区」不一致（无对话区还引 msg 会白挂一个观察器）'
    );
    if (wired) {
      const atMsg = html.indexOf('href="msg.css');
      const atUi = html.indexOf('href="ui.css');
      assert.ok(atUi > 0 && atMsg > atUi, page + '：msg.css 必须排在 ui.css 之后');
    }
  }
});

test('接线：msg.css 与 msg.js 版本号必须成对', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = (html.match(/msg\.css\?v=([^"]+)/) || [])[1];
  const js = (html.match(/msg\.js\?v=([^"]+)/) || [])[1];
  assert.ok(css && js, '必须同时引用 msg.css 与 msg.js');
  assert.strictEqual(css, js, '两者版本号必须一致，否则一个换了缓存另一个没换');
});
