/* motion.js 报告卡片渐入 + 标题行升起 契约测试
 *
 * 用户反馈的两个具体问题，都被这两组断言钉住：
 *   1. 报告区初始是 hidden，卡片在隐藏状态下被扫到 → 立刻标 is-in → 永远不渐入
 *   2. 面板里有多张卡片时，整块面板淡入一次，卡片各自不动
 * 用最小 DOM 桩跑真脚本，不是读代码猜。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'motion.js'), 'utf8');

/* ---------------- 最小 DOM 桩 ---------------- */

let uid = 0;

function makeEl(tag) {
  const el = {
    _id: ++uid,
    tagName: String(tag).toUpperCase(),
    _cls: new Set(),
    _attrs: {},
    _vars: {},
    _text: null,
    children: [],
    parentElement: null,
    hidden: false,
    offsetHeight: 120,
    _visible: true,
    _top: 0,
    _perLine: 6,        // 桩里每多少个字符换一行（模拟浏览器断行）
    style: {
      setProperty(k, v) { el._vars[k] = v; },
      getPropertyValue(k) { return el._vars[k] || ''; }
    }
  };
  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    contains(c) { return el._cls.has(c); }
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.hasAttribute = (k) => k in el._attrs;
  el.appendChild = (c) => {
    c.parentElement = el;
    c._index = el.children.length;
    c._visible = el._visible && !el.hidden;
    el.children.push(c);
    return c;
  };
  el.getClientRects = () => (el._visible && !el.hidden ? [{}] : []);
  el.getBoundingClientRect = () => ({
    left: 0,
    // 探针里的字符按 _perLine 换行（字符 span 的父级就是探针 span），
    // 这样 splitLines 的「按 top 分组」逻辑才能被真实触发
    top: (el.parentElement && el.parentElement.tagName === 'SPAN')
      ? Math.floor((el._index || 0) / (el.parentElement._perLine || 6)) * 20
      : el._top,
    width: 300,
    height: 40
  });
  el.matches = (sel) => matchAny(el, sel);
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._cls).join(' '); },
    set(v) {
      el._cls.clear();
      String(v).split(/\s+/).forEach((c) => { if (c) el._cls.add(c); });
    }
  });
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
  Object.defineProperty(el, 'textContent', {
    get() {
      if (el._text !== null) return el._text;
      return el.children.map((c) => c.textContent).join('');
    },
    set(v) {
      el._text = String(v);
      el.children.length = 0;
    }
  });
  return el;
}

/* 只支持测试里用到的两类选择器：tag 与 .class，逗号分隔 */
function walkAll(root) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) { out.push(c); walk(c); }
  })(root);
  return out;
}

function matchAny(el, sel) {
  return String(sel).split(',').some((one) => {
    const s = one.trim();
    if (!s) return false;
    if (s.charAt(0) === '.') {
      const cls = s.slice(1);
      // 支持 :not([attr]) 形式的排除
      const not = cls.match(/^([\w-]+):not\(\[([\w-]+)\]\)$/);
      if (not) return el._cls.has(not[1]) && !el.hasAttribute(not[2]);
      return el._cls.has(cls);
    }
    return el.tagName === s.toUpperCase();
  });
}

