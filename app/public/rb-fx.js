/* ============================================================
   讲台求生 · 五个 react-bits 效果的原生移植 rb-fx.js（零依赖）
   ------------------------------------------------------------
   来源：https://reactbits.dev （MIT + Commons Clause，可免费商用）
     · spotlight ← SpotlightCard  (JS-CSS)
     · magnet    ← Magnet         (JS-CSS)
     · glare     ← GlareHover     (JS-CSS) —— 纯 CSS，本文件只负责挂类名
     · tilt      ← TiltedCard     (JS-CSS)
     · enter     ← AnimatedContent(JS-CSS，上游依赖 gsap，本项目已有 vendor)

   为什么是「移植」不是「装包」：本项目是纯静态 HTML，没有 React / JSX
   编译链（同 blurtext.js / countup.js 的处理方式）。所有效果改写成
   CSS 变量驱动，不改现有 DOM 结构与布局。

   关键约束（改坏了会直接白屏或抖成筛子）：
     1. 学生卡片是 renderClassStudents() 用 innerHTML 重建的，
        不能给单张卡绑事件 —— 必须在容器上做事件委托。
     2. 磁吸必须用独立的 `translate` 属性（CSS 里已定），
        不能用 transform，否则会覆盖按钮自己的 hover 动画。
     3. 计算磁吸位移时要把当前的 translate 从 getBoundingClientRect
        里减掉，否则「位移改变 rect → rect 改变位移」会自激抖动。
     4. 元素一旦有 transform，getBoundingClientRect() 返回的是**变换后**
        的轴对齐包围盒（旋转时宽高都会变大）。所以聚光与倾斜的指针坐标
        一律用「中心点 + offsetWidth/offsetHeight」反推，不能用 rect 宽高，
        否则倾斜角度一变坐标就跟着变，光斑会自己游走。
     5. enter 的初始隐藏由 JS 在 gsap 可用时才设置，**绝不写进 HTML/CSS**：
        gsap 没加载时元素必须默认可见，否则报告区会整片空白。
     6. prefers-reduced-motion 下一律不动。
   ============================================================ */

