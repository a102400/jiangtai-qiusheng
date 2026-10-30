'use strict';

/**
 * students-art.js 契约测试
 *
 * 这个文件负责把用户提供的三张 SVG 立绘加载并按内容包围盒裁成位图。
 * 它踩过几个真实故障，所以这里盯死几件事：
 *   1. 不能依赖 img.naturalWidth —— 只有 viewBox 的 SVG 该值返回 0，
 *      用它算源矩形会让 drawImage 什么也画不出来（立绘整片消失）。
 *   2. 三个人物的内容包围盒差异极大（黄色角色只占 58%x67%，
 *      男生占 90%x90%），不按 CROP 裁切就会一大一小。
 *   3. 同一角色的三种状态必须共用同一个裁切矩形 —— 否则举手时
 *      人物会跳动（脸的位置漂移）。
 *   4. 加载失败必须降级成 null 而不是抛错或挂死 —— 课堂场景要能退回简笔小人。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_FILE = path.join(ROOT, 'public', 'students-art.js');
const SRC = fs.readFileSync(SRC_FILE, 'utf8');
const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'students');

/** 记录所有离屏 canvas 的宽高，用来验烘焙尺寸 */
function makeSandbox(opts) {
  opts = opts || {};
  const canvases = [];
  const imgs = [];

  function fakeCanvas() {
    const c = {
      width: 0,
      height: 0,
      getContext() {
        return { drawImage() {} };
      }
    };
    canvases.push(c);
    return c;
  }

  const document = {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === 'canvas') return fakeCanvas();
      if (t === 'img') {
        const img = {
          tagName: 'IMG',
          alt: '',
          decoding: '',
          src: '',
          onload: null,
          onerror: null
        };
        imgs.push(img);
        return img;
      }
      return { tagName: String(tag).toUpperCase(), setAttribute() {} };
    }
  };

  const sandbox = {
    window: {},
    document,
    console: { warn() {}, log() {} },
    Object,
    Math,
    JSON
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  if (opts.src) sandbox.window.JTQ_STUDENT_SRC = opts.src;
  sandbox.window.console = sandbox.console;
  vm.createContext(sandbox);

  return { sandbox, canvases, imgs, win: sandbox.window };
}

function boot(opts) {
  const env = makeSandbox(opts);
  vm.runInContext(SRC, env.sandbox, { filename: 'students-art.js' });
  return env;
}

/** 让所有 img 立刻成功加载 */
function fireLoad(env) {
  env.imgs.forEach((img) => {
    if (img.onload) img.onload();
  });
}

const ALL_STATES = ['default', 'closed', 'raise'];

test('默认三个角色都注册了立绘路径', () => {
  const env = boot();
  const art = env.win.jtqStudentArt;
  assert.ok(art, 'window.jtqStudentArt 未暴露');
  assert.deepStrictEqual(Array.from(art.keys()).sort(), ['drift', 'geek', 'naughty']);
});

test('每个角色注册了三种状态', () => {
  const env = boot();
  const art = env.win.jtqStudentArt;
  assert.deepStrictEqual(Array.from(art.states()).sort(), ALL_STATES.slice().sort());
  // 9 张图都会发起加载
  assert.strictEqual(env.imgs.length, 9, '应加载 3 角色 × 3 状态 = 9 张');
});

test('加载中 get() 返回 null（调用方据此退回简笔小人）', () => {
  const env = boot();
  assert.strictEqual(env.win.jtqStudentArt.get('naughty'), null);
  assert.strictEqual(env.win.jtqStudentArt.get('geek'), null);
});

test('加载失败后 get() 仍返回 null，不抛错也不挂死', () => {
  const env = boot();
  let readyCalled = false;
  env.win.jtqStudentArt.onReady(() => { readyCalled = true; });
  env.imgs.forEach((img) => {
    if (img.onerror) img.onerror();
  });
  assert.strictEqual(env.win.jtqStudentArt.get('naughty'), null);
  assert.ok(readyCalled, '全部失败时 onReady 也必须回调，否则调用方永远等不到');
});