function makeEnv(opts = {}) {
  const body = makeEl('body');
  const htmlEl = makeEl('html');

  const ioList = [];
  class FakeIO {
    constructor(cb, o) { this.cb = cb; this.opts = o; this.targets = []; ioList.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve(t) { this.targets = this.targets.filter((x) => x !== t); }
    disconnect() {}
  }

  const timers = [];
  const doc = {
    hidden: false,
    body,
    documentElement: htmlEl,
    createElement: makeEl,
    querySelectorAll: (sel) => {
      if (sel.indexOf('[data-lines]') !== -1) {
        return walkAll(body).filter((c) => c.hasAttribute('data-lines') && !c.hasAttribute('data-lines-split'));
      }
      if (sel.indexOf('[data-roll]') !== -1) {
        return walkAll(body).filter((c) => c.hasAttribute('data-roll') && !c.classList.contains('roll'));
      }
      return body.querySelectorAll(sel);
    },
    addEventListener() {},
    _mo: null
  };

  const rafQ = [];
  const FakeMO = class { constructor(cb) { doc._mo = cb; } observe() {} disconnect() {} };
  const win = {
    innerWidth: 1280,
    innerHeight: opts.h || 800,
    scrollY: 0,
    // motion.js 用 `'IntersectionObserver' in window` 做能力检测，必须挂在 window 上
    IntersectionObserver: FakeIO,
    MutationObserver: FakeMO,
    matchMedia: (q) => (q.includes('prefers-reduced-motion') ? { matches: !!opts.reduce } : { matches: true }),
    requestAnimationFrame(fn) { rafQ.push(fn); return rafQ.length; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    addEventListener() {}
  };

  const sandbox = {
    window: win,
    document: doc,
    IntersectionObserver: FakeIO,
    MutationObserver: FakeMO,
    requestAnimationFrame: win.requestAnimationFrame,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    Math,
    console
  };
  sandbox.globalThis = sandbox;
  return { sandbox, win, doc, body, htmlEl, rafQ, timers, ioList };
}

function run(env) {
  vm.runInNewContext(SRC, env.sandbox, { filename: 'motion.js' });
}

/* 冲掉 rAF 队列（两帧就位逻辑） */
function flushRaf(env) {
  for (let i = 0; i < 8 && env.rafQ.length; i++) {
    const fns = env.rafQ.splice(0, env.rafQ.length);
    fns.forEach((fn) => fn(16 * (i + 1)));
  }
}
/* 冲掉节流定时器 */
function flushTimers(env) {
  const list = env.timers.splice(0, env.timers.length);
  list.forEach((t) => t.fn());
}

function addCards(parent, n, top = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = makeEl('div');
    c._cls.add('card');
    c._top = top + i * 200;
    parent.appendChild(c);
    out.push(c);
  }
  return out;
}

/* ---------------- 用例 ---------------- */

test('motion.js：面板里有多张卡片时下沉到卡片，面板自身不淡入', () => {
  const env = makeEnv();
  const panel = makeEl('section');
  panel._cls.add('panel');
  env.body.appendChild(panel);
  const cards = addCards(panel, 3, 120);

  run(env);

  assert.ok(!panel.hasAttribute('data-reveal'), '面板本身不该被挂（否则整块只淡一次）');
  for (const c of cards) {
    assert.ok(c.hasAttribute('data-reveal'), '每张卡片都该单独入场');
  }
});

test('motion.js：重复扫描不会让已下沉的面板回头再淡一次', () => {
  const env = makeEnv();
  const panel = makeEl('section');
  panel._cls.add('panel');
  env.body.appendChild(panel);
  const cards = addCards(panel, 3, 120);

  run(env);
  assert.ok(!panel.hasAttribute('data-reveal'), '前置条件：首次扫描已下沉');

  // 模拟业务侧插入内容触发的二次扫描
  const extra = makeEl('div');
  extra._cls.add('card');
  extra._top = 900;
  panel.appendChild(extra);
  env.doc._mo([{ type: 'childList', addedNodes: [extra] }]);
  flushTimers(env);
  flushRaf(env);

  assert.ok(!panel.hasAttribute('data-reveal'), '二次扫描后面板仍不能挂隐藏态（会二次闪动）');
  assert.ok(extra.hasAttribute('data-reveal'), '新插入的卡片要被补挂');
});

test('motion.js：hidden 容器里的卡片不会被提前挂隐藏态', () => {
  const env = makeEnv();
  const panel = makeEl('section');
  panel._cls.add('panel');
  env.body.appendChild(panel);

  const box = makeEl('div');
  box.hidden = true;
  box._visible = false;
  panel.appendChild(box);
  const cards = addCards(box, 3, 120);
  cards.forEach((c) => { c._visible = false; });

  run(env);
  for (const c of cards) {
    assert.ok(!c.hasAttribute('data-reveal'), '隐藏时不能挂 data-reveal（否则立刻 is-in，永远等不到过渡）');
  }
});

test('motion.js：容器从 hidden 变可见后会补挂（报告区就是这条）', () => {
  const env = makeEnv();
  const panel = makeEl('section');
  panel._cls.add('panel');
  env.body.appendChild(panel);

  const box = makeEl('div');
  box.hidden = true;
  box._visible = false;
  panel.appendChild(box);
  const cards = addCards(box, 3, 120);
  cards.forEach((c) => { c._visible = false; });

  run(env);
  assert.ok(!cards[0].hasAttribute('data-reveal'), '前置条件：初始不可见');

  // 模拟 resultBody.hidden = false，并通知 MutationObserver
  box.hidden = false;
  box._visible = true;
  cards.forEach((c) => { c._visible = true; });
  env.doc._mo([{ type: 'attributes', attributeName: 'hidden', target: box }]);
  flushTimers(env);
  flushRaf(env);

  for (const c of cards) {
    assert.ok(c.hasAttribute('data-reveal'), '变可见后必须补挂');
    assert.ok(c.classList.contains('is-in'), '在视口内应当立即播放，而不是等滚动');
  }
});

test('motion.js：错峰变量 --rv 最多累计 8 档（不会越排越慢）', () => {
  const env = makeEnv();
  const cards = addCards(env.body, 12, 100);

  run(env);
  assert.strictEqual(cards[0]._vars['--rv'], '0');
  assert.strictEqual(cards[7]._vars['--rv'], '7');
  assert.strictEqual(cards[11]._vars['--rv'], '8', '第 9 个以后一律 8 档');
});

test('标题行拆分：按视觉行成组，文本一个字都不丢', () => {
  const env = makeEnv();
  env.body.appendChild(makeEl('div'));
  const h = makeEl('b');
  h.setAttribute('data-lines', '');
  h.textContent = '今天把一个教学难点讲清楚';
  env.body.appendChild(h);

  run(env);
  const lines = h.children.filter((c) => c.classList.contains('line'));
  assert.ok(lines.length >= 2, '12 个字每行 6 个应拆成 2 行，实际 ' + lines.length + ' 行');
  assert.strictEqual(
    lines.map((l) => l.textContent).join(''),
    '今天把一个教学难点讲清楚',
    '拆完的文本必须与原文完全一致'
  );
  lines.forEach((l, i) => assert.strictEqual(l._vars['--i'], String(i), '行序号要写进 --i'));
  assert.ok(h.classList.contains('is-split'), '必须标 is-split 才会进入升起态');
  flushRaf(env);
  assert.ok(h.classList.contains('is-in'), '双 rAF 后应加上 is-in 开始播放');
});

test('标题行拆分：含子元素的标题不拆（保护 landing 的双语切换）', () => {
  const env = makeEnv();
  const h = makeEl('p');
  h.setAttribute('data-lines', '');
  const en = makeEl('span');
  en._cls.add('i18n-en');
  en.textContent = 'AI Micro-teaching Coach';
  const zh = makeEl('span');
  zh._cls.add('i18n-zh');
  zh.textContent = '师范生的 AI 试讲教练';
  h.appendChild(en);
  h.appendChild(zh);
  env.body.appendChild(h);

  run(env);
  assert.strictEqual(h.getAttribute('data-lines-split'), null, '不能被拆');
  assert.strictEqual(h.children.length, 2, '两种语言的 span 都必须原样保留');
});

test('标题行拆分：超长文本不拆（只拆标题，不拆正文）', () => {
  const env = makeEnv();
  const h = makeEl('b');
  h.setAttribute('data-lines', '');
  h.textContent = '一'.repeat(200);
  env.body.appendChild(h);

  run(env);
  assert.strictEqual(h.getAttribute('data-lines-split'), null, '160 字以上不拆，避免几百个 span');
});

test('motion.js：reduced-motion 时一行都不做（连 .js 类都不加）', () => {
  const env = makeEnv({ reduce: true });
  const cards = addCards(env.body, 2);
  run(env);
  assert.ok(!env.htmlEl.classList.contains('js'), '不该加 .js');
  cards.forEach((c) => assert.ok(!c.hasAttribute('data-reveal'), '不该挂隐藏态'));
});
