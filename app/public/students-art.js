/**
 * 学生立绘资源加载器（零依赖）
 *
 * 三个学生角色使用 SVG 矢量立绘，透明背景，来自用户提供的「保色哑光纸感版」素材。
 * 单独成文件的原因：
 *   1. app.js 已经 260KB，立绘加载与绘制解耦，便于单独测试；
 *   2. 离线单文件版需要把 SVG 转成 data URI 内联，通过 window.JTQ_STUDENT_SRC
 *      覆盖路径即可，不用改 app.js 里的绘制逻辑。
 *
 * 每个角色有三种状态（default 张嘴 / closed 闭嘴 / raise 举手），
 * 由 scripts/build-student-assets.js 从 portraits/ 下的母版生成。
 *
 * 降级：任何一张加载失败 → 该角色的 get() 返回 null，
 *       调用方（app.js 的 drawClassStudent）退回代码手绘的简笔小人，
 *       课堂场景不会因为图片加载失败而空掉。
 */
(function initStudentArt() {
  'use strict';

  // 状态名 → 中文，供 UI 提示用
  var STATES = ['default', 'closed', 'raise', 'speak-raise', 'idle-down'];

  /*
   * 角色 → 状态 → SVG 路径。
   * 默认走相对路径；离线版构建时会先注入 JTQ_STUDENT_SRC（data URI）覆盖。
   *
   * 状态语义（嘴 / 手臂 / 头）：
   *   default     张嘴 · 手臂放下 · 头正常
   *   closed      闭嘴 · 手臂放下 · 头正常
   *   raise       闭嘴 · 举起手   · 头正常
   *   speak-raise 张嘴 · 举起手  · 头正常
   *   idle-down   闭嘴 · 手臂放下 · 头下倾 + 眯眼
   */
  var SRC = {
    naughty: {
      default: 'assets/students/svg/naughty-default.svg',
      closed: 'assets/students/svg/naughty-closed.svg',
      raise: 'assets/students/svg/naughty-raise.svg',
      'speak-raise': 'assets/students/svg/naughty-speak-raise.svg',
      'idle-down': 'assets/students/svg/naughty-idle-down.svg',
    },
    geek: {
      default: 'assets/students/svg/geek-default.svg',
      closed: 'assets/students/svg/geek-closed.svg',
      raise: 'assets/students/svg/geek-raise.svg',
      'speak-raise': 'assets/students/svg/geek-speak-raise.svg',
      'idle-down': 'assets/students/svg/geek-idle-down.svg',
    },
    drift: {
      default: 'assets/students/svg/drift-default.svg',
      closed: 'assets/students/svg/drift-closed.svg',
      raise: 'assets/students/svg/drift-raise.svg',
      'speak-raise': 'assets/students/svg/drift-speak-raise.svg',
      'idle-down': 'assets/students/svg/drift-idle-down.svg',
    },
  };

  /*
   * 内容包围盒（相对 viewBox 的比例，实测得到）。
   *
   * 为什么需要它：三张素材的留白差别很大 —— 黄色角色的人物只占画布
   * 58% x 67%，男学生占 90% x 90%。如果直接按 viewBox 缩放，
   * 黄色角色会比另外两个小一截、且整体偏下。
   * 绘制时按这里的矩形裁源图，三个人物才是等高的。
   *
   * 关键：同一角色的三种状态必须共用同一个裁切矩形。
   * 举起手时人物会向上向右伸展，如果每个状态各用各的包围盒，
   * 切换状态时人物会「跳动」（脸的位置漂移）。所以这里取
   * 三状态包围盒的并集 —— 人物在切换时纹丝不动，只有手臂在动。
   *
   * 数据来源：scripts/measure-student-bbox.py（Inkscape 栅格化后逐像素扫 alpha>8），
   * 2026-10-30 实测。
   */
  var CROP = {
    naughty: { x: 0.0817, y: 0.0987, w: 0.8067, h: 0.9013 },
    geek:    { x: 0.0452, y: 0.0988, w: 0.8984, h: 0.9012 },
    drift:   { x: 0.2100, y: 0.2068, w: 0.6083, h: 0.6743 },
  };

  // 原始 viewBox 尺寸。烘焙时必须显式给这个尺寸：
  // 只有 viewBox、没有 width/height 的 SVG，img.naturalWidth 会返回 0，
  // 一旦用 naturalWidth 算源矩形，drawImage 就什么也画不出来（踩过）。
  var VIEW = {
    naughty: [600, 760],
    geek: [620, 800],
    drift: [600, 740],
  };

  // 内容宽高比 = (w * viewBox 宽) / (h * viewBox 高)，按同样口径实测
  var RATIO = {
    naughty: (0.8067 * 600) / (0.9013 * 760),   // 484 / 685  ≈ 0.707
    geek: (0.8984 * 620) / (0.9012 * 800),     // 557 / 721  ≈ 0.773
    drift: (0.6083 * 600) / (0.6743 * 740),    // 365 / 499  ≈ 0.732
  };

  // 烘焙倍率：按 2 倍栅格化，dpr=2 的屏幕上不糊
  var BAKE_SCALE = 2;

  /**
   * 把 SVG 按内容包围盒裁成一个紧贴人物的位图（离屏 canvas）。
   * 这样做有三个好处：
   *   1. 不依赖 img 的固有尺寸（SVG 的 naturalWidth 不可靠）；
   *   2. 每帧绘制退化成 4 参数 drawImage，比 9 参数裁源快；
   *   3. 三个人物天然等高 —— 源矩形已经是内容边界。
   */
  function bake(img, key) {
    var vb = VIEW[key] || [600, 800];
    var crop = CROP[key] || { x: 0, y: 0, w: 1, h: 1 };
    var S = BAKE_SCALE;

    var full = document.createElement('canvas');
    full.width = Math.round(vb[0] * S);
    full.height = Math.round(vb[1] * S);
    var fctx = full.getContext('2d');
    if (!fctx) return null;
    fctx.drawImage(img, 0, 0, full.width, full.height);

    var sx = Math.round(crop.x * full.width);
    var sy = Math.round(crop.y * full.height);
    var sw = Math.round(crop.w * full.width);
    var sh = Math.round(crop.h * full.height);
    if (sw < 1 || sh < 1) return null;

    var out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    var octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  }

  var override = window.JTQ_STUDENT_SRC;
  if (override && typeof override === 'object') {
    for (var ok in override) {
      if (!Object.prototype.hasOwnProperty.call(SRC, ok)) continue;
      if (!override[ok]) continue;
      // 覆盖值可以是「状态 → data URI」的对象，也可以是单个字符串（全部状态共用）
      if (typeof override[ok] === 'string') {
        for (var st = 0; st < STATES.length; st++) SRC[ok][STATES[st]] = override[ok];
      } else {
        for (var st2 = 0; st2 < STATES.length; st2++) {
          if (override[ok][STATES[st2]]) SRC[ok][STATES[st2]] = override[ok][STATES[st2]];
        }
      }
    }
  }

  // images[key][state] = 烘焙后的位图
  var images = {};
  var state = {};        // key+':'+state -> 'loading' | 'ready' | 'error'
  var listeners = [];
  var pending = 0;
  var settled = false;

  function ratioOf(key) {
    return RATIO[key] || 0.78;
  }

  function cropOf(key) {
    return CROP[key] || { x: 0, y: 0, w: 1, h: 1 };
  }

  function notify() {
    if (pending > 0) return;
    settled = true;
    var list = listeners.slice();
    listeners.length = 0;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](images);
      } catch (e) {
        if (window.console && window.console.warn) window.console.warn('[jtqStudentArt] 回调异常', e);
      }
    }
  }

  function onReady(fn) {
    if (typeof fn !== 'function') return;
    if (settled) {
      fn(images);
      return;
    }
    listeners.push(fn);
  }

  /**
   * 取某个角色某个状态的位图。
   * state 非法或该状态加载失败时，逐级回退：
   * 同角色的 default → 任意一个已就绪的状态 → null。
   */
  function get(key, stateName) {
    var byState = images[key];
    if (!byState) return null;
    var want = stateName || 'default';
    if (byState[want]) return byState[want];
    if (byState.default) return byState.default;
    var names = Object.keys(byState);
    if (names.length) return byState[names[0]];
    return null;
  }

  /** 某角色的某个状态是否已就绪（用于判断能否切状态） */
  function has(key, stateName) {
    return !!(images[key] && images[key][stateName || 'default']);
  }

  /**
   * 取某角色某状态的资源地址，给 <img> 用（学生卡头像、首屏课堂片段）。
   *
   * 为什么不直接让调用方拼立绘的磁盘相对路径：
   *   1. 离线单文件版会把 SRC 覆盖成 data URI，写死路径的 <img> 在 file:// 下必然破图；
   *   2. build-standalone.js 末尾会断言产物里不许再出现立绘目录前缀，
   *      HTML 里写死路径会直接把构建卡住。
   * 所以「路径长什么样」这件事只允许 SRC 一个来源。
   */
  function srcOf(key, stateName) {
    var byState = SRC[key];
    if (!byState) return '';
    var want = stateName || 'default';
    return byState[want] || byState['default'] || '';
  }

  function loadOne(key, stateName) {
    var src = SRC[key] && SRC[key][stateName];
    if (!src) return;
    var tag = key + ':' + stateName;
    state[tag] = 'loading';
    pending += 1;

    // 用 createElementNS 走 DOM 而不是 new Image()：
    // 离线版以 file:// 打开时 new Image() 加载 data URI 同样可用，
    // 但 img 元素能保留 crossOrigin 默认同源语义，避免某些内核把 data URI 判为跨域画布污染。
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onload = function () {
      var baked = null;
      try {
        baked = bake(img, key);
      } catch (e) {
        if (window.console && window.console.warn) window.console.warn('[jtqStudentArt] 烘焙失败：' + tag, e);
      }
      if (baked) {
        if (!images[key]) images[key] = {};
        images[key][stateName] = baked;
        state[tag] = 'ready';
      } else {
        // 烘焙不可用（极旧内核）→ 退回原图，绘制端会按整图缩放
        if (!images[key]) images[key] = {};
        images[key][stateName] = img;
        state[tag] = 'ready';
        state[tag + ':raw'] = true;
      }
      pending -= 1;
      notify();
    };
    img.onerror = function () {
      state[tag] = 'error';
      pending -= 1;
      if (window.console && window.console.warn) {
        window.console.warn('[jtqStudentArt] 立绘加载失败，退回简笔小人：' + tag);
      }
      notify();
    };
    img.src = src;
  }

  function init() {
    for (var key in SRC) {
      if (!Object.prototype.hasOwnProperty.call(SRC, key)) continue;
      for (var i = 0; i < STATES.length; i++) {
        loadOne(key, STATES[i]);
      }
    }
    if (pending === 0) settled = true;
  }

  window.jtqStudentArt = {
    get: get,
    has: has,
    srcOf: srcOf,
    ratioOf: ratioOf,
    cropOf: cropOf,
    onReady: onReady,
    states: function () {
      return STATES.slice();
    },
    keys: function () {
      return Object.keys(SRC);
    },
    /** 测试用：不触发真实网络，直接注入已就绪的图片对象 */
    __inject: function (key, img, stateName) {
      if (!images[key]) images[key] = {};
      images[key][stateName || 'default'] = img;
      state[key + ':' + (stateName || 'default')] = 'ready';
    },
  };

  init();
})();
