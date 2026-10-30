/* ============================================================
   讲台求生 · 结论句模糊渐入 blurtext.js（零依赖）
   ------------------------------------------------------------
   搬运来源：React Bits 的 BlurText（registry: BlurText-JS-CSS）。
   模板里 blur 效果的原始参数（一个字都没改）：

     · stepDuration 0.35s × (3 个关键帧 - 1) = 总时长 0.7s
     · blur 10px、distance 50px、direction 'top'
     · 三个关键帧：blur(10) opacity 0 y+50 → blur(5) opacity .5 y-5 → blur(0) opacity 1 y0
     · times [0, .5, 1]，这一档的 fade 是 linear（模板注释里唯一用 linear 的效果）
     · 每个片段错峰 200ms（delay 默认值）

   唯一为中文改的两处（不改会直接不能用）：
     1. 模板按 `text.split(' ')` 分词 —— 中文整句没有空格，会变成「一整块」
        一起糊进来，等于没做。这里改成按字拆（模板本身也有 animateBy="char" 这个档），
        并把句读标点粘在前一个字上，避免句号单独换行。
     2. 字级错峰按片段数压缩：stagger = min(200ms, 1000ms / (片段数-1))。
        40 个字的句子若还用 200ms，最后一位要等 8 秒才出现。

   安全设计：
     · 不包 JS 就不拆（mount 由业务显式调用，不自动扫描）
     · 减少动效（prefers-reduced-motion: reduce）直接 return，文字原样可读
     · 拆完后 textContent 与原文完全一致，再挂一份 .sr-only 给读屏
   ============================================================ */
(function () {
  'use strict';

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var DELAY = 200;          // ms，模板 delay 默认值
  var STEP = 350;           // ms，模板 stepDuration 默认值
  var STEPS = 2;            // blur 档 3 个关键帧 → 2 段
  var DURATION = STEP * STEPS; // 700ms

  /* 句读标点：粘到前一个字上，避免「，」「。」单独成片、被挤到行首 */
  var PUNCT = '，。；：、！？…—,.!?;:';

  function piecesOf(text) {
    var chars = Array.from(text);
    var out = [];
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      /* 空格单独成片时必须换成不换行空格：inline-block 里放一个普通空格，
         宽度会被折叠成 0，「AI 试讲教练」会挤成「AI试讲教练」。 */
      if (ch === ' ') { out.push('\u00A0'); continue; }
      if (PUNCT.indexOf(ch) !== -1 && out.length) {
        out[out.length - 1] += ch;     // 标点跟上一个字走
        continue;
      }
      out.push(ch);
    }
    // 全是标点开头的病态情况：并进下一片，别留一个孤零零的标点
    var merged = [];
    for (i = 0; i < out.length; i++) {
      if (merged.length === 0 && out[i].length === 1 && PUNCT.indexOf(out[i]) !== -1 && i + 1 < out.length) {
        out[i + 1] = out[i] + out[i + 1];
        continue;
      }
      merged.push(out[i]);
    }
    return merged;
  }

  function mount(el, opts) {
    if (!el || reduce) return false;
    opts = opts || {};
    var prev = el.getAttribute('data-bt-text');
    var hasPieces = !!el.querySelector('.bt-piece');
    /* 已经拆过时不能再读 textContent：拆完之后它 = .sr-only + 所有片段 = 两遍原文。
       所以优先读 data-bt-text（真正的那一份），只有被业务重写过（片段消失）才读 textContent。 */
    var text = hasPieces && prev !== null
      ? prev
      : String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    // 同一段文字已经拆过 → 不重播（切 tab / 恢复历史都会再调一次）
    if (hasPieces && prev === text) return false;

    var pieces = piecesOf(text);
    if (pieces.length < 2) return false;

    /* 错峰压缩：片段多时把 200ms 压到 1 秒总错峰以内 */
    var stagger = pieces.length > 1
      ? Math.min(DELAY, Math.round(1000 / (pieces.length - 1)))
      : DELAY;

    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;

    el.textContent = '';
    el.appendChild(sr);

    var frag = document.createDocumentFragment ? document.createDocumentFragment() : null;
    for (var i = 0; i < pieces.length; i++) {
      var s = document.createElement('span');
      s.className = 'bt-piece';
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--i', String(i));
      s.style.setProperty('--bt-stagger', stagger + 'ms');
      s.textContent = pieces[i];
      if (frag) frag.appendChild(s);
      else el.appendChild(s);
    }
    if (frag) el.appendChild(frag);

    el.setAttribute('data-bt-text', text);
    el.classList.add('is-blurtext');

    var last = el.querySelectorAll('.bt-piece');
    if (last.length && last[last.length - 1].addEventListener) {
      last[last.length - 1].addEventListener('animationend', function () {
        el.classList.add('is-bt-settled');   // 落位后清掉 will-change
      });
    }
    return true;
  }

  window.jtqBlurText = {
    mount: mount,
    piecesOf: piecesOf,
    debug: { DELAY: DELAY, STEP: STEP, DURATION: DURATION }
  };
})();
