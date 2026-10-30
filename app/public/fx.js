/* 讲台求生 · 轻量特效层（零依赖 / 60fps 护栏）
 *
 * 三件事，都只做视觉，不碰业务逻辑：
 *   1. 粉笔灰粒子：全屏 canvas，缓慢上浮，鼠标轻微视差
 *   2. 背景极光：随滚动轻微位移的 radial-gradient 层
 *   3. 卡片 3D 倾斜：鼠标在卡片上移动时最多 4.5°，离开回正
 *
 * 硬约束：
 *   - 不引入任何第三方库（项目零依赖铁律）
 *   - prefers-reduced-motion: reduce 时整体不启用
 *   - 页面隐藏时停帧；掉帧自动降级到 12 粒 → 仍掉帧则彻底关闭
 *   - 不覆盖卡片已有的 transform（本项目的 .card 没有 hover 位移，安全）
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  var canHover = !window.matchMedia || window.matchMedia('(pointer: fine)').matches;

  /* ---------- 1. 背景极光 ---------- */
  var aurora = document.createElement('div');
  aurora.id = 'fxAurora';
  aurora.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(aurora, document.body.firstChild);

  /* ---------- 2. 粉笔灰粒子 ---------- */
  var canvas = document.createElement('canvas');
  canvas.id = 'fxCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, aurora.nextSibling);

  var ctx = canvas.getContext('2d', { alpha: true });
  var W = 0, H = 0, dpr = 1;
  var particles = [];
  var TINTS = ['79,70,229', '13,148,136', '59,130,246']; // 靛蓝 / 青 / 天蓝
  var TARGET = 0;      // 目标粒子数（掉帧会下调）
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  /* ---------- 2b. 拆台爆散（按需触发，不常驻） ---------- */
  var sparks = [];                 // 一次爆散最多 ~28 个，寿命 700ms
  var flashEl = null;              // 全屏红闪层，懒创建
  var flashT = 0;                  // 0~1 的衰减进度

  function spawnBurst(x, y) {
    var n = 28;
    for (var i = 0; i < n; i++) {
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var sp = 1.6 + Math.random() * 3.4;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.8,   // 整体略向上，像粉笔灰被拍起来
        life: 1,
        decay: 0.012 + Math.random() * 0.012,
        r: 1 + Math.random() * 2.2,
        tint: i % 3 === 0 ? '220,38,38' : (i % 3 === 1 ? '180,83,9' : '79,70,229')
      });
    }
    triggerFlash();
  }

  function triggerFlash() {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'fxFlash';
      flashEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(flashEl);
    }
    flashT = 1;
    flashEl.style.opacity = '0.55';
  }

  function stepFlash() {
    if (!flashEl || flashT <= 0) return;
    flashT -= 0.055;                              // ≈ 18 帧 ≈ 300ms 衰减
    if (flashT <= 0) {
      flashT = 0;
      flashEl.style.opacity = '0';
      return;
    }
    flashEl.style.opacity = (flashT * 0.55).toFixed(3);
  }

  /* 只抖被点名的那条消息，不抖 body —— 抖 body 会让所有 fixed 元素错位 */
  function shakeEl(el) {
    if (!el || !el.classList) return;
    // 消息还在入场（msg.js 打了 data-entering）时先让路：
    // 入场用 transition 改 transform，抖动用 animation 改 transform，
    // 同时跑会互相覆盖，结果是「既不弹也不抖」。等入场收尾再抖。
    if (el.getAttribute && el.getAttribute('data-entering') === '1') {
      setTimeout(function () { shakeEl(el); }, 660);
      return;
    }
    el.classList.remove('fx-strike-shake');
    void el.offsetWidth;                 // 强制重排，让动画能重播
    el.classList.add('fx-strike-shake');
    setTimeout(function () { el.classList.remove('fx-strike-shake'); }, 620);
  }

  function onStudentStrike(e) {
    if (dead) return;
    var el = e && e.detail && e.detail.el;
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var cx = r && r.width ? r.left + r.width / 2 : W / 2;
    var cy = r && r.height ? r.top + r.height / 2 : H / 2;
    shakeEl(el);
    spawnBurst(cx, cy);
  }

  function particleCount(w, h) {
    // 面积越大越多，但上限 110：一屏超过这个量就开始像"下雪"，不像粉笔灰
    // 密度取 1/13000（原 1/26000）：浅蓝底 #DBEAFE 上太稀会完全看不出来
    var n = Math.round((w * h) / 13000);
    return Math.max(40, Math.min(110, n));
  }

  function seed(n) {
    particles = [];
    for (var i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        /* 深度 0.25（远）~ 1（近）。加了这一维，粒子才有前后层次：
           半径、亮度、飘速、视差幅度全部按 z 缩放 —— 不引 Three.js 也能
           做出「有空间」的错觉；没有 z 的话 110 个点全在一个平面上，
           看起来反而比 40 个更平。 */
        z: 0.25 + Math.random() * 0.75,
        r: 0.7 + Math.random() * 2.0,
        vx: (Math.random() - 0.5) * 0.16,
        vy: -0.06 - Math.random() * 0.22,          // 一律向上飘，像粉笔灰
        a: 0.20 + Math.random() * 0.26,            // 0.20~0.46：浅色背景上必须够亮才看得见
        tint: TINTS[i % TINTS.length]
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); // 高分屏封顶 2 倍，3 倍屏不采样
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.min(TARGET || particleCount(W, H), particleCount(W, H));
    TARGET = n;
    seed(n);
  }

  /* ---------- 3. 卡片 3D 倾斜 ---------- */
  var TILT_SEL = '.card, .pano-card, .rs-card, .hollow-card, .doomed-card, .if-trail-card';
  var MAX_DEG = 6.5;
  var tiltEl = null, curRX = 0, curRY = 0, tgtRX = 0, tgtRY = 0;

  function onPointerMove(e) {
    if (!canHover) return;
    var el = e.target && e.target.closest ? e.target.closest(TILT_SEL) : null;
    if (el !== tiltEl) {
      resetTilt();
      tiltEl = el;
      if (el) el.style.willChange = 'transform';
    }
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 ~ 0.5
    var py = (e.clientY - r.top) / r.height - 0.5;
    tgtRY = px * MAX_DEG * 2;
    tgtRX = -py * MAX_DEG * 2;
  }

  function resetTilt() {
    tgtRX = 0;
    tgtRY = 0;
  }

  function onPointerOut(e) {
    if (tiltEl && (!e.relatedTarget || !tiltEl.contains(e.relatedTarget))) resetTilt();
  }

  function applyTilt() {
    if (!tiltEl) return;
    curRX += (tgtRX - curRX) * 0.18;
    curRY += (tgtRY - curRY) * 0.18;
    var settled = Math.abs(curRX) < 0.02 && Math.abs(curRY) < 0.02 && tgtRX === 0 && tgtRY === 0;
    if (settled) {
      tiltEl.style.transform = '';
      tiltEl.style.willChange = '';
      tiltEl = null;
      curRX = curRY = 0;
      return;
    }
    tiltEl.style.transform =
      'perspective(900px) rotateX(' + curRX.toFixed(2) + 'deg) rotateY(' + curRY.toFixed(2) + 'deg)';
  }

  /* ---------- 主循环（粒子 + 滚动视差 + 倾斜，共用一条 rAF） ---------- */
  var rafId = 0;
  var lastT = 0;
  var slowFrames = 0;
  var dead = false;
  var scrollS = 0;          // 平滑后的滚动量，粒子视差用

  function frame(t) {
    if (dead) return;
    rafId = requestAnimationFrame(frame);

    var dt = lastT ? t - lastT : 16;
    lastT = t;

    /* 掉帧护栏：连续 90 帧平均超过 26ms（≈38fps）就降级 */
    if (dt > 0 && dt < 200) {
      if (dt > 26) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 90) {
        slowFrames = 0;
        if (particles.length > 12) {
          seed(12);                       // 第一档降级：留一点空气感
        } else {
          dead = true;                    // 第二档：彻底关掉，让位给业务
          cancelAnimationFrame(rafId);
          canvas.style.display = 'none';
          aurora.style.display = 'none';
          return;
        }
      }
    }

    /* 背景极光随滚动位移（transform 走 GPU，不触发重排）；
       叠一层缓慢呼吸的 opacity —— 页面不滚动时也能看出背景在动，
       否则用户只会觉得「静态页面什么都没发生」。 */
    var sy = window.scrollY || window.pageYOffset || 0;
    aurora.style.transform = 'translate3d(0,' + (-sy * 0.06).toFixed(1) + 'px,0)';
    aurora.style.opacity = (0.80 + Math.sin(t / 2600) * 0.20).toFixed(3);

    /* 粒子场：逐粒做深度视差。
       每颗粒子按自身 z 缩放半径 / 亮度 / 飘速，再叠加鼠标（左右、上下）
       与滚动（上下）两个方向的位移 —— 远近不同的点移动幅度不同，
       眼睛读出来就是「有纵深」，而不是「一层贴纸在平移」。 */
    ctx.clearRect(0, 0, W, H);
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    scrollS += (sy - scrollS) * 0.10;              // 平滑滚动，避免紧跟页面抖
    var span = H + 56;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var speed = 0.35 + p.z;                      // 近处飘得快，远处几乎悬停
      p.x += p.vx * speed;
      p.y += p.vy * speed;
      if (p.y < -20) { p.y = H + 20; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8;
      if (p.x > W + 8) p.x = -8;

      var ox = p.x + mouse.x * 36 * p.z;
      var oy = p.y + mouse.y * 22 * p.z + scrollS * 0.07 * p.z;
      // 滚出屏幕后从另一侧接回，否则长页面滚两屏粒子就全跑光了
      oy = ((oy + 28) % span + span) % span - 28;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + p.tint + ',' + (p.a * (0.55 + p.z * 0.55)).toFixed(3) + ')';
      ctx.arc(ox, oy, p.r * (0.5 + p.z * 1.15), 0, 6.2832);
      ctx.fill();
    }

    /* 拆台爆散：只在事件触发后短暂存在，平时 sparks 为空、不产生开销 */
    for (var s = sparks.length - 1; s >= 0; s--) {
      var k = sparks[s];
      k.x += k.vx;
      k.y += k.vy;
      k.vx *= 0.97;
      k.vy = k.vy * 0.97 + 0.06;              // 轻微下坠，别飞成烟花
      k.life -= k.decay;
      if (k.life <= 0) { sparks.splice(s, 1); continue; }
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + k.tint + ',' + (k.life * 0.85).toFixed(3) + ')';
      ctx.arc(k.x, k.y, k.r * k.life, 0, 6.2832);
      ctx.fill();
    }
    stepFlash();

    applyTilt();
  }

  function start() {
    if (dead || rafId) return;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    sparks.length = 0;                       // 后台不留残余粒子，回前台重新开始
    if (flashEl) { flashT = 0; flashEl.style.opacity = '0'; }
  }

  /* ---------- 事件绑定 ---------- */
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 200);
  }, { passive: true });

  window.addEventListener('pointermove', function (e) {
    mouse.tx = (e.clientX / (W || 1)) - 0.5;
    mouse.ty = (e.clientY / (H || 1)) - 0.5;
    onPointerMove(e);
  }, { passive: true });

  window.addEventListener('pointerout', onPointerOut, { passive: true });
  window.addEventListener('scroll', function () { /* 位移在主循环里算，这里只保持 passive */ }, { passive: true });

  /* 业务侧只发一个自定义事件，特效实现全部留在这里：
     question-drill.js → document.dispatchEvent(new CustomEvent('jtq:student-strike', { detail: { el } })) */
  document.addEventListener('jtq:student-strike', onStudentStrike);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  /* 页面切走（bfcache）时彻底停帧 */
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);

  resize();
  start();
})();
