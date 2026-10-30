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

  /** 后端会给出的提问难度，白名单外一律不显示（同 renderClassStudents 的既有口径） */
  var DIFFICULTIES = ['basic', 'core', 'advanced'];

  /**
   * 学生模型工厂：**单人拆台与三学生课堂共用这一个入口**。
   * ----------------------------------------------------------------
   * 为什么必须有它：此前单人模式的学生只是一个聊天头像，课堂里的学生却是
   * { key, name, mood, hand_raise, speaking, attention, comprehension,
   *   state_reason, difficulty } 这一整套。同一个角色在两处长得不一样、
   * 状态字段也不一样，等于两个产品。
   *
   * 规整口径（与 scoreOf / hasKey 保持一致）：
   *   - key 不在白名单 → 空串（不查原型链，constructor/toString 不算学生）；
   *   - 分数用 scoreOf，缺失就是 null，绝不写成 0（0 分会画成红色告警条）；
   *   - hand_raise / speaking 只认真正的 true，'true' 字符串不算；
   *   - difficulty 只认 basic/core/advanced；
   *   - name 允许调用方覆盖（单人模式的自定义人设显示「定制学生」），
   *     没覆盖就用名册里的名字。
   *
   * @param {string} key 角色白名单里的 key
   * @param {object} [patch] 覆盖字段（后端状态、UI 临时状态）
   */
  function makeStudent(key, patch) {
    var p = (patch && typeof patch === 'object') ? patch : {};
    var k = hasKey(key) ? key : (hasKey(p.key) ? p.key : '');
    var meta = hasKey(k) ? CLASS_META[k] : null;
    var name = (typeof p.name === 'string' && p.name.trim())
      ? p.name.trim()
      : (meta ? meta.name : '');
    return {
      key: k,
      name: name,
      mood: (typeof p.mood === 'string' && p.mood.trim()) ? p.mood : '😊',
      hand_raise: p.hand_raise === true,
      speaking: p.speaking === true,
      attention: scoreOf(p.attention),
      comprehension: scoreOf(p.comprehension),
      state_reason: (typeof p.state_reason === 'string') ? p.state_reason : '',
      difficulty: DIFFICULTIES.indexOf(p.difficulty) !== -1 ? p.difficulty : '',
    };
  }

  /**
   * 立绘状态（五种）：
   *   speak-raise 举手同时发言（张嘴 + 举手）
   *   raise       只举手（闭嘴举手，示意还没开口）
   *   default     只发言（张嘴，手放下）
   *   idle-down   明显走神（低头 + 眯眼）
   *   closed      其余（闭嘴听着）
   *
   * 绘制端（app.js 的 drawClassStudent）与卡片都读这一份，
   * 别在两边各写一遍三元表达式 —— 一处改了另一处不改，
   * 就会出现「卡片写着在发言、画布上却闭着嘴」。
   *
   * 走神判定：只有后端真给了分数才判；分数缺失（null）一律不猜 ——
   * 缺失不伪装成结论。
   */
  function portraitStateOf(s) {
    if (!s) return 'closed';
    if (s.hand_raise === true && s.speaking === true) return 'speak-raise';
    if (s.hand_raise === true) return 'raise';
    if (s.speaking === true) return 'default';
    var att = scoreOf(s.attention);
    if (att !== null && att < 45) return 'idle-down';
    return 'closed';
  }

  /** 默认名册：后端还没返回状态时，先摆出三个「还没开口」的学生 */
  function idleRoster() {
    return KEYS.map(function (key) {
      return makeStudent(key);
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
    DIFFICULTIES: DIFFICULTIES,
    makeStudent: makeStudent,
    portraitStateOf: portraitStateOf,
    idleRoster: idleRoster,
    figSize: figSize,
    slotRatios: slotRatios,
    sceneLayout: sceneLayout,
    hitTest: hitTest,
  };

  if (root) root.jtqClassRoster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
