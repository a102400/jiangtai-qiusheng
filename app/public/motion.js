/* ============================================================
   讲台求生 · 动效层 motion.js（零依赖）
   ------------------------------------------------------------
   做四件事：
     1. 给页面区块自动挂「滚动渐入」（不用手改几百处 HTML）
     2. 面板里有多张卡片时，下沉到卡片逐个渐入（报告区就是这种）
     3. 标题按视觉行拆分，从遮罩后升起
     4. 异步内容自动补挂（报告、追问、历史都是异步插进来的）

   安全设计（这几条决定它会不会帮倒忙）：
     · 脚本没跑 → html 上没有 .js 类 → 所有隐藏态都不生效，内容照常可见
     · 不可见（hidden / display:none）的元素不提前挂隐藏态，
       否则等它变可见时早就被标成 is-in，过渡永远不播
       —— 报告区初始就是 hidden，这是它一直不渐入的真正原因
     · 首屏区块不等待滚动，立即入场（本站不设加载屏）
     · 每个元素只播一次，播完 unobserve，不随滚动反复重播
     · prefers-reduced-motion: reduce → 整个脚本直接返回
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  if (!('IntersectionObserver' in window)) return;

  document.documentElement.classList.add('js');

  /* 参与渐入的区块：覆盖三个页面里实际用到的容器类 */
  var SEL = [
    '.card',
    'section',
    '.panel',
    '.rs-card',
    '.pano-card',
    '.hollow-card',
    '.if-trail-card',
    '.doomed-card',
    '.workspace-entry',
    '.hero-block'
  ].join(',');

  /* 卡片级：面板下沉后逐个挂载的就是这些 */
  var CARD_SEL = [
    '.card',
    '.rs-card',
    '.pano-card',
    '.hollow-card',
    '.if-trail-card',
    '.doomed-card',
    '.daily-card',
    '.poster-card'
  ].join(',');

  function isCard(el) {
    return !!(el.matches && el.matches(CARD_SEL));
  }

  function visible(el) {
    // hidden / display:none 时 getClientRects() 为空。这类元素必须等可见后再挂，
    // 否则扫到当刻就被判成「已在首屏」而直接 is-in。
    return !!(el.getClientRects && el.getClientRects().length);
  }

  /* el 内部「最外层可见卡片」：卡片套卡片时不重复挂 */
  function topCards(el) {
    var all = el.querySelectorAll(CARD_SEL);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (!visible(c)) continue;
      if (c.hasAttribute('data-reveal') || c.classList.contains('is-in')) continue;
      var p = c.parentElement, nested = false;
      while (p && p !== el) {
        if (isCard(p)) { nested = true; break; }
        p = p.parentElement;
      }
      if (!nested) out.push(c);
    }
    return out;
  }

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);          // 只播一次，不重播
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  /* 收集挂载点。两趟是有原因的：
     第一趟找「面板」——内部有 ≥2 张卡片的面板自己不动，改让卡片各自入场；
     第二趟只保留最外层，避免嵌套各自动画。 */
  /* el 内部是否已经有挂过 reveal 的卡片 —— 说明这一层早就下沉过了。
     没有这条判断的话，重复扫描时「卡片已挂载 → topCards 返回空 →
     面板被当成普通面板挂上隐藏态」，内容会二次闪一下。 */
  function hasMountedCard(el) {
    var all = el.querySelectorAll(CARD_SEL);
    for (var i = 0; i < all.length; i++) {
      if (all[i].hasAttribute('data-reveal')) return true;
    }
    return false;
  }

  function collect(root) {
    var scope = root || document;
    var all = scope.querySelectorAll(SEL);
    var vh = window.innerHeight;
    var downshift = [];     // 自己不挂、只作为容器的元素
    var cands = [];         // 真正的挂载点

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.hasAttribute('data-reveal') || el.classList.contains('is-in')) continue;
      if (!visible(el)) continue;

      if (isCard(el)) { cands.push(el); continue; }

      // 已下沉过的面板：永远不挂自己，交给内部卡片
      if (hasMountedCard(el)) { downshift.push(el); continue; }

      // 整页级 wrapper：自己淡入等于整页糊一下，改为下沉到内部卡片
      if (el.offsetHeight > vh * 1.6) {
        downshift.push(el);
        var deep = topCards(el);
        for (var d = 0; d < deep.length; d++) cands.push(deep[d]);
        continue;
      }

      var cards = topCards(el);
      if (cards.length >= 2) {
        downshift.push(el);               // 面板不整体淡入
        for (var c = 0; c < cards.length; c++) cands.push(cards[c]);
        continue;
      }
      cands.push(el);
    }

    var out = [];
    for (var k = 0; k < cands.length; k++) {
      var node = cands[k];
      if (out.indexOf(node) !== -1) continue;
      if (node.hasAttribute('data-reveal')) continue;
      // 祖先里若有「未被下沉的候选」，说明它会被那一层带走，自己不挂
      var p = node.parentElement, skip = false;
      while (p && p !== document.body) {
        if (cands.indexOf(p) !== -1 && downshift.indexOf(p) === -1) { skip = true; break; }
        p = p.parentElement;
      }
      if (skip) continue;
      out.push(node);
      if (out.length >= 48) break;        // 上限：一页最多 48 个
    }
    return out;
  }

  function scan(root) {
    var nodes = collect(root);
    if (!nodes.length) return 0;
    var vh = window.innerHeight;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      el.setAttribute('data-reveal', '');
      // 错峰：同批出现的元素依次晚 45ms，最多累计 8 档（=360ms），再多就一起出现
      el.style.setProperty('--rv', String(i < 8 ? i : 8));
      var top = el.getBoundingClientRect().top;
      if (top < vh * 0.92) {
        // 首屏（或已在视口内）：不排队等滚动，下一帧就位
        (function (node) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { node.classList.add('is-in'); });
          });
        })(el);
      } else {
        io.observe(el);
      }
    }
    return nodes.length;
  }

  /* ---------------- 标题按视觉行拆分 ---------------- */

  /* 用逐字符探针测出真正的换行位置，再包成 .line > span。
     中文标题按字符拆是唯一可靠的办法：按空格切会在纯中文标题上得到一整行，
     用 canvas measureText 又拿不到浏览器的实际断行。
     拆分后文本内容完全不变（只是加了 span），读屏与复制粘贴不受影响。 */
  function splitLines(el) {
    if (el.getAttribute('data-lines-split') === '1') return false;
    // 只拆纯文本标题：元素里如果已经有标签（比如 landing 的双语 .i18n-en/.i18n-zh），
    // textContent 会把两种语言拍平，语言切换直接失效。
    if (el.children.length) return false;
    var raw = el.getAttribute('data-lines-text');
    if (raw === null) {
      raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      el.setAttribute('data-lines-text', raw);
    }
    if (!raw || raw.length > 160) return false;   // 长文不拆，只拆标题

    var probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    var chars = [];
    for (var i = 0; i < raw.length; i++) {
      var s = document.createElement('span');
      s.textContent = raw.charAt(i);
      s.style.display = 'inline';
      probe.appendChild(s);
      chars.push(s);
    }
    el.textContent = '';
    el.appendChild(probe);

    // 按 getBoundingClientRect().top 分组：同一行内 top 差 < 2px
    var lines = [], lastTop = null, buf = '';
    for (i = 0; i < chars.length; i++) {
      var t = chars[i].getBoundingClientRect().top;
      if (lastTop === null || Math.abs(t - lastTop) < 2) {
        buf += raw.charAt(i);
      } else {
        lines.push(buf);
        buf = raw.charAt(i);
      }
      lastTop = t;
    }
    if (buf) lines.push(buf);

    el.textContent = '';
    for (i = 0; i < lines.length; i++) {
      var line = document.createElement('span');
      line.className = 'line';
      line.style.setProperty('--i', String(i));
      var inner = document.createElement('span');
      inner.textContent = lines[i];
      line.appendChild(inner);
      el.appendChild(line);
    }
    el.setAttribute('data-lines-split', '1');
    el.classList.add('is-split');

    // 必须隔一帧再加 is-in：同帧加上等于起始态和结束态同时成立，动画不会播
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('is-in'); });
    });
    return true;
  }

  function setupLines() {
    var els = document.querySelectorAll('[data-lines]:not([data-lines-split])');
    for (var i = 0; i < els.length; i++) {
      if (!visible(els[i])) continue;
      splitLines(els[i]);
    }
  }

  /* ---------------- 数字滚动 ---------------- */
  /* 已迁出：数字滚动曾经在这里实现过一版「每列滚到终值」的静态版，
     但从来没有页面标过 data-roll，等于死代码。现在由 countup.js 接手
     （React Bits CountUp 的原式搬运，含列行进量与动态模糊），
     本文件只负责「区块渐入 / 面板下沉 / 标题遮罩行」。 */

  setupLines();
  scan();

  /* ---------------- 异步内容补挂 ---------------- */
  /* 报告、追问、历史记录都是异步插进 DOM 的；此外报告区容器本身是 hidden，
     分析完成后才去掉 hidden —— 光监听子节点变化不够，必须同时盯属性变化。
     节流 260ms，避免一次渲染触发几十次扫描。 */
  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = window.setTimeout(function () {
      pending = 0;
      setupLines();
      scan();
    }, 260);
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          if (r.addedNodes && r.addedNodes.length) { schedule(); return; }
          continue;
        }
        // 属性变化：跳过我们自己加的那两个（否则会自触发循环）
        var t = r.target;
        if (!t || !t.hasAttribute) continue;
        if (t.hasAttribute('data-reveal') || t.getAttribute('data-lines-split') === '1') continue;
        // hidden 去掉 = 容器刚变可见；class 变化 = 切换 tab / 切换视图
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

  window.jtqMotion = {
    scan: function () { setupLines(); scan(); },
    collect: collect,
    splitLines: splitLines
  };
})();
