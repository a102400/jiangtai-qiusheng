'use strict';

/* ==================================================================
 * 课堂学生名册与学情数值规整（纯函数，无 DOM 依赖）
 * ----------------------------------------------------------------
 * 这个文件只做两件事：
 *   1. 判定一个 key 是不是合法学生角色；
 *   2. 把后端返回的学情数值（attention / comprehension）规整成
 *      「0–100 的整数」或「null（未提供）」。
 *
 * 为什么单独成文件：这两处判断都踩过真实故障，必须能被 node:test
 * 直接锁住，而 app.js 依赖 DOM、无法 require（同 students-art.js 的处理）。
 *
 * 两条被修掉的旧写法（不要退回去）：
 *   - `CLASS_META[key] || CLASS_META.naughty`：对象字面量查询会命中原型链，
 *     key='constructor' 拿到构造函数（truthy），随后 m.avatar 是 undefined，
 *     卡片上直接渲染出字符串 "undefined"。
 *   - `Number(v) || 0`：'   ' / [] / {} 都能转成 0，于是「后端没给数据」
 *     被画成「专注度 0 分」的红色告警条 —— 这是把缺失伪装成结论。
 *
 * 边界：本文件不做任何教学效果推断。分数为 null 时，调用方必须显示
 * 「未提供」，不能填 0，也不能猜。
 */

(function initClassRoster(root) {
  'use strict';

  var CLASS_META = {
    naughty: { name: '小皮', avatar: '😈', desc: '调皮型' },
    geek: { name: '小霸', avatar: '🤓', desc: '学霸型' },
    drift: { name: '小走', avatar: '😵', desc: '走神型' },
  };

  var KEYS = ['naughty', 'geek', 'drift'];

  /** 未提供分数时统一的灰，和 stateColor 的三档语义色区分开 */
  var UNKNOWN_COLOR = '#94A3B8';

  function hasKey(value) {
    return typeof value === 'string' &&
      Object.prototype.hasOwnProperty.call(CLASS_META, value);
  }

  function scoreOf(value) {
    var n;

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      n = value;
    } else if (typeof value === 'string') {
      // 空白串必须先挡掉：Number('   ') 是 0，会被误显示成「0 分」。
      if (!value.trim()) return null;
      n = Number(value);
      if (!Number.isFinite(n)) return null;
    } else {
      // 数组 / 对象 / 布尔 / undefined 一律不猜。
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function colorOf(value) {
    var n = scoreOf(value);
    if (n === null) return UNKNOWN_COLOR;
    if (n >= 70) return '#16a34a';
    if (n >= 45) return '#f59e0b';
    return '#dc2626';
  }

  /** 默认名册：后端还没返回状态时，先摆出三个「还没开口」的学生 */
  function idleRoster() {
    return KEYS.map(function (key) {
      return {
        key: key,
        name: CLASS_META[key].name,
        mood: '😊',
        hand_raise: false,
        speaking: false,
        attention: null,
        comprehension: null,
        state_reason: '',
      };
    });
  }

  /* ------------------------------------------------------------------
   * 3D/2D 场景站位与命中（纯几何，无 Canvas 依赖）
   * ----------------------------------------------------------------
   * 为什么需要它：画布上的学生位置原本只在 drawClassScene 里算一次，
   * 想做「点画布上的学生就点名」时，就得到处复制一份同样的坐标公式。
   * 两份公式一旦漂移，就会出现「看到的是小走，点下去点中小霸」——
   * 这种错位比不能点更糟。所以站位公式只留这一份，绘制和命中共用。
   * ------------------------------------------------------------------ */

  /**
   * 立绘尺寸：先按高度撑满，宽度超限再按宽度回退。
   * 保持与 drawClassStudent 完全相同的顺序，否则两边算出的框不一样大。
   */
  function figSize(maxW, maxH, ratio) {
    var r = (typeof ratio === 'number' && isFinite(ratio) && ratio > 0) ? ratio : 0.78;
    var h = maxH > 0 ? maxH : 0;
    var w = h * r;
    if (w > maxW) {
      w = maxW > 0 ? maxW : 0;
      h = r > 0 ? w / r : 0;
    }
    return { w: w, h: h };
  }

  /** 站位比例：1 人居中，2 人两侧，3 人三列。人数变了不重排会挤在左半边。 */
  function slotRatios(count) {
    if (count <= 1) return [0.5];
    if (count === 2) return [0.33, 0.67];
    return [0.25, 0.5, 0.75];
  }

  /**
   * 计算场景内每个学生的包围框。
   * @param {Array} items 学生数组（取前 3 个，允许有 null 项由调用方过滤后再传）
   * @param {number} W 画布 CSS 宽
   * @param {number} H 画布 CSS 高
   * @param {function} ratioOf key -> 立绘宽高比
   */
  function sceneLayout(items, W, H, ratioOf) {
    var list = Array.isArray(items) ? items.slice(0, 3) : [];
    var ratios = slotRatios(list.length);
    var maxH = H * 0.62;
    var maxW = W * 0.27;
    var baseY = H * 0.845;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var key = hasKey(item.key) ? item.key : '';
      var ratio = typeof ratioOf === 'function' ? ratioOf(key) : 0.78;
      var size = figSize(maxW, maxH, ratio);
      var cx = W * ratios[i];
      out.push({
        index: i,
        key: key,
        cx: cx,
        cy: baseY - size.h / 2,
        w: size.w,
        h: size.h,
        top: baseY - size.h,
        bottom: baseY,
        left: cx - size.w / 2,
        right: cx + size.w / 2,
      });
    }
    return out;
  }

  /**
   * 命中测试：点在哪个学生身上。
   * 点在两人之间的空白处必须返回 null —— 不能「就近吸附」，
   * 否则老师想点空白处收起面板，结果莫名其妙点了一个名。
   * pad 为手指容错（px），只向外扩，不会让两个框重叠判定。
   */
  function hitTest(slots, x, y, pad) {
    if (!Array.isArray(slots)) return null;
    var p = typeof pad === 'number' && isFinite(pad) && pad > 0 ? pad : 0;
    for (var i = slots.length - 1; i >= 0; i--) {
      var s = slots[i];
      if (!s) continue;
      if (x >= s.left - p && x <= s.right + p && y >= s.top - p && y <= s.bottom + p) return s;
    }
    return null;
  }

  var api = {
    CLASS_META: CLASS_META,
    KEYS: KEYS,
    UNKNOWN_COLOR: UNKNOWN_COLOR,
    hasKey: hasKey,
    scoreOf: scoreOf,
    colorOf: colorOf,
    idleRoster: idleRoster,
    figSize: figSize,
    slotRatios: slotRatios,
    sceneLayout: sceneLayout,
    hitTest: hitTest,
  };

  if (root) root.jtqClassRoster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
