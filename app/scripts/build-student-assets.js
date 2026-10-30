// 从保色哑光纸感立绘母版生成三学生 SVG（3 角色 × 5 状态）。
//
// 状态语义（嘴 / 手臂 / 头）：
//   default    张嘴 · 手臂放下 · 头正常      —— 正在说话
//   closed     闭嘴 · 手臂放下 · 头正常      —— 沉默听着
//   raise      闭嘴 · 举起手   · 头正常      —— 举手示意（还没开口）
//   speak-raise 张嘴 · 举起手  · 头正常      —— 举手同时发言
//   idle-down  闭嘴 · 手臂放下 · 头下倾+眯眼  —— 走神 / 犯困
//
// 关键约束（改之前先想清楚）：
//   1. 状态显隐靠 `<g style="display:none|inline">` 实现，
//      所以 SVGO 压缩必须关掉 removeHiddenElems / cleanupIds（见 optimize-svg-assets.js）。
//   2. 不要给产物写死 width/height：母版只有 viewBox，
//      写死后与 viewBox 比例不符会被 Inkscape 栅格化成「信箱化」，
//      绘制端的裁切坐标会全部失真。
//   3. 同一角色的所有状态必须共用同一个裁切矩形（并集包围盒），
//      否则切换状态时人物会「跳动」（脸的位置漂移）。
//
// 开发期工具，不进产品运行时。用法：node scripts/build-student-assets.js
'use strict';

const fs = require('fs');
const path = require('path');

const ASSET_ROOT = path.join(__dirname, '..', 'public', 'assets', 'students');
const MASTER_DIR = path.join(ASSET_ROOT, 'portraits');
const OUT = path.join(ASSET_ROOT, 'svg');

const STATES = ['default', 'closed', 'raise', 'speak-raise', 'idle-down'];

const REQUIRED_GROUPS = [
  'desk',
  'body',
  'head',
  'eyes',
  'eyes-down',
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
  'default': '张嘴',
  'closed': '闭嘴',
  'raise': '举手',
  'speak-raise': '举手发言',
  'idle-down': '低头走神',
};

// 每个角色的「低头」姿态：绕颈部 pivot 转 tilt 度，再整体下移 drop。
// 低头 + 眯眼 = 走神/犯困；只眯眼会像在挤眼睛，只低头会像鞠躬。
const HEAD_POSE = {
  geek: { pivot: [300, 392], drop: 12, tilt: 6 },
  naughty: { pivot: [302, 448], drop: 14, tilt: 6 },
  drift: { pivot: [300, 294], drop: 10, tilt: 6 },
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

function groupTag(svg, id) {
  const re = new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>');
  const m = svg.match(re);
  return m ? m[0] : '';
}

function setDisplay(svg, id, visible) {
  const re = new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>');
  if (!re.test(svg)) throw new Error('找不到分组 #' + id);
  return svg.replace(re, (tag) => {
    const withoutDisplay = tag.replace(/\sstyle="[^"]*"/g, '');
    return withoutDisplay.replace(/>$/, ' style="display:' + (visible ? 'inline' : 'none') + '">');
  });
}

/** 给分组加/换/删 transform（低头姿态用）。 */
function setTransform(svg, id, transform) {
  const re = new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>');
  if (!re.test(svg)) throw new Error('找不到分组 #' + id);
  return svg.replace(re, (tag) => {
    let next = tag.replace(/\stransform="[^"]*"/g, '');
    if (transform) {
      next = next.replace(/>$/, ' transform="' + transform + '">');
    }
    return next;
  });
}

function buildSvg(key, state, master) {
  const student = STUDENTS[key];
  const mouthOpen = state === 'default' || state === 'speak-raise';
  const armRaise = state === 'raise' || state === 'speak-raise';
  const drowsy = state === 'idle-down';
  let svg = master;

  // 只加 data-* 属性，不加 width/height（理由见文件头第 2 条）。
  svg = svg.replace(
    '<svg ',
    '<svg data-character="' + key + '" data-state="' + state + '" '
  );
  svg = svg.replace(
    /(<title\b[^>]*>)[\s\S]*?(<\/title>)/,
    '$1' + student.name + ' · ' + student.appearance + ' · ' + STATE_NAMES[state] + '$2'
  );

  // 嘴
  svg = setDisplay(svg, 'mouth-open', mouthOpen);
  svg = setDisplay(svg, 'mouth-closed', !mouthOpen);

  // 手臂
  svg = setDisplay(svg, 'arm-down', !armRaise);
  svg = setDisplay(svg, 'arm-raise', armRaise);

  // 眼睛：走神态换成眯眼
  svg = setDisplay(svg, 'eyes', !drowsy);
  svg = setDisplay(svg, 'eyes-down', drowsy);

  // 头：走神态下倾（绕颈部旋转 + 下移）
  if (drowsy) {
    const pose = HEAD_POSE[key];
    svg = setTransform(svg, 'head',
      'rotate(' + pose.tilt + ' ' + pose.pivot[0] + ' ' + pose.pivot[1] + ') translate(0 ' + pose.drop + ')');
  } else {
    svg = setTransform(svg, 'head', null);
  }

  // 课桌层永远关着：教室场景自带地面与课桌
  svg = setDisplay(svg, 'desk', false);

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
console.log('STATES ' + STATES.join(', '));