test('烘焙尺寸 = 内容包围盒 × viewBox × 2 倍栅格（不依赖 naturalWidth）', () => {
  const env = boot();
  fireLoad(env);

  const art = env.win.jtqStudentArt;

  // bake 会为每个角色建两块 canvas：整图栅格 + 裁切结果
  const expect = {
    naughty: [Math.round(0.8067 * 600 * 2), Math.round(0.9013 * 760 * 2)],
    geek: [Math.round(0.8984 * 620 * 2), Math.round(0.9012 * 800 * 2)],
    drift: [Math.round(0.6083 * 600 * 2), Math.round(0.6743 * 740 * 2)]
  };

  Object.keys(expect).forEach((key) => {
    const baked = art.get(key, 'default');
    assert.ok(baked, key + ' 应已就绪');
    assert.strictEqual(baked.width, expect[key][0], key + ' 烘焙宽度不符');
    assert.strictEqual(baked.height, expect[key][1], key + ' 烘焙高度不符');
  });
});

test('同一角色的三种状态烘焙出完全相同的尺寸（切换时人物不跳动）', () => {
  const env = boot();
  fireLoad(env);
  const art = env.win.jtqStudentArt;

  ['naughty', 'geek', 'drift'].forEach((key) => {
    const base = art.get(key, 'default');
    assert.ok(base, key + ' default 应已就绪');
    ALL_STATES.forEach((st) => {
      const img = art.get(key, st);
      assert.ok(img, key + '/' + st + ' 应已就绪');
      assert.strictEqual(img.width, base.width, key + '/' + st + ' 宽度与其他状态不一致');
      assert.strictEqual(img.height, base.height, key + '/' + st + ' 高度与其他状态不一致');
    });
  });
});

test('三种状态各自是独立的位图（不是同一张复用）', () => {
  const env = boot();
  fireLoad(env);
  const art = env.win.jtqStudentArt;

  ['naughty', 'geek', 'drift'].forEach((key) => {
    const a = art.get(key, 'default');
    const b = art.get(key, 'closed');
    const c = art.get(key, 'raise');
    assert.notStrictEqual(a, b, key + ' default 与 closed 应是不同位图');
    assert.notStrictEqual(a, c, key + ' default 与 raise 应是不同位图');
    assert.notStrictEqual(b, c, key + ' closed 与 raise 应是不同位图');
  });
});

test('请求非法状态时回退到 default，不返回 undefined', () => {
  const env = boot();
  fireLoad(env);
  const art = env.win.jtqStudentArt;
  const fallback = art.get('geek', 'default');
  assert.ok(fallback, 'geek default 应已就绪');
  assert.strictEqual(art.get('geek', '不存在的状态'), fallback);
});

test('has() 能判断某个状态是否就绪', () => {
  const env = boot();
  fireLoad(env);
  const art = env.win.jtqStudentArt;
  assert.strictEqual(art.has('naughty', 'raise'), true);
  assert.strictEqual(art.has('naughty', 'nope'), false);
});

test('三个人物的内容宽高比互相接近（裁切有效的判据）', () => {
  const env = boot();
  const art = env.win.jtqStudentArt;
  const ratios = ['naughty', 'geek', 'drift'].map((k) => art.ratioOf(k));
  ratios.forEach((r) => {
    assert.ok(r > 0.6 && r < 0.85, '宽高比应在 0.6~0.85 之间，实际 ' + r.toFixed(3));
  });
  const spread = Math.max.apply(null, ratios) - Math.min.apply(null, ratios);
  assert.ok(spread < 0.12, '三个立绘的宽高比差得太多说明裁切参数错了，实际差 ' + spread.toFixed(3));
});

