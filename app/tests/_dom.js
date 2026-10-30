'use strict';

/**
 * 极简 DOM 桩 —— 给 countup.js / blurtext.js 的契约测试用。
 *
 * 只实现这两个脚本真正调用到的 API：
 *   createElement / createDocumentFragment / getElementById / querySelectorAll
 *   appendChild / childNodes / textContent / className / classList
 *   style.setProperty / getAttribute / setAttribute / getClientRects / addEventListener
 *
 * 刻意**不**实现 innerHTML、布局、事件派发 —— 桩越像浏览器，测试越容易
 * 变成「测桩」而不是测脚本。这里要验的是：数字列的 delta 算得对不对、
 * 文本节点有没有被写坏、隐藏态会不会提前开跑。
 */

let uid = 0;

function textNode(value) {
  return {
    nodeType: 3,
    nodeValue: String(value),
    parentNode: null,
    get textContent() { return this.nodeValue; }
  };
}

function makeStyle() {
  const style = {
    setProperty(k, v) { style[k] = String(v); },
    getPropertyValue(k) { return style[k] === undefined ? '' : style[k]; },
    removeProperty(k) { delete style[k]; }
  };
  return style;
}

function makeEl(tag) {
  const el = {
    _id: ++uid,
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    childNodes: [],
    parentNode: null,
    _attrs: {},
    _cls: new Set(),
    _hidden: false,
    _listeners: {},
    style: makeStyle()
  };

  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    contains(c) { return el._cls.has(c); },
    toggle(c, on) { if (on) el._cls.add(c); else el._cls.delete(c); }
  };

  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._cls).join(' '); },
    set(v) {
      el._cls.clear();
      String(v || '').split(/\s+/).forEach((c) => { if (c) el._cls.add(c); });
    }
  });

  Object.defineProperty(el, 'hidden', {
    get() { return el._hidden; },
    set(v) { el._hidden = !!v; }
  });

  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.hasAttribute = (k) => k in el._attrs;
  el.removeAttribute = (k) => { delete el._attrs[k]; };

  el.appendChild = (node) => {
    if (node && node._frag) {
      node.childNodes.slice().forEach((c) => el.appendChild(c));
      node.childNodes.length = 0;
      return node;
    }
    node.parentNode = el;
    el.childNodes.push(node);
    return node;
  };

  Object.defineProperty(el, 'textContent', {
    get() {
      return el.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    },
    set(v) {
      el.childNodes.length = 0;
      const s = String(v === undefined || v === null ? '' : v);
      if (s) el.appendChild(textNode(s));
    }
  });

  Object.defineProperty(el, 'firstChild', {
    get() { return el.childNodes[0] || null; }
  });

  el.getClientRects = () => (el._hidden ? [] : [{}]);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20 });
  el.addEventListener = (type, fn) => {
    (el._listeners[type] = el._listeners[type] || []).push(fn);
  };
  el.dispatch = (type) => (el._listeners[type] || []).forEach((fn) => fn({ type }));

  el.querySelectorAll = (sel) => {
    const out = [];
    (function walk(node) {
      node.childNodes.forEach((c) => {
        if (c.nodeType !== 1) return;
        if (matchSel(c, sel)) out.push(c);
        walk(c);
      });
    })(el);
    return out;
  };
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  el.matches = (sel) => matchSel(el, sel);

  return el;
}

function matchSel(el, sel) {
  return String(sel).split(',').some((one) => {
    const s = one.trim();
    if (!s) return false;
    if (s.charAt(0) === '.') return el._cls.has(s.slice(1).split('.')[0]);
    return el.tagName === s.toUpperCase();
  });
}

function makeDoc() {
  const body = makeEl('body');
  const ids = {};
  const doc = {
    body,
    hidden: false,
    documentElement: makeEl('html'),
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => {
      const frag = makeEl('#fragment');
      frag._frag = true;
      return frag;
    },
    getElementById: (id) => ids[id] || null,
    addEventListener() {},
    querySelectorAll(sel) {
      /* 业务真实用到的两种选择器：
         · '.metric .val'   指标卡数值（要按「有 .metric 祖先」筛）
         · '.bt-piece'      模糊渐入片段 */
      const parts = String(sel).split(',').map((s) => s.trim());
      const out = [];
      if (parts.indexOf('.metric .val') !== -1) {
        (function walk(node, inMetric) {
          node.childNodes.forEach((c) => {
            if (c.nodeType !== 1) return;
            const nextInMetric = inMetric || c._cls.has('metric');
            if (nextInMetric && c._cls.has('val') && !c.parentIsMetric) {
              /* 只有直接挂在 .metric 下的 .val 才算（真实的子代选择器语义） */
              if (c.parentNode && c.parentNode._cls.has('metric')) out.push(c);
            }
            walk(c, nextInMetric);
          });
        })(body, false);
      }
      if (parts.indexOf('.bt-piece') !== -1) {
        (function walk(node) {
          node.childNodes.forEach((c) => {
            if (c.nodeType !== 1) return;
            if (c._cls.has('bt-piece')) out.push(c);
            walk(c);
          });
        })(body);
      }
      return out;
    },
    _ids: ids
  };
  return doc;
}

/**
 * 造一个能跑 countup.js / blurtext.js 的环境。
 * opts.reduce   = true → matchMedia 报「减少动效」
 * opts.hidden   = true → body 及所有元素的 getClientRects() 为空
 */
function makeEnv(opts = {}) {
  const doc = makeDoc();
  const rafQ = [];
  const timers = [];
  const env = { t: 0 };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    scrollY: 0,
    matchMedia: (q) => ({
      matches: q.indexOf('prefers-reduced-motion') !== -1 ? !!opts.reduce : false,
      addEventListener() {},
      addListener() {}
    }),
    requestAnimationFrame(fn) { rafQ.push(fn); return rafQ.length; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    performance: { now: () => env.t },
    getComputedStyle: () => ({ fontSize: '28px' })
  };

  win.MutationObserver = class {
    constructor(cb) { doc._mo = cb; }
    observe() {}
    disconnect() {}
  };

  const sandbox = {
    window: win,
    document: doc,
    MutationObserver: win.MutationObserver,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    Date,
    console,
    parseFloat,
    parseInt,
    isFinite
  };
  sandbox.globalThis = sandbox;
  sandbox.self = win;

  env.sandbox = sandbox;
  env.win = win;
  env.doc = doc;
  env.body = doc.body;
  env.rafQ = rafQ;
  env.timers = timers;

  /** 跑完当前 rAF 队列（每帧推进 step 毫秒），直到队列空或达到上限 */
  env.frames = (step = 50, max = 400) => {
    let n = 0;
    while (rafQ.length && n < max) {
      const batch = rafQ.splice(0, rafQ.length);
      env.t += step;
      batch.forEach((fn) => fn(env.t));
      n++;
    }
    return n;
  };

  /** 冲掉节流定时器（触发一次自动扫描） */
  env.timers_ = () => {
    const batch = timers.splice(0, timers.length);
    batch.forEach((t) => t.fn());
  };

  return env;
}

module.exports = { makeEl, makeEnv, textNode };
