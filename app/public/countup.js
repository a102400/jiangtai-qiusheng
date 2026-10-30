/* ============================================================
   讲台求生 · 数字滚动 countup.js（零依赖）
   ------------------------------------------------------------
   搬运来源：React Bits 的 CountUp（registry: CountUp-JS-CSS）。
   项目没有 React / JSX 编译链，所以不是「装包引用」，而是把它的
   数值行为逐条搬成原生实现：

     · CELL = 1.2em          每个数字格的视觉高度（1 行 = 1.2em）
     · STAGGER = 0.07s       同一批里各数字列的起跑错峰
     · duration 默认 2s      模板默认值，报告大分数用
     · easing 默认 easeOut   = cubicBezier(0.33, 1, 0.68, 1)
     · makeSpring(0.06)      模板的 spring 档（overshoot 6%）
     · roll 模式的行进量：
         base  = mod10(to - from)
         turns = min(floor(|to-from| / (10^(place+1))), max(0, 3 - rank))
         delta = base + 10 * turns
       也就是「低位多转几圈、高位少转」，是它看起来像机械计数器的原因
     · 高速时加纵向动态模糊：
         sigma = u∈(0,1) ? min(cell*0.05, speed*cell/600) : 0

   两种模式：
     · roll  机械式数字列（报告总分用，仪式感最强）
     · count 纯文本插值（指标卡用，安静）

   安全设计：
     · 只改「纯数字的那个文本节点」，`<u>%</u>` 这类单位节点一个字不动
     · 非数字（未提供 / 无法测量 / —）直接跳过，不把结论变成 0
     · 不可见（hidden / display:none）不提前跑，等变可见再补
     · prefers-reduced-motion: reduce → 一律直接落终值，不做动画
     · 同一个目标值只播一次（data-count-to 记目标），避免 MO 自激
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 曲线 ---------------- */

  /* motion 的 cubicBezier：Newton 迭代求 x → t，再取 y */
  function cubicBezier(x1, y1, x2, y2) {
    function A(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function B(a1, a2) { return 3 * a2 - 6 * a1; }
    function C(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; }
    function slope(t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); }
    function solveX(x) {
      var t = x;
      for (var i = 0; i < 6; i++) {
        var s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      return t;
    }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return calc(solveX(x), y1, y2);
    };
  }

  /* CountUp 原式的阻尼弹簧：先算出 zeta，再补一项 residual*t^3 保证 t=1 收敛到 1
     （不加这一项，弹簧在 1 附近会留零点几个百分点的误差，数字最后一位会抖） */
  function makeSpring(overshoot) {
    var log = Math.log(Math.min(0.5, Math.max(0.001, overshoot)));
    var zeta = -log / Math.sqrt(Math.PI * Math.PI + log * log);
    var damped = Math.PI / 0.52;
    var natural = damped / Math.sqrt(1 - zeta * zeta);
    function raw(t) {
      return 1 - Math.exp(-zeta * natural * t) *
        (Math.cos(damped * t) + ((zeta * natural) / damped) * Math.sin(damped * t));
    }
    var residual = 1 - raw(1);
    return function (t) {
      return t >= 1 ? 1 : raw(t) + residual * t * t * t;
    };
  }

  var EASINGS = {
    linear: function (t) { return t; },
    easeOut: cubicBezier(0.33, 1, 0.68, 1),
    expo: function (t) {
      return t >= 1 ? 1 : (1 - Math.pow(2, -10 * t)) / (1 - Math.pow(2, -10));
    },
    spring: makeSpring(0.06)
  };

  var CELL = 1.2;        // em
  var STAGGER = 0.07;    // s
  var DURATION = 2;      // s，模板默认值
  var GRID_DURATION = 1.1; // s，指标卡（小字号、多次出现，2s 会显得拖）

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }
  function mod10(v) { return ((v % 10) + 10) % 10; }
  function now() { return window.performance && window.performance.now ? window.performance.now() : Date.now(); }
  function raf(fn) { return window.requestAnimationFrame ? window.requestAnimationFrame(fn) : window.setTimeout(fn, 16); }

  function dp(num) {
    var str = String(num);
    if (str.indexOf('.') !== -1) {
      var dec = str.split('.')[1];
      if (parseInt(dec, 10) !== 0) return dec.length;
    }
    return 0;
  }

  function group(int, sep) {
    return sep ? int.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : int;
  }

  /* 数字 → 展示串。digits 由调用方定（默认取 from/to 里更长的那个小数位） */
  function formatValue(value, digits, sep, prefix, suffix) {
    var d = digits === undefined || digits === null ? dp(value) : digits;
    var fixed = Math.abs(value).toFixed(d);
    var parts = fixed.split('.');
    var body = (value < 0 && Number(fixed) !== 0 ? '-' : '') +
      group(parts[0], sep) + (parts[1] ? '.' + parts[1] : '');
    return (prefix || '') + body + (suffix || '');
  }

  /* ---------------- roll 模式的行进模型 ---------------- */

  function splitNumber(value, digits, size) {
    var fixed = (Math.abs(value) / size).toFixed(digits);
    var parts = fixed.split('.');
    return {
      negative: value < 0 && Number(fixed) !== 0,
      int: parts[0],
      frac: parts[1] || ''
    };
  }

  /**
   * 生成一次滚动的局面：哪些槽位是字符（小数点 / 负号 / 千分位），
   * 哪些是数字列，以及每个数字列要转多少格。
   * 纯函数，不碰 DOM —— 测试直接断言 delta。
   */
  function buildRoll(a, b, spin, opts) {
    opts = opts || {};
    var size = opts.size || 1;
    var digits = opts.digits === undefined ? Math.max(dp(a), dp(b)) : opts.digits;
    var separator = opts.separator || '';
    var pa = splitNumber(a, digits, size);
    var pb = splitNumber(b, digits, size);
    var length = Math.max(pa.int.length, pb.int.length);
    var slots = [];
    var columns = [];

    if (pa.negative || pb.negative) {
      slots.push({ char: '-', enter: !pa.negative, leave: !pb.negative });
    }

    function digitAt(parts, place) {
      if (place < 0) return Number(parts.frac[-place - 1]);
      var index = parts.int.length - 1 - place;
      return index >= 0 ? Number(parts.int[index]) : null;
    }

    for (var place = length - 1; place >= -digits; place--) {
      if (place === -1) slots.push({ char: '.' });
      var start = digitAt(pa, place);
      var end = digitAt(pb, place);
      var column = {
        slot: slots.length,
        index: columns.length,
        place: place,
        from: start === null ? 0 : start,
        to: end === null ? 0 : end,
        enter: start === null,
        leave: end === null
      };
      slots.push(column);
      columns.push(column);
      if (separator && place > 0 && place % 3 === 0) {
        slots.push({ char: separator, follow: column.index });
      }
    }

    var up = spin || b >= a;
    columns.forEach(function (column, index) {
      var rank = columns.length - 1 - index;
      var base = up ? mod10(column.to - column.from) : -mod10(column.from - column.to);
      var turns = spin
        ? Math.max(1, 3 - rank)
        : Math.min(
            Math.floor(Math.abs(b - a) / (size * Math.pow(10, column.place + 1))),
            Math.max(0, 3 - rank)
          );
      column.delta = base + (up ? 10 : -10) * turns;
    });

    return { slots: slots, columns: columns, digits: digits };
  }

  /* ---------------- DOM ---------------- */

  function visible(el) {
    return !!(el.getClientRects && el.getClientRects().length);
  }

  function span(cls, text) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    if (text !== undefined) s.textContent = text;
    return s;
  }

  /* roll 的静态骨架：字符槽 + 数字列（每列 4 格，偏移 -1..2，和模板一致） */
  function renderRoll(el, model) {
    var box = span('cu');
    var cellsFor = [];
    model.slots.forEach(function (slot) {
      if (slot.char !== undefined) {
        box.appendChild(span('cu__mark', slot.char));
        return;
      }
      var col = span('cu__col');
      var strip = span('cu__strip');
      strip.style.transform = 'translateY(' + (-CELL) + 'em)';
      var cells = [];
      [-1, 0, 1, 2].forEach(function (offset) {
        var cell = span('cu__cell', String(mod10(slot.from + offset)));
        strip.appendChild(cell);
        cells.push(cell);
      });
      col.appendChild(strip);
      box.appendChild(col);
      cellsFor[slot.index] = { col: col, strip: strip, cells: cells };
    });
    el.textContent = '';
    el.appendChild(box);
    return { box: box, cells: cellsFor };
  }

  function roll(el, from, to, opts) {
    opts = opts || {};
    var total = opts.duration === undefined ? DURATION : opts.duration;
    var ease = EASINGS[opts.easing || 'easeOut'];
    /* 起点写在元素上：重新分析时「从当前值接着走」这件事能被看见、能被测 */
    el.setAttribute('data-cu-start', String(from));
    var model = buildRoll(from, to, !!opts.spin, {
      digits: opts.digits,
      separator: opts.separator
    });

    if (reduce || total <= 0) {
      el.textContent = formatValue(to, opts.digits, opts.separator, opts.prefix, opts.suffix);
      if (typeof opts.onUpdate === 'function') opts.onUpdate(1);
      return;
    }

    el.classList.remove('is-settled');
    var dom = renderRoll(el, model);
    var cols = model.columns.length;
    /* 错峰只在总时长的 40% 内分配（模板原式），列多时自动压缩，
       否则 6 位数会排到 0.4s 起步、动画拖到 3 秒 */
    var stagger = cols > 1 ? Math.min(STAGGER, (total * 0.4) / (cols - 1)) : 0;
    /* 名字不能叫 span：会盖掉上面的 span() 建节点函数，导致 strip 全是 undefined */
    var spanSec = Math.max(0.001, total - stagger * (cols - 1));
    var base = model.columns.map(function (c) { return Math.floor(c.from); });
    var sigma = model.columns.map(function () { return 0; });
    var cellPx = 0;
    var start = null;

    function frame(ts) {
      if (start === null) start = ts;
      var t = (ts - start) / 1000;
      if (!cellPx) {
        var fs = 16;
        try {
          fs = parseFloat(window.getComputedStyle(el).fontSize) || 16;
        } catch (e) { fs = 16; }
        cellPx = CELL * fs;
      }

      model.columns.forEach(function (c, i) {
        var node = dom.cells[i];
        if (!node) return;
        var u = clamp01((t - i * stagger) / spanSec);
        var pos = c.from + c.delta * ease(u);
        var b = Math.floor(pos);
        if (b !== base[i]) {
          base[i] = b;
          for (var k = 0; k < node.cells.length; k++) {
            node.cells[k].textContent = String(mod10(b + k - 1));
          }
        }
        node.strip.style.transform = 'translateY(' + (-(1 + pos - b) * CELL).toFixed(4) + 'em)';

        /* 动态模糊：只在运动中加，落位后必须清掉（否则最后一位一直是糊的） */
        var u0 = Math.max(0, u - 0.004);
        var u1 = Math.min(1, u + 0.004);
        var speed = u1 > u0
          ? (Math.abs(c.delta) * Math.abs(ease(u1) - ease(u0))) / (u1 - u0) / spanSec
          : 0;
        var s2 = u > 0 && u < 1 ? Math.min(cellPx * 0.05, (speed * cellPx) / 600) : 0;
        if (Math.abs(s2 - sigma[i]) > 0.05 || (s2 === 0 && sigma[i] !== 0)) {
          sigma[i] = s2;
          node.strip.style.filter = s2 > 0.2 ? 'blur(' + s2.toFixed(2) + 'px)' : '';
        }
      });

      if (typeof opts.onUpdate === 'function') {
        opts.onUpdate(clamp01(t / total), from + (to - from) * ease(clamp01(t / total)));
      }

      if (t < total) {
        raf(frame);
        return;
      }

      /* 落位：把数字列换回一个纯文本节点。
         这一步模板没有（它留着滚动 DOM），但留着的话：
           · textContent 会读出「012908…」一整串格子，复制和读屏都是乱码
           · 每列 4 个格子会一直挂在 DOM 里，报告里 20 个数字就是 80 个废节点
         视觉上完全等价：滚动条停在终值时露出的就是这几个字。 */
      if (typeof opts.onUpdate === 'function') opts.onUpdate(1, to);
      el.textContent = formatValue(to, opts.digits, opts.separator, opts.prefix, opts.suffix);
      el.classList.add('is-settled');
    }

    raf(frame);
  }

  /**
   * count 模式：直接把插值写进元素的**第一个文本节点**。
   * 这样 `<div class="val">87<u>%</u></div>` 的百分号不会被写坏。
   */
  function findTextNode(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && /\d/.test(n.nodeValue || '')) return n;
    }
    return null;
  }

  function count(el, from, to, opts) {
    opts = opts || {};
    var total = opts.duration === undefined ? GRID_DURATION : opts.duration;
    var ease = EASINGS[opts.easing || 'easeOut'];
    var digits = opts.digits === undefined ? Math.max(dp(from), dp(to)) : opts.digits;
    var node = findTextNode(el);

    if (!node) {
      el.setAttribute('data-count-to', String(to));
      return;
    }

    if (reduce || total <= 0) {
      node.nodeValue = formatValue(to, digits, opts.separator, opts.prefix, opts.suffix);
      el.setAttribute('data-count-to', String(to));
      return;
    }

    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = clamp01((ts - start) / (total * 1000));
      node.nodeValue = formatValue(from + (to - from) * ease(p), digits, opts.separator,
        opts.prefix, opts.suffix);
      if (p < 1) { raf(frame); return; }
      node.nodeValue = formatValue(to, digits, opts.separator, opts.prefix, opts.suffix);
    }
    raf(frame);
  }

  /* ---------------- 报告总分：数字列 + 分数环同步 ---------------- */

  function parseNumber(el) {
    var raw = (el.textContent || '').replace(/[^\d.\-]/g, '');
    if (!raw || !/\d/.test(raw)) return null;
    var n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /* 上一次画到环上的百分比：重新分析时从当前值接着走，不从 0 重来
     （否则改一处讲稿再分析，环会先「退回 0」再冲上去，像出错） */
  var ringPct = 0;

  function score(value) {
    var numEl = document.getElementById ? document.getElementById('scoreNum') : null;
    var ringEl = document.getElementById ? document.getElementById('scoreRing') : null;
    var to = Number(value);
    if (!Number.isFinite(to)) to = 0;
    if (to < 0 || to > 100) to = Math.min(100, Math.max(0, to));

    /* 分数环跟着同一根曲线走 —— 数字滚到 60 时环也正好 60%，
       两条时间线不同步的话，看起来像数字和环各说各话 */
    if (ringEl) {
      var fromPct = ringPct;
      var ringStart = null;
      /* .ring 自带 transition:background .6s，逐帧写 gradient 会被它拖着走，
         表现成「追不上手指的果冻」。动画期间先关掉，落位后再交还给 CSS。 */
      ringEl.style.transition = 'none';
      function paint(pct) {
        ringPct = pct;
        ringEl.style.background =
          'conic-gradient(var(--brand) 0 ' + pct.toFixed(2) + '%, var(--line) ' +
          pct.toFixed(2) + '% 100%)';
      }
      if (reduce) {
        paint(to);
        ringEl.style.transition = '';
      } else {
        (function ringFrame(ts) {
          if (ringStart === null) ringStart = ts;
          var p = clamp01((ts - ringStart) / (DURATION * 1000));
          paint(fromPct + (to - fromPct) * EASINGS.easeOut(p));
          if (p < 1) { raf(ringFrame); return; }
          paint(to);
          ringEl.style.transition = '';
        })(now());
      }
    }

    if (!numEl) return;
    var from = parseNumber(numEl) || 0;
    roll(numEl, from, to, { duration: DURATION, easing: 'easeOut', digits: 0 });
  }

  /* ---------------- 自动挂载：指标卡的数值 ---------------- */

  var COUNT_SEL = '.metric .val, [data-count]';

  function targets(root) {
    var scope = root || document;
    var list = scope.querySelectorAll(COUNT_SEL);
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  function scan(root) {
    if (reduce) return 0;
    var list = targets(root);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;                 // 隐藏时不跑，等变可见补
      var to = parseNumber(el);
      if (to === null) continue;                  // 未提供 / 无法测量 / — ：不动
      if (el.getAttribute('data-count-to') === String(to)) continue; // 同值不重播
      el.setAttribute('data-count-to', String(to));
      var from = el.hasAttribute('data-count-from')
        ? Number(el.getAttribute('data-count-from'))
        : 0;
      count(el, from, to, { duration: GRID_DURATION });
      n++;
    }
    return n;
  }

  /* 异步渲染完（报告出来、切 tab、表格重画）都要补一次扫描。
     只盯 childList / hidden / class：count 模式写的是文本节点，
     不会触发 childList，所以不存在自激循环。 */
  var timer = 0;
  function schedule() {
    if (timer) return;
    timer = window.setTimeout(function () {
      timer = 0;
      if (!visible(document.body)) return;
      scan();
    }, 240);
  }

  if ('MutationObserver' in window) {
    var mo = new window.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          if (r.addedNodes && r.addedNodes.length) { schedule(); return; }
          continue;
        }
        if (r.attributeName === 'hidden' || r.attributeName === 'class') { schedule(); return; }
      }
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'class']
    });
  }

  scan();

  window.jtqCount = {
    score: score,
    scan: scan,
    count: count,
    roll: roll,
    formatValue: formatValue,
    /* 纯函数出口：测试直接断言行进量与曲线，不用猜 DOM */
    debug: {
      buildRoll: buildRoll,
      cubicBezier: cubicBezier,
      makeSpring: makeSpring,
      easings: EASINGS,
      mod10: mod10,
      CELL: CELL,
      STAGGER: STAGGER,
      DURATION: DURATION,
      GRID_DURATION: GRID_DURATION
    }
  };
})();
