/* ============================================================
   对话消息入场编排 · 2026-10-29
   为什么用观察器而不是改业务代码：
     app.js 的 addBubble() 和 question-drill.js 的 appendMessage()
     是两套互不相干的渲染路径，各处历史恢复逻辑也不同。在这里挂一层
     观察器，业务文件一行都不用动，也不会影响错误回滚时的 remove()。

   编排规则（取自 React Bits AnimatedList 的 entrance / stagger 语义）：
     · 只对「观察开始之后新增」的节点播放入场，历史恢复不弹（打开就全弹是噪音）
     · 一次新增多条时按 50ms 递增错峰（AnimatedList stagger 默认 0.05）
     · 教师右进、学生上浮、系统提示淡入（commit 用 CSS 变量控制）
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;                       // 无障碍优先：不做任何入场编排

  if (typeof MutationObserver !== 'function') return;

  // 自己兜住 .js 类：motion.js 未加载时 CSS 的隐藏态不生效，这里的动画也只是不播
  if (!document.documentElement.classList.contains('js')) {
    document.documentElement.classList.add('js');
  }

  var ENTER_MS = 620;                       // 与 msg.css 的 transform 时长一致
  var STAGGER_MS = 50;                      // AnimatedList 默认 stagger = 0.05

  /* 只认这三个容器：对话消息、问答专项、AI 学生对话 */
  var TARGETS = ['#questionDrillConversation', '#chatLog'];

  /* 判断该从哪个方向进场，并把节点归一化成 { el, side } */
  function describe(node) {
    if (!node || node.nodeType !== 1) return null;
    var cls = node.className || '';

    // question-drill.js：.question-drill-message.teacher / .student / .system
    if (cls.indexOf('question-drill-message') !== -1) {
      if (cls.indexOf('teacher') !== -1) return { el: node, side: 'right' };
      if (cls.indexOf('system') !== -1) return { el: node, side: 'fade' };
      return { el: node, side: 'up', caret: true };
    }
    // app.js：.msg，教师消息带 .out
    if (/(^|\s)msg(\s|$)/.test(cls)) {
      if (cls.indexOf('out') !== -1) return { el: node, side: 'right' };
      if (cls.indexOf('sys') !== -1) return { el: node, side: 'fade' };
      return { el: node, side: 'up', caret: true };
    }
    return null;
  }

  /* 等指示器（.typing / .msg-typing）是占位符，不该播入场 —— 它自己会跳动 */
  function isPlaceholder(node) {
    var bub = node.querySelector ? node.querySelector('.typing, .msg-typing') : null;
    return !!bub;
  }

  function mount(item, delay) {
    var el = item.el;
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute('data-msg-enter')) return;

    el.setAttribute('data-msg-enter', '1');
    el.setAttribute('data-side', item.side);
    el.classList.add('msg-enter');
    // 入场期间打标记：fx.js 的拆台抖动据此延后，避免两个 transform 打架
    el.setAttribute('data-entering', '1');

    if (delay > 0) el.style.transitionDelay = delay + 'ms';

    // 必须隔一帧再加 .is-in：同帧设置起止态，浏览器不会播过渡
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('is-in');

        window.setTimeout(function () {
          el.removeAttribute('data-entering');
          el.style.transitionDelay = '';
          if (item.caret) addCaret(el);
        }, ENTER_MS + delay);
      });
    });
  }

  /* 光标尾随：只给模拟学生的「刚说完」用，不延迟任何文字 */
  function addCaret(el) {
    var host = el.querySelector ? el.querySelector('p, .bub') : null;
    if (!host || host.querySelector('.msg-caret')) return;
    var caret = document.createElement('span');
    caret.className = 'msg-caret';
    caret.setAttribute('aria-hidden', 'true');
    host.appendChild(caret);
    window.setTimeout(function () {
      if (caret.parentNode) caret.parentNode.removeChild(caret);
    }, 2100);                                // 0.5s × 4 次闪烁 + 余量
  }

  var pending = [];
  var flushTimer = 0;

  function flush() {
    flushTimer = 0;
    var list = pending;
    pending = [];
    for (var i = 0; i < list.length; i++) {
      mount(list[i], i * STAGGER_MS);
    }
  }

  function collect(records) {
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      if (rec.type !== 'childList' || !rec.addedNodes) continue;
      for (var n = 0; n < rec.addedNodes.length; n++) {
        var node = rec.addedNodes[n];
        if (!node || node.nodeType !== 1) continue;
        if (isPlaceholder(node)) continue;
        var item = describe(node);
        if (item) pending.push(item);
      }
    }
    if (pending.length && !flushTimer) {
      // 同一批 DOM 变更合并成一次，保证错峰序号是对的
      flushTimer = window.setTimeout(flush, 0);
    }
  }

  var observer = new MutationObserver(collect);
  var watched = [];                          // 已挂上观察的容器（去重，避免重复 observe）

  /* 候选容器里只有一个在静态 HTML 里（#chatLog）；
     #questionDrillConversation 是 question-drill.js 运行时创建的。
     所以不能「一次查全再决定」，必须一边挂一边补。 */
  function watch() {
    var missing = 0;
    for (var i = 0; i < TARGETS.length; i++) {
      var sel = TARGETS[i];
      var box = document.querySelector(sel);
      if (!box) { missing++; continue; }
      if (watched.indexOf(box) !== -1) continue;
      watched.push(box);
      observer.observe(box, { childList: true });
    }
    return missing;
  }

  /* 晚到的容器（专项练习面板、tab 切换后才挂载的区域）：
     临时在 body 上挂一层 subtree 观察，全部找到就立刻撤掉，不留常驻开销。
     再加一道超时兜底：页面若本就没有对话区（比如落地页），8 秒后自动撤，
     避免为了一个可能永不出现的容器一直扫全站 DOM。 */
  var lateObserver = null;
  var lateTimer = 0;
  var LATE_MS = 8000;

  function stopLate() {
    if (lateObserver) { lateObserver.disconnect(); lateObserver = null; }
    if (lateTimer) { window.clearTimeout(lateTimer); lateTimer = 0; }
  }

  function watchLate() {
    if (watch() === 0) { stopLate(); return; }
    if (lateObserver) return;
    if (!document.body) return;
    lateObserver = new MutationObserver(function () { watchLate(); });
    lateObserver.observe(document.body, { childList: true, subtree: true });
    lateTimer = window.setTimeout(stopLate, LATE_MS);
  }

  watchLate();

  window.jtqMsg = {
    describe: describe,
    mount: mount,
    watch: watchLate,
    ENTER_MS: ENTER_MS,
    STAGGER_MS: STAGGER_MS
  };
})();
