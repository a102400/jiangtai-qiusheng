/**
 * 教室美术层资源加载器（零依赖）
 *
 * 2D 教室的背景（墙 / 黑板 / 地板）与课桌不是用 Canvas 现画的，
 * 而是两张**矢量图层**：assets/classroom/backdrop.svg、desks.svg。
 * 这样做的原因：
 *   1. 质感 —— 木框、粉笔灰、纸颗粒、天光这些用代码画又长又不像；
 *      直接用矢量图层画，和三张学生立绘是同一套美术语言（哑光纸感）。
 *   2. 可编辑 —— 设计师能用 Inkscape / Figma 打开这两个 SVG 继续迭代，
 *      改完直接替换文件，不需要动 app.js。
 *   3. 可验证 —— 图层是文件，能单独导出 PNG 做像素级比对；
 *      Canvas 现画的背景没法这样回归。
 *
 * 加载失败不抛错：get() 返回 null，app.js 会退回代码兜底的扁平背景，
 * 课堂场景不会因为一张图 404 就空掉。
 *
 * 离线单文件版：构建脚本会把两张 SVG 转成 data URI，
 * 通过 window.JTQ_CLASSROOM_SRC 覆盖路径（和 students-art.js 同一套路）。
 */
(function initClassroomArt() {
  'use strict';

  var SRC = {
    backdrop: 'assets/classroom/backdrop.svg',
    desks: 'assets/classroom/desks.svg',
  };

  var override = window.JTQ_CLASSROOM_SRC;
  if (override && typeof override === 'object') {
    for (var key in override) {
      if (!Object.prototype.hasOwnProperty.call(SRC, key)) continue;
      if (override[key]) SRC[key] = override[key];
    }
  }

  var images = {};
  var listeners = [];
  var pending = 0;
  var settled = false;

  function notify() {
    if (pending > 0) return;
    settled = true;
    var list = listeners.slice();
    listeners.length = 0;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](images);
      } catch (e) {
        if (window.console && window.console.warn) window.console.warn('[jtqClassroomArt] 回调异常', e);
      }
    }
  }

  function loadOne(name) {
    var src = SRC[name];
    if (!src) return;
    pending += 1;

    // 用 createElement('img') 而不是 new Image()：
    // 离线版以 file:// 打开时 new Image() 也能加载 data URI，
    // 但 img 元素能保留同源语义，避免某些内核把 data URI 判成跨域画布污染。
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onload = function () {
      images[name] = img;
      pending -= 1;
      notify();
    };
    img.onerror = function () {
      if (window.console && window.console.warn) {
        window.console.warn('[jtqClassroomArt] 教室图层加载失败，走代码兜底：' + name);
      }
      pending -= 1;
      notify();
    };
    img.src = src;
  }

  function init() {
    for (var name in SRC) {
      if (!Object.prototype.hasOwnProperty.call(SRC, name)) continue;
      loadOne(name);
    }
    if (pending === 0) settled = true;
  }

  window.jtqClassroomArt = {
    /** 取某个图层；未就绪返回 null（调用方走代码兜底） */
    get: function (name) {
      return images[name] || null;
    },
    has: function (name) {
      return !!images[name];
    },
    onReady: function (fn) {
      if (typeof fn !== 'function') return;
      if (settled) {
        fn(images);
        return;
      }
      listeners.push(fn);
    },
    keys: function () {
      return Object.keys(SRC);
    },
  };

  init();
})();