test('cropOf 返回的四个数字都在 0~1 且不越界', () => {
  const env = boot();
  const art = env.win.jtqStudentArt;
  ['naughty', 'geek', 'drift'].forEach((k) => {
    const c = art.cropOf(k);
    ['x', 'y', 'w', 'h'].forEach((f) => {
      assert.ok(typeof c[f] === 'number', k + '.' + f + ' 不是数字');
      assert.ok(c[f] >= 0 && c[f] <= 1, k + '.' + f + ' 越界：' + c[f]);
    });
    assert.ok(c.x + c.w <= 1.0001, k + ' 的 x+w 超出画布');
    assert.ok(c.y + c.h <= 1.0001, k + ' 的 y+h 超出画布');
  });
});

test('unknown key 不炸：ratioOf 有默认值，cropOf 返回整图', () => {
  const env = boot();
  const art = env.win.jtqStudentArt;
  assert.strictEqual(art.get('nobody'), null);
  assert.ok(art.ratioOf('nobody') > 0.5);
  const c = art.cropOf('nobody');
  assert.deepStrictEqual({ x: c.x, y: c.y, w: c.w, h: c.h }, { x: 0, y: 0, w: 1, h: 1 });
});

test('JTQ_STUDENT_SRC 能覆盖路径（离线版 data URI 走这条路）', () => {
  const dataUri = 'data:image/svg+xml;base64,PHN2Zy8+';
  const env = boot({ src: { naughty: dataUri, geek: dataUri, drift: dataUri } });
  assert.strictEqual(env.imgs.length, 9);
  env.imgs.forEach((img) => assert.strictEqual(img.src, dataUri));
});

test('JTQ_STUDENT_SRC 支持按状态分别覆盖', () => {
  const one = 'data:image/svg+xml;base64,ONE';
  const two = 'data:image/svg+xml;base64,TWO';
  const env = boot({
    src: { geek: { default: one, closed: two, raise: two } }
  });
  const bySrc = {};
  env.imgs.forEach((img) => { bySrc[img.src] = (bySrc[img.src] || 0) + 1; });
  assert.strictEqual(bySrc[one], 1, 'default 应用第一份 data URI');
  assert.strictEqual(bySrc[two], 2, 'closed 与 raise 共用第二份 data URI');
});

test('onReady 在就绪后立刻同步回调（不重复排队）', () => {
  const env = boot();
  fireLoad(env);
  let got = null;
  env.win.jtqStudentArt.onReady((imgs) => { got = imgs; });
  assert.ok(got, '已就绪时 onReady 应立即执行');
  assert.ok(got.naughty);
});

test('缺一张图不影响另外两张', () => {
  const env = boot();
  // 只让前两张成功
  env.imgs.forEach((img, i) => {
    if (i === 0 && img.onerror) img.onerror();
    else if (img.onload) img.onload();
  });
  const art = env.win.jtqStudentArt;
  const ready = ['naughty', 'geek', 'drift'].filter((k) => art.get(k));
  assert.ok(ready.length >= 1, '至少应有角色可用，实际 ' + ready.length);
});

/* ---------------- 接线：防止改动把立绘接线拆掉 ---------------- */

test('index.html 中 students-art.js 必须排在 app.js 之前', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const artAt = html.indexOf('students-art.js');
  const appAt = html.indexOf('src="app.js');
  assert.ok(artAt !== -1, 'index.html 没有引入 students-art.js');
  assert.ok(appAt !== -1, 'index.html 没有引入 app.js');
  assert.ok(artAt < appAt, 'students-art.js 必须在 app.js 之前，否则绘制时 window.jtqStudentArt 还不存在');
});

test('app.js 用 4 参数 drawImage 画立绘（9 参数会因天然尺寸为 0 而画不出来）', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(
    app.indexOf('drawImage(art, left, top, figW, figH)') !== -1,
    '立绘绘制必须走烘焙后的位图 + 4 参数 drawImage'
  );
  assert.strictEqual(
    app.indexOf('art.naturalWidth'),
    -1,
    '不能再用 art.naturalWidth：只有 viewBox 的 SVG 该值为 0，会让立绘整片消失'
  );
});

