'use strict';

/**
 * 教室美术层契约测试
 *
 * 2D 教室现在是四层叠出来的：背景（矢量）→ 人物 → 课桌（矢量）→ 名牌。
 * 这几层一旦顺序错了，症状都很隐蔽：
 *   - 名牌画在课桌之前 → 名字被桌子挡住，读不出来；
 *   - 课桌画在人物之前 → 桌子被立绘压住，「坐在桌后」的层次消失；
 *   - 教室图层没被内联进离线版 → 离线版退回扁平背景，且没有任何报错。
 * 所以这里把分层顺序和资源存在性都钉死。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_FILE = path.join(ROOT, 'public', 'classroom-art.js');
const SRC = fs.readFileSync(SRC_FILE, 'utf8');
const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'classroom');

function boot(opts) {
  opts = opts || {};
  const imgs = [];
  const document = {
    createElement(tag) {
      if (String(tag).toLowerCase() === 'img') {
        const img = { src: '', onload: null, onerror: null, alt: '', decoding: '' };
        imgs.push(img);
        return img;
      }
      return { tagName: String(tag).toUpperCase(), setAttribute() {} };
    },
  };
  const sandbox = {
    window: {},
    document,
    console: { warn() {}, log() {} },
    Object,
    Math,
    JSON,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  sandbox.window.console = sandbox.console;
  if (opts.src) sandbox.window.JTQ_CLASSROOM_SRC = opts.src;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'classroom-art.js' });
  return { win: sandbox.window, imgs };
}

test('加载器暴露两张教室图层', () => {
  const { win } = boot();
  const art = win.jtqClassroomArt;
  assert.ok(art, 'window.jtqClassroomArt 未暴露');
  assert.deepStrictEqual(art.keys().sort(), ['backdrop', 'desks']);
});

test('两张图层都会发起加载', () => {
  const { imgs } = boot();
  assert.strictEqual(imgs.length, 2);
  assert.ok(imgs[0].src.indexOf('assets/classroom/') === 0);
});

test('加载失败时 get() 返回 null，不抛错（绘制端才能走代码兜底）', () => {
  const { win, imgs } = boot();
  let ready = false;
  win.jtqClassroomArt.onReady(() => { ready = true; });
  imgs.forEach((img) => { if (img.onerror) img.onerror(); });
  assert.strictEqual(win.jtqClassroomArt.get('backdrop'), null);
  assert.strictEqual(win.jtqClassroomArt.get('desks'), null);
  assert.ok(ready, '全部失败时 onReady 也必须回调');
});

test('加载成功后 get() 返回图片对象', () => {
  const { win, imgs } = boot();
  imgs.forEach((img) => { if (img.onload) img.onload(); });
  assert.ok(win.jtqClassroomArt.get('backdrop'));
  assert.ok(win.jtqClassroomArt.get('desks'));
  assert.strictEqual(win.jtqClassroomArt.has('backdrop'), true);
});

test('JTQ_CLASSROOM_SRC 能覆盖路径（离线版 data URI 走这条路）', () => {
  const uri = 'data:image/svg+xml;base64,ROOM';
  const { imgs } = boot({ src: { backdrop: uri, desks: uri } });
  imgs.forEach((img) => assert.strictEqual(img.src, uri));
});

test('两张教室 SVG 存在，且 viewBox 与宽高比例一致（否则会被信箱化）', () => {
  ['backdrop.svg', 'desks.svg'].forEach((name) => {
    const p = path.join(ASSET_DIR, name);
    assert.ok(fs.existsSync(p), '缺少教室图层 ' + name);
    const svg = fs.readFileSync(p, 'utf8');
    const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(vb, name + ' 缺少 viewBox');
    const size = svg.match(/\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
    assert.ok(size, name + ' 缺少 width/height');
    assert.strictEqual(Number(size[1]), Number(vb[1]), name + ' 宽与 viewBox 不一致');
    assert.strictEqual(Number(size[2]), Number(vb[2]), name + ' 高与 viewBox 不一致');
    assert.ok(
      svg.indexOf('preserveAspectRatio="none"') !== -1,
      name + ' 必须用 preserveAspectRatio="none"，否则拉伸会切边'
    );
  });
});

test('教室图层的地板线与立绘脚底对齐（0.845）', () => {
  const svg = fs.readFileSync(path.join(ASSET_DIR, 'backdrop.svg'), 'utf8');
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const h = Number(vb[2]);
  // 背景层地板线 = 676 / 800 = 0.845
  assert.ok(svg.indexOf('y="676"') !== -1, '背景层地板线应在 y=676');
  assert.ok(Math.abs(676 / h - 0.845) < 0.002, '地板线比例应为 0.845');
});

test('index.html 中 classroom-art.js 必须排在 app.js 之前', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const artAt = html.indexOf('classroom-art.js');
  const appAt = html.indexOf('src="app.js');
  assert.ok(artAt !== -1, 'index.html 没有引入 classroom-art.js');
  assert.ok(appAt !== -1, 'index.html 没有引入 app.js');
  assert.ok(artAt < appAt, 'classroom-art.js 必须在 app.js 之前');
});

test('app.js 用教室图层画背景与课桌，并有代码兜底', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(app.indexOf("jtqClassroomArt.get(name)") !== -1, '没有从 jtqClassroomArt 取图层');
  assert.ok(app.indexOf("drawClassroomLayer(ctx, W, H, 'backdrop')") !== -1, '没有画背景层');
  assert.ok(app.indexOf("drawClassroomLayer(ctx, W, H, 'desks')") !== -1, '没有画课桌层');
  assert.ok(app.indexOf('drawDeskFallback') !== -1, '缺少课桌层的代码兜底');
});

test('分层顺序：背景 → 人物 → 课桌 → 名牌', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const scene = app.slice(app.indexOf('function drawClassScene()'), app.indexOf('function classBubble'));
  const bg = scene.indexOf("'backdrop'");
  const people = scene.indexOf('drawClassStudent(ctx');
  const desk = scene.indexOf("'desks'");
  const card = scene.indexOf('drawClassOverlay(ctx');
  assert.ok(bg !== -1 && people !== -1 && desk !== -1 && card !== -1, '四层绘制缺了一层');
  assert.ok(bg < people, '背景必须在人物之前');
  assert.ok(people < desk, '课桌必须在人物之后（要遮住立绘底部）');
  assert.ok(desk < card, '名牌必须在课桌之后（要被压在桌面上）');
});

test('构建脚本内联教室图层，并拒绝残留文件路径', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-standalone.js'), 'utf8');
  assert.ok(build.indexOf('window.JTQ_CLASSROOM_SRC') !== -1, '构建脚本没有注入教室图层');
  assert.ok(build.indexOf("assets/classroom/backdrop.svg") !== -1, '构建脚本没有内联背景层');
  assert.ok(build.indexOf("assets/classroom/desks.svg") !== -1, '构建脚本没有内联课桌层');
  assert.ok(
    build.indexOf("html.indexOf('assets/classroom/')") !== -1,
    '缺少「教室素材路径不得残留」的自检'
  );
  const m = build.match(/const LOCAL_SCRIPTS = \[([^\]]+)\]/);
  assert.ok(m, '未找到 LOCAL_SCRIPTS');
  const list = m[1].split(',').map((x) => x.trim().replace(/['"]/g, ''));
  assert.ok(list.indexOf('classroom-art.js') !== -1, 'LOCAL_SCRIPTS 缺 classroom-art.js');
  assert.ok(
    list.indexOf('classroom-art.js') < list.indexOf('app.js'),
    'classroom-art.js 必须排在 app.js 之前'
  );
});
