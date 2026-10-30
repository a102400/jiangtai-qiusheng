// 用 SVGO 压缩静态 SVG 资产，并对「压缩后仍然成立」做机器校验。
//
// 两个目录，两套规则：
//   1. students/svg/*.svg —— 九张状态立绘（由 build-student-assets.js 生成，
//      属于产物，压了不影响可编辑性）。
//      硬约束：八个功能分组必须都在、状态显隐必须正确、title/viewBox/
//      data-* 元数据不能动。SVGO 默认会删隐藏元素和改 ID，
//      所以配置里关掉了 cleanupIds / removeHiddenElems / collapseGroups。
//   2. classroom/*.svg —— 教室背景层与课桌层。
//      **刻意不压缩**：它们是手绘源文件，设计师要在 Inkscape / Figma 里
//      继续改，SVGO 压完就没了注释和缩进，反而更难接手。
//      体积本来就很小（合计约 12KB），不值得为此牺牲可编辑性。
//
// 用法：node scripts/optimize-svg-assets.js
// 可选：SVGO_BIN=/path/to/svgo node scripts/optimize-svg-assets.js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STUDENT_DIR = path.join(ROOT, 'public', 'assets', 'students', 'svg');
const CONFIG = path.join(__dirname, 'svgo-students.config.cjs');

const STATES = ['default', 'closed', 'raise'];
const KEYS = ['geek', 'naughty', 'drift'];
const GROUPS = [
  'desk', 'body', 'head', 'eyes',
  'mouth-open', 'mouth-closed', 'arm-down', 'arm-raise'
];

function run(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true
  });
}

function resolveSvgo() {
  const candidates = [
    process.env.SVGO_BIN,
    'svgo',
    'D:/Tools/npm-global/svgo.cmd'
  ].filter(Boolean);
  for (const command of candidates) {
    const result = run(command, ['--version']);
    if (!result.error && result.status === 0) return command;
  }
  throw new Error('找不到 SVGO；请先安装，或用 SVGO_BIN 指定可执行文件。');
}

function groupTag(svg, id) {
  const match = svg.match(new RegExp('<g\\b(?=[^>]*\\bid="' + id + '")[^>]*>'));
  return match ? match[0] : '';
}

function visible(svg, id) {
  const tag = groupTag(svg, id);
  if (!tag) throw new Error('缺少分组 #' + id);
  if (/display\s*:\s*none/.test(tag)) return false;
  if (/display\s*:\s*inline/.test(tag)) return true;
  throw new Error('#' + id + ' 缺少明确的 display 状态');
}

function textElement(svg, name) {
  const match = svg.match(new RegExp('<' + name + '\\b[^>]*>[\\s\\S]*?</' + name + '>'));
  return match ? match[0] : '';
}

function viewBoxOf(svg) {
  const match = svg.match(/\bviewBox="([^"]+)"/);
  return match ? match[1].trim() : '';
}

/* ---------------- 学生状态图 ---------------- */

function validateStudent(before, after, key, state) {
  if (!after.includes('<svg') || !after.includes('</svg>')) {
    throw new Error('SVGO 产物不是完整 SVG');
  }
  if (viewBoxOf(before) !== viewBoxOf(after)) throw new Error('viewBox 被改变');
  if (textElement(before, 'title') !== textElement(after, 'title')) {
    throw new Error('无障碍 title 被改变');
  }
  if (!after.includes('data-character="' + key + '"') ||
      !after.includes('data-state="' + state + '"')) {
    throw new Error('角色或状态元数据被删除');
  }
  for (const id of GROUPS) {
    if (!groupTag(after, id)) throw new Error('功能分组被删除：#' + id);
  }
  const expected = {
    desk: false,
    'mouth-open': state !== 'closed',
    'mouth-closed': state === 'closed',
    'arm-down': state !== 'raise',
    'arm-raise': state === 'raise'
  };
  for (const [id, wanted] of Object.entries(expected)) {
    if (visible(after, id) !== wanted) {
      throw new Error('#' + id + ' 显隐状态被改变');
    }
  }
}

/* ---------------- 教室美术层 ---------------- */
/* 教室图层是手绘源文件，刻意不压缩 —— 见文件头说明。 */

/* ---------------- 主流程 ---------------- */

function optimizeOne(svgo, file, validator, label) {
  const temp = file + '.optimizing';
  const before = fs.readFileSync(file, 'utf8');
  const result = run(svgo, ['--quiet', '--config', CONFIG, '--input', file, '--output', temp]);
  if (result.error || result.status !== 0) {
    throw new Error(label + ' 压缩失败：' + (result.stderr || result.error?.message || result.status));
  }
  const after = fs.readFileSync(temp, 'utf8');
  try {
    validator(before, after);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new Error(label + '：' + error.message);
  }
  fs.renameSync(temp, file);
  const beforeSize = Buffer.byteLength(before);
  const afterSize = Buffer.byteLength(after);
  console.log(label + ': ' + beforeSize + ' -> ' + afterSize + ' bytes');
  return { beforeSize, afterSize };
}

function main() {
  const svgo = resolveSvgo();
  let beforeTotal = 0;
  let afterTotal = 0;
  let count = 0;

  for (const key of KEYS) {
    for (const state of STATES) {
      const name = key + '-' + state + '.svg';
      const stat = optimizeOne(
        svgo,
        path.join(STUDENT_DIR, name),
        (before, after) => validateStudent(before, after, key, state),
        name
      );
      beforeTotal += stat.beforeSize;
      afterTotal += stat.afterSize;
      count++;
    }
  }

  const saved = beforeTotal - afterTotal;
  const percent = beforeTotal ? (saved / beforeTotal * 100).toFixed(1) : '0.0';
  console.log('SVGO OK: ' + count + ' 个文件, ' + beforeTotal + ' -> ' + afterTotal +
    ' bytes, saved ' + saved + ' bytes (' + percent + '%)');
  console.log('（教室美术层是手绘源文件，按设计不压缩）');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