test('app.js 保留简笔兜底（art 为 null 时不能画空白）', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(app.indexOf('简笔兜底') !== -1 || app.indexOf('简笔小人') !== -1,
    '缺少立绘加载失败时的简笔兜底');
  assert.ok(app.indexOf('window.jtqStudentArt.get(key') !== -1,
    '没有从 jtqStudentArt 取立绘');
});

test('app.js 按状态取立绘，且不再用 ✋ 符号假装举手', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(
    app.indexOf("hand_raise) ? 'raise'") !== -1,
    '举手时必须切到 raise 状态立绘'
  );
  assert.ok(
    app.indexOf("jtqStudentArt.get(key, artState)") !== -1,
    '必须把状态传给立绘加载器'
  );
  assert.strictEqual(
    app.indexOf("fillText('✋'"),
    -1,
    '举手已由真实立绘表达，不能再用 ✋ 符号占位'
  );
});

test('构建脚本按顺序内联 students-art.js（在 app.js 之前）', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-standalone.js'), 'utf8');
  const m = build.match(/const LOCAL_SCRIPTS = \[([^\]]+)\]/);
  assert.ok(m, '未找到 LOCAL_SCRIPTS');
  const list = m[1].split(',').map((x) => x.trim().replace(/['"]/g, ''));
  const artIdx = list.indexOf('students-art.js');
  const appIdx = list.indexOf('app.js');
  assert.ok(artIdx !== -1, 'LOCAL_SCRIPTS 缺 students-art.js，离线版会没有立绘');
  assert.ok(appIdx !== -1, 'LOCAL_SCRIPTS 缺 app.js');
  assert.ok(artIdx < appIdx, 'students-art.js 必须排在 app.js 之前');
});

test('构建脚本把 SVG 转成 data URI 并拒绝残留文件路径', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-standalone.js'), 'utf8');
  assert.ok(build.indexOf('data:image/svg+xml;base64,') !== -1,
    '构建脚本没有把 SVG 转 data URI，离线版会加载不到立绘');
  assert.ok(build.indexOf('window.JTQ_STUDENT_SRC') !== -1,
    '构建脚本没有注入 window.JTQ_STUDENT_SRC');
  assert.ok(build.indexOf("html.indexOf('assets/students/')") !== -1,
    '缺少「素材路径不得残留」的自检');
});

test('九张状态 SVG 文件真实存在且是合法 SVG', () => {
  ['naughty', 'geek', 'drift'].forEach((key) => {
    ALL_STATES.forEach((st) => {
      const p = path.join(ASSET_DIR, 'svg', key + '-' + st + '.svg');
      assert.ok(fs.existsSync(p), '缺少状态立绘 ' + key + '-' + st + '.svg');
      const svg = fs.readFileSync(p, 'utf8');
      assert.ok(svg.indexOf('<svg') !== -1, key + '-' + st + ' 不是 SVG');
      assert.ok(/viewBox="0 0 \d+ \d+"/.test(svg), key + '-' + st + ' 缺少 viewBox');
      // 只有 viewBox 没有 width/height 是既定形态，绘制端按 viewBox 取尺寸。
      // 一旦写死 width/height 且与 viewBox 比例不符，Inkscape 栅格化会信箱化。
      assert.ok(
        !/<svg[^>]*\swidth="\d+"[^>]*\sheight="\d+"/.test(svg),
        key + '-' + st + ' 不应写死 width/height'
      );
      // 必须含全部八个功能分组
      ['desk', 'body', 'head', 'eyes', 'mouth-open', 'mouth-closed', 'arm-down', 'arm-raise']
        .forEach((gid) => {
          assert.ok(
            svg.indexOf('id="' + gid + '"') !== -1,
            key + '-' + st + ' 缺少分组 #' + gid
          );
        });
    });
  });
});

