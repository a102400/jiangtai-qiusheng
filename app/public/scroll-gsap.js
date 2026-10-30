/* ============================================================
   讲台求生 · 滚动编排 scroll-gsap.js（GSAP 3.13 + ScrollTrigger）
   ------------------------------------------------------------
   GSAP 的定位：只做现有 motion.js 做不到的「滚动驱动」，
   不去抢 motion.js 已经用 IntersectionObserver 管好的入场动画
   （那套是 .is-in + CSS transition，两边同时动会打架）。

   本文件只负责三件事：
     1. 顶部阅读进度条（独立 fixed 元素，零布局侵入）；
     2. 区块标题的字距收拢（只动 letter-spacing / opacity，不碰 transform）；
     3. 锚点平滑滚动（用 GSAP 的时长曲线，比原生 smooth 更可控）。

   降级：vendor 文件缺失时直接 return，页面照常可用；
        prefers-reduced-motion 下只保留进度条，不做任何位移动画。
   ============================================================ */

(function initScrollGsap() {
  'use strict';

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;

  // 任一未加载就整体跳过 —— 静态资源被拦、旧缓存都会走到这里
  if (!gsap || !ScrollTrigger) return;

  try {
    gsap.registerPlugin(ScrollTrigger);
  } catch (e) {
    return;
  }

  var reduce = false;
  try {
    reduce = !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* 按允许动效处理 */ }

  /* ---------- 1. 顶部阅读进度条 ---------- */
  function mountProgress() {
    var bar = document.createElement('div');
    bar.className = 'rb-scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    gsap.set(bar, { scaleX: 0, transformOrigin: 'left center' });
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: document.documentElement,
        start: 'top top',
        end: 'bottom bottom',
        scrub: reduce ? true : 0.3
      }
    });
  }

  /* ---------- 2. 区块标题字距收拢 ---------- */
  /* 只动 letter-spacing 与 opacity：这两个属性不与 .is-in 的
     transform / translate 叠加，因此和 motion.js 并存不会互相覆盖。 */
  function mountTitles() {
    if (reduce) return;
    var titles = document.querySelectorAll('.panel-title');
    Array.prototype.forEach.call(titles, function (el) {
      gsap.fromTo(el,
        { letterSpacing: '0.10em', opacity: 0.45 },
        {
          letterSpacing: '0em',
          opacity: 1,
          duration: 0.85,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true }
        }
      );
    });
  }

  /* ---------- 3. 锚点平滑滚动 ---------- */
  function mountAnchors() {
    if (reduce) return;
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest('a[href^="#"]')
        : null;
      if (!link) return;

      var id = link.getAttribute('href');
      if (!id || id === '#') return;

      var target = document.querySelector(id);
      if (!target) return;

      event.preventDefault();
      var top = target.getBoundingClientRect().top + window.pageYOffset - 12;

      // ScrollToPlugin 不在 vendor 里（为一条平滑滚动多引 22KB 不划算），
      // 用 tween 一个数值对象 + window.scrollTo 走出同一条曲线。
      var state = { v: window.pageYOffset };
      gsap.to(state, {
        v: top,
        duration: 0.7,
        ease: 'power2.inOut',
        overwrite: true,
        onUpdate: function () { window.scrollTo(0, state.v); }
      });
    });
  }

  function boot() {
    mountProgress();
    mountTitles();
    mountAnchors();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 报告区是异步渲染的，新出现的标题也要接上
  document.addEventListener('jtq:tabchange', function () {
    try { ScrollTrigger.refresh(); } catch (e) { /* 忽略 */ }
  });
})();
