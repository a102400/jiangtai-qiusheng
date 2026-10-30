/**
 * 构建「单文件离线版」：把 CSS / JS / 演示数据全部内联进一个 HTML。
 *
 * 产出：讲台求生-离线版.html
 * 用法：双击即可打开，不需要 Node、不需要网络、不需要 sharecode。
 *      所有 API 请求都会走 app.js 内置的离线演示数据（demo-data.js）。
 *
 * 运行：node scripts/build-standalone.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');       // app/
const PUB = path.join(ROOT, 'public');
const OUT = path.resolve(ROOT, '..', '讲台求生-离线版.html'); // 项目根目录

function read(p) {
  return fs.readFileSync(path.join(PUB, p), 'utf8');
}

/* 内联 <script> 时，正文里的 </script 会提前闭合标签，必须转义 */
function safeJs(code) {
  return String(code).replace(/<\/script/gi, '<\\/script');
}

let html = read('index.html');

// 1) 内联样式表
const cssTag = /<link rel="stylesheet" href="styles\.css(\?v=[^"]*)?">/;
if (!cssTag.test(html)) throw new Error('未找到 styles.css 的 link 标签');
html = html.replace(cssTag, '<style>\n' + read('styles.css') + '\n</style>');

// 1b) 特效层样式单独成文件（fx.css），也必须内联，否则离线版没有图层定位
const fxTag = /<link rel="stylesheet" href="fx\.css(\?v=[^"]*)?">/;
if (!fxTag.test(html)) throw new Error('未找到 fx.css 的 link 标签');
html = html.replace(fxTag, '<style>\n' + read('fx.css') + '\n</style>');

// 1c) 材质 / 动效 / 组件状态 / 消息入场，同样必须内联。
//     顺序必须与 index.html 一致：基础 → 特效 → 材质 → 动效 → 组件 → 消息。
const EXTRA_CSS = ['material.css', 'motion.css', 'ui.css', 'msg.css', 'rb-fx.css'];
EXTRA_CSS.forEach(function (f) {
  const re = new RegExp('<link rel="stylesheet" href="' + f.replace('.', '\\.') + '(\\?v=[^"]*)?">');
  if (!re.test(html)) throw new Error('未找到 ' + f + ' 的 link 标签');
  html = html.replace(re, '<style>\n' + read(f) + '\n</style>');
});

// 2) 去掉两个 CDN 依赖（离线版没有网络，云服务与二维码走既有降级逻辑）
html = html.replace(
  /<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>\s*/g,
  '<!-- 离线版：已移除 CDN 依赖（云端与二维码功能自动降级） -->\n'
);

