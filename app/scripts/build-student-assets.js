// 从保色哑光纸感立绘母版生成三学生 SVG（3 角色 × 3 状态）。
// default = 张嘴 + 手臂放下；closed = 闭嘴 + 手臂放下；raise = 张嘴 + 举手。
// 开发期工具，不进产品运行时。用法：node scripts/build-student-assets.js
'use strict';

const fs = require('fs');
const path = require('path');

const ASSET_ROOT = path.join(__dirname, '..', 'public', 'assets', 'students');
const MASTER_DIR = path.join(ASSET_ROOT, 'portraits');
const OUT = path.join(ASSET_ROOT, 'svg');
const STATES = ['default', 'closed', 'raise'];
const REQUIRED_GROUPS = [
  'desk',
  'body',
  'head',
  'eyes',
  'mouth-open',
  'mouth-closed',
  'arm-down',
  'arm-raise',
];
const STUDENTS = {
  geek: { name: '小霸', master: 'geek.svg', appearance: '戴眼镜的男学生' },
  naughty: { name: '小皮', master: 'naughty.svg', appearance: '偏分短发女生' },
  drift: { name: '小走', master: 'drift.svg', appearance: '黄色校服角色' },
};
const STATE_NAMES = {
  default: '张嘴',
  closed: '闭嘴',
  raise: '举手',
};

fs.mkdirSync(OUT, { recursive: true });

function countGroup(svg, id) {
  const re = new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>', 'g');
  return (svg.match(re) || []).length;
}

function validateMaster(key, svg) {
  if (!svg.includes('<svg ') || !svg.includes('</svg>')) {
    throw new Error(key + ': 母版不是完整 SVG');
  }
  for (const id of REQUIRED_GROUPS) {
    const count = countGroup(svg, id);
    if (count !== 1) {
      throw new Error(key + ': 分组 #' + id + ' 应恰好出现 1 次，实际为 ' + count);
    }
  }
  const ids = Array.from(svg.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(key + ': 存在重复 id：' + Array.from(new Set(duplicates)).join(', '));
  }
}

function setDisplay(svg, id, visible) {
  const re = new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>');
  return svg.replace(re, (tag) => {
    const withoutDisplay = tag.replace(/\sstyle="[^"]*"/g, '');
    return withoutDisplay.replace(/>$/, ' style="display:' + (visible ? 'inline' : 'none') + '">');
  });
}

function buildSvg(key, state, master) {
  const student = STUDENTS[key];
  const mouthOpen = state !== 'closed';
  const armRaise = state === 'raise';
  let svg = master;

  // 只加 data-* 属性，不加 width/height：
  // 母版只有 viewBox，浏览器/绘制端需要按 viewBox 尺寸取图。
  // 一旦写死 width="240" height="240"，与 620x800 的 viewBox 比例不符，
  // Inkscape 会把内容信箱化（留白缩小），绘制端的裁切坐标全部失真。
  svg = svg.replace(
    '<svg ',
    '<svg data-character="' + key + '" data-state="' + state + '" '
  );
  svg = svg.replace(
    /(<title\b[^>]*>)[\s\S]*?(<\/title>)/,
    '$1' + student.name + ' · ' + student.appearance + ' · ' + STATE_NAMES[state] + '$2'
  );
  svg = setDisplay(svg, 'mouth-open', mouthOpen);
  svg = setDisplay(svg, 'mouth-closed', !mouthOpen);
  svg = setDisplay(svg, 'arm-down', !armRaise);
  svg = setDisplay(svg, 'arm-raise', armRaise);
  return svg;
}

let count = 0;
for (const [key, student] of Object.entries(STUDENTS)) {
  const masterPath = path.join(MASTER_DIR, student.master);
  const master = fs.readFileSync(masterPath, 'utf8');
  validateMaster(key, master);
  for (const state of STATES) {
    const svg = buildSvg(key, state, master);
    const file = path.join(OUT, key + '-' + state + '.svg');
    fs.writeFileSync(file, svg, 'utf8');
    count++;
  }
}

console.log('WROTE ' + count + ' detailed svg files -> ' + OUT);
console.log('MAPPING geek=戴眼镜的男学生, naughty=偏分短发女生, drift=黄色校服角色');