test('状态显隐正确：闭嘴时只显示 mouth-closed，举手时只显示 arm-raise', () => {
  function groupTag(svg, id) {
    const m = svg.match(new RegExp('<g[^>]*id="' + id + '"[^>]*>'));
    return m ? m[0] : '';
  }
  ['naughty', 'geek', 'drift'].forEach((key) => {
    const closed = fs.readFileSync(path.join(ASSET_DIR, 'svg', key + '-closed.svg'), 'utf8');
    assert.ok(
      groupTag(closed, 'mouth-open').indexOf('display:none') !== -1,
      key + '-closed 的 mouth-open 应隐藏'
    );
    assert.ok(
      groupTag(closed, 'mouth-closed').indexOf('display:none') === -1,
      key + '-closed 的 mouth-closed 应显示'
    );
    assert.ok(
      groupTag(closed, 'arm-down').indexOf('display:none') === -1,
      key + '-closed 的 arm-down 应显示'
    );

    const raise = fs.readFileSync(path.join(ASSET_DIR, 'svg', key + '-raise.svg'), 'utf8');
    assert.ok(
      groupTag(raise, 'arm-down').indexOf('display:none') !== -1,
      key + '-raise 的 arm-down 应隐藏'
    );
    assert.ok(
      groupTag(raise, 'arm-raise').indexOf('display:none') === -1,
      key + '-raise 的 arm-raise 应显示'
    );
  });
});

test('desk 层默认关闭（教室画布自带地面，桌沿会撑大包围盒）', () => {
  ['naughty', 'geek', 'drift'].forEach((key) => {
    ALL_STATES.forEach((st) => {
      const svg = fs.readFileSync(path.join(ASSET_DIR, 'svg', key + '-' + st + '.svg'), 'utf8');
      const m = svg.match(/<g[^>]*id="desk"[^>]*>/);
      assert.ok(m, key + '-' + st + ' 缺少 desk 分组');
      assert.ok(
        m[0].indexOf('display:none') !== -1,
        key + '-' + st + ' 的 desk 层应默认关闭'
      );
    });
  });
});

test('三张母版存在且含全部功能分组', () => {
  const masters = { geek: 'geek.svg', naughty: 'naughty.svg', drift: 'drift.svg' };
  Object.keys(masters).forEach((key) => {
    const p = path.join(ASSET_DIR, 'portraits', masters[key]);
    assert.ok(fs.existsSync(p), '缺少母版 ' + masters[key]);
    const svg = fs.readFileSync(p, 'utf8');
    ['desk', 'body', 'head', 'eyes', 'mouth-open', 'mouth-closed', 'arm-down', 'arm-raise']
      .forEach((gid) => {
        assert.ok(svg.indexOf('id="' + gid + '"') !== -1,
          masters[key] + ' 缺少分组 #' + gid);
      });
  });
});

test('角色映射：geek=戴眼镜男学生，naughty=偏分短发女生，drift=黄色角色', () => {
  // 防止再把三个角色映射搞反（之前就搞反过一次）。
  const expectations = {
    geek: { title: '戴眼镜的男学生', view: [620, 800] },
    naughty: { title: '偏分短发女生', view: [600, 760] },
    drift: { title: '黄色校服角色', view: [600, 740] },
  };
  Object.keys(expectations).forEach((key) => {
    const svg = fs.readFileSync(path.join(ASSET_DIR, 'svg', key + '-default.svg'), 'utf8');
    assert.ok(
      svg.indexOf(expectations[key].title) !== -1,
      key + ' 的立绘应是「' + expectations[key].title + '」'
    );
    const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(vb, key + ' 缺少 viewBox');
    assert.strictEqual(Number(vb[1]), expectations[key].view[0], key + ' viewBox 宽度不符');
    assert.strictEqual(Number(vb[2]), expectations[key].view[1], key + ' viewBox 高度不符');
  });
});