(function initRbFx(root) {
  'use strict';

  var REDUCE = false;
  try {
    REDUCE = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* matchMedia 不可用时按「允许动效」处理 */ }

  /* 注意：Number(null) === 0、Number('') === 0，所以必须先挡住空值，
     否则 data 属性没写时会拿到 0 而不是默认值（光斑变 0px、磁吸上限变 0）。 */
  function num(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  /* 指针在元素内的「未变换坐标系」位置。
     元素被 rotateX/rotateY 旋转后，getBoundingClientRect() 给出的是变换后
     的轴对齐包围盒（比原尺寸大），拿去减 left/top 会得到偏移的坐标，而且
     偏移量随倾斜角度变化 —— 光斑会跟着指针自己漂。
     旋转是绕元素中心的，中心点位置不变，所以：中心点用 rect 求，
     半宽半高用 offsetWidth/offsetHeight 求。返回 {x, y, nx, ny}，
     nx/ny 是 -1..1 的归一化坐标（供倾斜使用）。 */
  function localPoint(el, event) {
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    var w = el.offsetWidth || rect.width;
    var h = el.offsetHeight || rect.height;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = event.clientX - cx;
    var dy = event.clientY - cy;

    return {
      x: Math.round(dx + w / 2),
      y: Math.round(dy + h / 2),
      nx: w ? clamp(dx / (w / 2), -1, 1) : 0,
      ny: h ? clamp(dy / (h / 2), -1, 1) : 0
    };
  }

  /* ---------------- SpotlightCard：指针聚光 ---------------- */
  /* 容器上委托：指针在哪张卡上，就把光斑坐标写进那张卡的 CSS 变量。
     不用 rAF 节流 —— 只是 4 次 setProperty，pointermove 本身已被浏览器
     限到帧率；走 rAF 反而让首帧慢一拍（hover 时有可感知的延迟）。 */
  function spotlight(box, selector, opts) {
    if (!box) return null;
    var o = opts || {};
    var size = num(o.size, 220);
    var activeCard = null;

    function paint(card, x, y) {
      if (activeCard && activeCard !== card) {
        activeCard.style.setProperty('--rb-spot-on', '0');
      }
      // 卡片是 innerHTML 重建的，类名只能懒加：第一次被指针划到才补上
      if (!card.classList.contains('rb-spotlight')) {
        card.classList.add('rb-spotlight');
      }
      card.style.setProperty('--rb-spot-size', size + 'px');
      card.style.setProperty('--rb-spot-x', x + 'px');
      card.style.setProperty('--rb-spot-y', y + 'px');
      card.style.setProperty('--rb-spot-on', '1');
      activeCard = card;
    }

    function onMove(event) {
      if (REDUCE) return;
      var target = event.target;
      var card = target && target.closest ? target.closest(selector) : null;
      if (!card || !box.contains(card)) return;

      var spot = localPoint(card, event);
      if (!spot) return;
      paint(card, spot.x, spot.y);
    }

    function off() {
      if (activeCard) {
        activeCard.style.setProperty('--rb-spot-on', '0');
        activeCard = null;
      }
    }

    box.addEventListener('pointermove', onMove, { passive: true });
    box.addEventListener('pointerleave', off, { passive: true });
    box.addEventListener('pointercancel', off, { passive: true });

    return function dispose() {
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerleave', off);
      box.removeEventListener('pointercancel', off);
      off();
    };
  }

  /* ---------------- Magnet：指针磁吸 ---------------- */
  function magnet(el, opts) {
    if (!el) return null;
    var o = opts || {};
    var padding = num(o.padding, 90);
    var strength = num(o.strength, 0.34);
    var maxOffset = num(o.maxOffset, 16);
    var axis = o.axis || 'both';

    var cur = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var raf = 0;

    function readCurrent() {
      return {
        x: parseFloat(el.style.getPropertyValue('--rb-mx')) || 0,
        y: parseFloat(el.style.getPropertyValue('--rb-my')) || 0
      };
    }

    function frame() {
      raf = 0;
      var dx = target.x - cur.x;
      var dy = target.y - cur.y;

      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
        cur.x = target.x;
        cur.y = target.y;
        el.style.setProperty('--rb-mx', cur.x + 'px');
        el.style.setProperty('--rb-my', cur.y + 'px');
        return;
      }

      cur.x += dx * 0.18;
      cur.y += dy * 0.18;
      el.style.setProperty('--rb-mx', cur.x.toFixed(2) + 'px');
      el.style.setProperty('--rb-my', cur.y.toFixed(2) + 'px');
      raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function onMove(event) {
      if (REDUCE) return;

      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // 扣掉自身已有的 translate，避免位移反过来影响判定（自激抖动）
      var now = readCurrent();
      var left = rect.left - now.x;
      var top = rect.top - now.y;

      var dx = event.clientX - (left + rect.width / 2);
      var dy = event.clientY - (top + rect.height / 2);

      var outX = Math.max(0, Math.abs(dx) - rect.width / 2);
      var outY = Math.max(0, Math.abs(dy) - rect.height / 2);
      var outside = Math.sqrt(outX * outX + outY * outY);

      if (outside > padding) {
        target.x = 0;
        target.y = 0;
        wake();
        return;
      }

      var falloff = 1 - outside / padding; // 越靠近中心越强
      target.x = axis === 'y' ? 0 : clamp(dx * strength * falloff, -maxOffset, maxOffset);
      target.y = axis === 'x' ? 0 : clamp(dy * strength * falloff, -maxOffset, maxOffset);
      wake();
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', function reset() {
      target.x = 0;
      target.y = 0;
      wake();
    });

    return function dispose() {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }

  /* ---------------- TiltedCard：指针 3D 倾斜 ---------------- */
  /* 只保留上游最核心的一层：指针位置 → 双轴旋转（带指数趋近回正）。
     砍掉的：backContent 翻转、gyroscope 陀螺仪、tooltip、intro 入场、
     trackWindow 窗口级跟随、多层 translateZ 视差、独立阴影层。
     理由同 spotlight —— 学生卡只有 100px 宽、内容密集，这些层叠上去只会显脏。
     注意上游用六次平滑 + 弹簧积分，这里改成指数趋近：同一条观感，代码少一个量级。 */
  function tilt(box, selector, opts) {
    if (!box) return null;
    var o = opts || {};
    var maxDeg = clamp(num(o.amplitude, 12), 0, 30);
    var ease = clamp(num(o.smoothness, 0.2), 0.05, 1);
    if (!maxDeg) return null;

    var cur = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var raf = 0;
    var active = null;

    function write() {
      if (!active) return;
      active.style.setProperty('--rb-rx', cur.x.toFixed(2) + 'deg');
      active.style.setProperty('--rb-ry', cur.y.toFixed(2) + 'deg');
    }

    function release(el) {
      if (!el) return;
      el.style.setProperty('--rb-rx', '0deg');
      el.style.setProperty('--rb-ry', '0deg');
    }

    function frame() {
      raf = 0;
      var dx = target.x - cur.x;
      var dy = target.y - cur.y;

      if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) {
        cur.x = target.x;
        cur.y = target.y;
        write();
        return;
      }

      cur.x += dx * ease;
      cur.y += dy * ease;
      write();
      raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function onMove(event) {
      if (REDUCE || !maxDeg) return;
      var el = event.target && event.target.closest
        ? event.target.closest(selector)
        : null;
      if (!el || !box.contains(el)) return;

      var p = localPoint(el, event);
      if (!p) return;

      // 卡片是 innerHTML 重建的：换了节点就把旧节点摆平、类补到新节点上
      if (active !== el) {
        if (active) release(active);
        if (!el.classList.contains('rb-tilt')) el.classList.add('rb-tilt');

        /* 透视距离必须随元素尺寸走。固定 620px 放在 100px 宽的卡上，
           边缘前后只差 10px 对 620px 的透视 —— 基本看不出立体；
           放在 300px 宽的卡上又会晕。取宽度的 3 倍，接近「手持手机的距离感」。 */
        var w = el.offsetWidth || 200;
        el.style.setProperty('--rb-persp', Math.round(clamp(w * 3, 260, 900)) + 'px');

        cur.x = 0;
        cur.y = 0;
        active = el;
      }

      target.x = p.ny * maxDeg;  // rotateX：指针偏下 → 顶边后仰
      target.y = -p.nx * maxDeg; // rotateY：指针偏右 → 右边后退
      wake();
    }

    function onLeave() {
      target.x = 0;
      target.y = 0;
      wake();
    }

    box.addEventListener('pointermove', onMove, { passive: true });
    box.addEventListener('pointerleave', onLeave, { passive: true });
    box.addEventListener('pointercancel', onLeave, { passive: true });

    return function dispose() {
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerleave', onLeave);
      box.removeEventListener('pointercancel', onLeave);
      if (raf) cancelAnimationFrame(raf);
      release(active);
      active = null;
    };
  }

  /* ---------------- AnimatedContent：分批入场 ---------------- */
  /* 上游用 ScrollTrigger 做滚动触发。本项目报告卡是「点分析后立刻出现」，
     而且面板在隐藏 tab 里时 ScrollTrigger 的 start 算不出有效值、可能永不触发，
     所以固定为挂载即播（等于上游的 trigger: 'mount'）。
     最要紧的一条：**初始隐藏只在 gsap 可用时由 JS 设置**。
     上游把 visibility:hidden 写在 JSX 的 style 里，一旦 gsap 没加载，
     内容就永远看不见 —— 这里绝不能照抄。 */
  function enter(target, opts) {
    if (!target || REDUCE) return null;
    var gsap = root.gsap;
    if (!gsap) return null; // 没 gsap 就保持默认可见，只是没有动画

    var o = opts || {};
    var list = [];
    var found = o.selector ? childrenOf(target, o.selector) : null;
    for (var i = 0; found && i < found.length; i++) list.push(found[i]);
    if (!list.length) list.push(target);

    var distance = num(o.distance, 16);
    var stagger = num(o.stagger, 0.055);
    var duration = num(o.duration, 0.52);

    try {
      // 快速连点「开始分析」时，上一轮 tween 可能还在跑。先停掉，
      // 否则新旧两条 tween 抢同一批元素的 opacity，会闪一下再重播。
      gsap.killTweensOf(list);
      gsap.set(list, { opacity: 0, y: distance });

      return gsap.to(list, {
        opacity: 1,
        y: 0,
        duration: duration,
        ease: 'power2.out',
        stagger: stagger,
        overwrite: true,
        // 播完清掉内联样式：留着内联 opacity / transform 会压住
        // .metric 自己的背景色过渡和 hover 效果
        clearProps: 'opacity,transform'
      });
    } catch (e) {
      // 任何异常都退回「直接可见」，绝不让报告区停在 opacity:0
      try { gsap.set(list, { clearProps: 'opacity,transform' }); } catch (e2) { /* 忽略 */ }
      return null;
    }
  }

  /* ---------------- 自动挂载 ---------------- */
  /* 用 data 属性声明，避免在 app.js（260KB）里再加分支：
       <div id="classStudents" data-rb-spotlight=".cs-card" data-rb-tilt=".cs-card">
       <button id="analyzeBtn" data-rb-magnet>
       <div id="metricsGrid" data-rb-glare="> *">                */
  var disposers = [];

  /* querySelectorAll 不接受以 ">" 开头的选择器，这里补上 :scope */
  function childrenOf(box, selector) {
    if (!selector) return [];
    var sel = selector.charAt(0) === '>' ? ':scope ' + selector : selector;
    try {
      return box.querySelectorAll(sel);
    } catch (e) {
      return [];
    }
  }

  function markGlare() {
    var glares = document.querySelectorAll('[data-rb-glare]');
    for (var k = 0; k < glares.length; k++) {
      var items = childrenOf(glares[k], glares[k].getAttribute('data-rb-glare'));
      for (var m = 0; m < items.length; m++) items[m].classList.add('rb-glare');
    }
  }

  function auto() {
    var spots = document.querySelectorAll('[data-rb-spotlight]');
    for (var i = 0; i < spots.length; i++) {
      disposers.push(spotlight(
        spots[i],
        spots[i].getAttribute('data-rb-spotlight') || '.cs-card',
        { size: num(spots[i].getAttribute('data-rb-spot-size'), 220) }
      ));
    }

    var magnets = document.querySelectorAll('[data-rb-magnet]');
    for (var j = 0; j < magnets.length; j++) {
      magnets[j].classList.add('rb-magnet');
      disposers.push(magnet(magnets[j], {
        padding: num(magnets[j].getAttribute('data-rb-magnet-padding'), 90),
        maxOffset: num(magnets[j].getAttribute('data-rb-magnet-max'), 16)
      }));
    }

    var tilts = document.querySelectorAll('[data-rb-tilt]');
    for (var t = 0; t < tilts.length; t++) {
      disposers.push(tilt(
        tilts[t],
        tilts[t].getAttribute('data-rb-tilt') || '.cs-card',
        { amplitude: num(tilts[t].getAttribute('data-rb-tilt-amplitude'), 8) }
      ));
    }

    // GlareHover 是纯 CSS，这里只把类名挂上去
    markGlare();
  }

  var api = {
    spotlight: spotlight,
    magnet: magnet,
    tilt: tilt,
    enter: enter,
    auto: auto,
    /** 卡片重建后重新挂 GlareHover 用（聚光与磁吸是委托，不需要重挂） */
    refreshGlare: markGlare,
    /** 报告卡分批入场：app.js 在 metricsGrid 重建后调用 */
    enterMetrics: function (box) {
      return enter(box, { selector: '.metric', distance: 18, stagger: 0.055 });
    },
    disposeAll: function () {
      disposers.forEach(function (fn) { if (typeof fn === 'function') fn(); });
      disposers = [];
    },
    reducedMotion: function () { return REDUCE; },
    /** 仅供 tests/rb-fx.test.js 锁住默认值、夹取与坐标反推，业务代码不要用 */
    __internals: { num: num, clamp: clamp, localPoint: localPoint }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto);
  } else {
    auto();
  }

  if (root) root.jtqRbFx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