// 2b) 学生立绘：把九张状态 SVG（3 角色 × 3 状态）转成 data URI 注入，离线版才能显示立绘
//     （单文件版以 file:// 打开时相对路径 assets/students/*.svg 不可用，
//      另外离线版要能单独拷走，不能依赖旁边的素材目录）
const STUDENT_ART = {
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
const artSrc = {};
Object.keys(STUDENT_ART).forEach(function (key) {
  artSrc[key] = {};
  Object.keys(STUDENT_ART[key]).forEach(function (st) {
    const rel = STUDENT_ART[key][st];
    const abs = path.join(PUB, rel);
    if (!fs.existsSync(abs)) throw new Error('学生立绘缺失：' + rel);
    const svg = fs.readFileSync(abs, 'utf8');
    if (svg.indexOf('<svg') === -1) throw new Error('不是合法 SVG：' + rel);
    artSrc[key][st] = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  });
});
html = html.replace(
  '<script src="students-art.js',
  '<script>window.JTQ_STUDENT_SRC=' + JSON.stringify(artSrc) + ';</script>\n<script src="students-art.js'
);

// 2c) 教室美术层：背景与课桌两张矢量图层同样转成 data URI。
//     和立绘一样的理由 —— 单文件版要能单独拷走，不能依赖旁边的素材目录。
const CLASSROOM_ART = {
  backdrop: 'assets/classroom/backdrop.svg',
  desks: 'assets/classroom/desks.svg',
};
const classroomSrc = {};
Object.keys(CLASSROOM_ART).forEach(function (name) {
  const rel = CLASSROOM_ART[name];
  const abs = path.join(PUB, rel);
  if (!fs.existsSync(abs)) throw new Error('教室图层缺失：' + rel);
  const svg = fs.readFileSync(abs, 'utf8');
  if (svg.indexOf('<svg') === -1) throw new Error('不是合法 SVG：' + rel);
  classroomSrc[name] = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
});
html = html.replace(
  '<script src="classroom-art.js',
  '<script>window.JTQ_CLASSROOM_SRC=' + JSON.stringify(classroomSrc) + ';</script>\n<script src="classroom-art.js'
);

// 3) 内联本地脚本
//    顺序必须与 index.html 一致：evidence.js 要在 app.js 之前；
//    question-drill-rules.js 必须在 question-drill.js 之前（后者运行时读前者）
//    用正则而非精确字符串匹配：script 标签可能带 ?v=xxxx 缓存版本号
const LOCAL_SCRIPTS = ['vendor/gsap.min.js', 'vendor/ScrollTrigger.min.js', 'rb-fx.js', 'demo-data.js', 'cloud.js', 'evidence.js', 'classroom-roster.js', 'classroom-art.js', 'students-art.js', 'app.js', 'scroll-gsap.js', 'question-drill-rules.js', 'question-drill.js', 'workspace.js', 'fx.js', 'motion.js', 'countup.js', 'blurtext.js', 'msg.js'];
LOCAL_SCRIPTS.forEach(function (f) {
  const re = new RegExp('<script src="' + f.replace('.', '\\.') + '(\\?v=[^"]*)?"><\\/script>');
  if (!re.test(html)) throw new Error('未找到 ' + f + ' 的 script 标签');

  let code = read(f);

  // 立绘加载器里写的是相对路径，离线版必须换成 data URI。
  // 除了上面注入的 window.JTQ_STUDENT_SRC，这里再把源码里的默认路径也换掉 ——
  // 双重保险：就算注入那段被人删了，单文件版照样能显示立绘。
  if (f === 'students-art.js') {
    Object.keys(STUDENT_ART).forEach(function (key) {
      Object.keys(STUDENT_ART[key]).forEach(function (st) {
        code = code.split(STUDENT_ART[key][st]).join(artSrc[key][st]);
      });
    });
  }

  // 教室图层加载器同理：源码里的默认路径也要换成 data URI。
  if (f === 'classroom-art.js') {
    Object.keys(CLASSROOM_ART).forEach(function (name) {
      code = code.split(CLASSROOM_ART[name]).join(classroomSrc[name]);
    });
  }

  // 离线单文件版必须无条件走内置演示数据。
  // 页面版里这条路依赖地址栏 ?jtq-demo=1，但双击打开的本地文件根本没有这个参数 ——
  // 结果是脚本真的去 fetch 相对路径，file:// 下必然失败，
  // 双击打开后每个按钮都报「无法连接服务端」，离线版等于废掉。
  // 涉及三个脚本（app.js 请求分发 / question-drill.js / cloud.js 云同步），
  // 所以统一按表达式替换，而不是只认某一个文件里的某一行。
  const demoFlagRe = /new URLSearchParams\((?:window\.)?location\.search\)\.get\('jtq-demo'\)\s*===\s*'1'/g;
  if (demoFlagRe.test(code)) {
    code = code.replace(demoFlagRe, 'true /* 离线单文件版：强制内置演示数据 */');
  }
  demoFlagRe.lastIndex = 0;

  // 用函数形式做替换：字符串形式里，源码中的 $& / $' / $` 会被 String.replace
  // 当成替换模式解释（压缩过的 GSAP 里确实有这些字符），内联内容会被撕碎、
  // 甚至把后面的 script 标签重新「还原」回输出里。
  html = html.replace(re, function () {
    return '<script>\n' + safeJs(code) + '\n</script>';
  });
});

// 3b) 自检：所有本地脚本必须都已内联（否则会静默生成一个跑不起来的文件）
LOCAL_SCRIPTS.forEach(function (f) {
  if (html.indexOf('src="' + f) !== -1) {
    throw new Error('内联失败：' + f + ' 仍以外部引用形式存在');
  }
});
if (html.indexOf('assets/students/') !== -1) {
  throw new Error('内联失败：学生立绘仍以文件路径引用，离线版会加载失败');
}
if (html.indexOf('assets/classroom/') !== -1) {
  throw new Error('内联失败：教室美术层仍以文件路径引用，离线版会加载失败');
}
// 3c) 自检：离线版不能再依赖地址栏参数，否则双击打开会去 fetch 真实接口并全部报错
if (/get\('jtq-demo'\)\s*===\s*'1'/.test(html)) {
  throw new Error('离线版仍依赖地址栏 ?jtq-demo=1，双击打开会走真实请求');
}

// 4) 顶部加一条离线版提示（关闭后记住）
const banner = `
<div id="offlineBanner" style="position:fixed;left:0;right:0;bottom:0;z-index:9999;
  background:#1E293B;color:#E2E8F0;font-size:12.5px;line-height:1.5;padding:8px 44px 8px 14px;
  font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  离线单文件版：所有 AI 分析使用内置演示数据，界面与流程与在线版完全一致。在线版需联网运行 Node 服务。
  <button onclick="this.parentNode.remove()" style="position:absolute;right:8px;top:6px;border:none;
    background:transparent;color:#94A3B8;font-size:14px;cursor:pointer">✕</button>
</div>`;
html = html.replace('</body>', banner + '\n</body>');

// 5) 标记来源，便于排查
html = html.replace(
  '<title>',
  '<!-- generated by scripts/build-standalone.js · standalone offline build -->\n<title>'
);

fs.writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✓ 已生成：' + OUT);
console.log('  体积 ' + kb + ' KB');
console.log('  内联：styles.css / ' + LOCAL_SCRIPTS.join(' / '));
console.log('  移除：jsdelivr 两个 CDN 脚本（云端与二维码自动降级）');
