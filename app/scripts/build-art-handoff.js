// 打包「美术资产交接包」：母版 + 教室图层 + 全部状态图 + PNG 预览 + 设计说明。
// 用途：把设计资产交出去给 Figma / Inkscape 继续迭代，
//       接手方拿到一个自洽的目录，不需要读代码就知道尺寸与分组约定。
// 用法：node scripts/build-art-handoff.js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, '..', 'docs', '美术资产包');
const INKSCAPE = 'D:/Tools/Inkscape/inkscape/bin/inkscape.exe';

const KEYS = ['geek', 'naughty', 'drift'];
const STATES = ['default', 'closed', 'raise', 'speak-raise', 'idle-down'];
const ROLE_CN = { geek: '小霸', naughty: '小皮', drift: '小走' };
const STATE_CN = {
  'default': '张嘴',
  'closed': '闭嘴',
  'raise': '举手',
  'speak-raise': '举手发言',
  'idle-down': '低头走神',
};

const MASTER_FILES = { geek: 'geek.svg', naughty: 'naughty.svg', drift: 'drift.svg' };
const VIEW = { geek: [620, 800], naughty: [600, 760], drift: [600, 740] };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copy(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function renderPng(svgPath, pngPath, w, h) {
  if (!fs.existsSync(INKSCAPE)) return false;
  const res = spawnSync(INKSCAPE, [
    svgPath, '--export-area-page', '--export-type=png',
    '--export-filename=' + pngPath, '--export-width=' + w, '--export-height=' + h,
  ], { encoding: 'utf8', windowsHide: true });
  return res.status === 0 && fs.existsSync(pngPath);
}

function main() {
  ensureDir(OUT);
  const mastersDir = path.join(OUT, 'masters');
  const classroomDir = path.join(OUT, 'classroom');
  const statesDir = path.join(OUT, 'states');
  const previewDir = path.join(OUT, 'preview');

  // 1) 母版（唯一数据源，带注释，人工编辑的就是它们）
  Object.keys(MASTER_FILES).forEach((key) => {
    copy(
      path.join(PUBLIC, 'assets', 'students', 'portraits', MASTER_FILES[key]),
      path.join(mastersDir, MASTER_FILES[key])
    );
  });

  // 2) 教室美术层（手绘源文件）
  ['backdrop.svg', 'desks.svg'].forEach((name) => {
    copy(
      path.join(PUBLIC, 'assets', 'classroom', name),
      path.join(classroomDir, name)
    );
  });

  // 3) 状态图（15 张，由 build-student-assets.js 生成）
  KEYS.forEach((key) => {
    STATES.forEach((state) => {
      const name = key + '-' + state + '.svg';
      copy(path.join(PUBLIC, 'assets', 'students', 'svg', name), path.join(statesDir, name));
      const png = path.join(PUBLIC, 'assets', 'students', 'png', name.replace('.svg', '.png'));
      if (fs.existsSync(png)) copy(png, path.join(previewDir, 'states', name.replace('.svg', '.png')));
    });
  });

  // 4) 教室图层预览
  const classroomPreview = [
    ['backdrop.svg', 1200, 400],
    ['desks.svg', 1200, 400],
  ];
  classroomPreview.forEach(([name, w, h]) => {
    const svg = path.join(PUBLIC, 'assets', 'classroom', name);
    const dest = path.join(previewDir, 'classroom', name.replace('.svg', '.png'));
    ensureDir(path.dirname(dest));
    renderPng(svg, dest, w, h);
  });

  // 5) 预览页
  const cards = KEYS.map((key) => {
    const items = STATES.map((state) => {
      const png = 'preview/states/' + key + '-' + state + '.png';
      return '<figure><img src="' + png + '" alt="' + ROLE_CN[key] + ' ' + STATE_CN[state] + '">' +
        '<figcaption>' + ROLE_CN[key] + ' · ' + STATE_CN[state] + '</figcaption></figure>';
    }).join('\n      ');
    return '<section><h2>' + ROLE_CN[key] + '（' + key + '）· 五种状态</h2>\n      ' + items + '</section>';
  }).join('\n    ');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>讲台求生 · 美术资产包</title>
<style>
  :root { --ink:#3d3327; --paper:#f6f2e8; --line:#ddd6c6; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:14px/1.7 "Microsoft YaHei", system-ui, sans-serif; }
  header { padding:26px 32px 10px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:20px; }
  .meta { color:#7a6e5c; font-size:13px; }
  section { padding:18px 32px 6px; }
  h2 { font-size:15px; margin:0 0 10px; font-weight:600; }
  .row { display:flex; gap:14px; flex-wrap:wrap; }
  figure { margin:0; width:220px; background:#fbf9f3; border:1px solid var(--line);
           border-radius:10px; padding:8px; text-align:center; }
  figure img { width:100%; height:200px; object-fit:contain; display:block; }
  figcaption { font-size:12px; color:#6b6152; margin-top:6px; }
  .wide img { height:auto; width:100%; }
  footer { padding:20px 32px 40px; color:#7a6e5c; font-size:12.5px; }
  code { background:#efe9dc; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>讲台求生 · 美术资产包</h1>
  <div class="meta">三学生立绘（哑光纸感） + 2D 教室图层 · 可直接在 Figma / Inkscape 中继续迭代</div>
</header>

    ${cards}

    <section>
      <h2>教室背景层（backdrop）· 视图框 2400×800</h2>
      <div class="wide"><img src="preview/classroom/backdrop.png" alt="教室背景层"></div>
    </section>

    <section>
      <h2>课桌层（desks）· 视图框 2400×800</h2>
      <div class="wide"><img src="preview/classroom/desks.png" alt="课桌层"></div>
    </section>

<footer>
  母版在 <code>masters/</code>，状态图在 <code>states/</code>（由 <code>npm run assets:students</code> 生成，<b>不要手改</b>）。<br>
  详细约定（尺寸、分组含义、五种状态、Figma 导入与回导流程）见同目录 <code>README.md</code>。
</footer>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, 'preview.html'), html, 'utf8');

  const count = Object.keys(MASTER_FILES).length + 2 + KEYS.length * STATES.length;
  console.log('ART HANDOFF OK -> ' + OUT);
  console.log('  母版 ' + Object.keys(MASTER_FILES).length + ' 张 / 教室图层 2 张 / 状态图 ' +
    (KEYS.length * STATES.length) + ' 张，共 ' + count + ' 个 SVG');
}

main();
