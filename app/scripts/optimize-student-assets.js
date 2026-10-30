// 用 SVGO 压缩生成后的九张状态 SVG，并守住分组、显隐和元数据契约。
// 用法：node scripts/optimize-student-assets.js
// 可选：SVGO_BIN=/path/to/svgo node scripts/optimize-student-assets.js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVG_DIR = path.join(ROOT, 'public', 'assets', 'students', 'svg');
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

function validateOptimized(before, after, key, state) {
  if (!after.includes('<svg') || !after.includes('</svg>')) {
    throw new Error('SVGO 产物不是完整 SVG');
  }
  const viewBox = before.match(/\bviewBox="([^"]+)"/);
  const afterViewBox = after.match(/\bviewBox="([^"]+)"/);
  if (!viewBox || !afterViewBox || viewBox[1] !== afterViewBox[1]) {
    throw new Error('viewBox 被改变');
  }
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

function main() {
  const svgo = resolveSvgo();
  let beforeTotal = 0;
  let afterTotal = 0;
  let count = 0;

  for (const key of KEYS) {
    for (const state of STATES) {
      const name = key + '-' + state + '.svg';
      const file = path.join(SVG_DIR, name);
      const temp = file + '.optimizing';
      const before = fs.readFileSync(file, 'utf8');
      const result = run(svgo, [
        '--quiet', '--config', CONFIG,
        '--input', file, '--output', temp
      ]);
      if (result.error || result.status !== 0) {
        throw new Error(name + ' 压缩失败：' + (result.stderr || result.error?.message || result.status));
      }
      const after = fs.readFileSync(temp, 'utf8');
      try {
        validateOptimized(before, after, key, state);
      } catch (error) {
        fs.rmSync(temp, { force: true });
        throw new Error(name + '：' + error.message);
      }
      fs.renameSync(temp, file);
      beforeTotal += Buffer.byteLength(before);
      afterTotal += Buffer.byteLength(after);
      count++;
      console.log(name + ': ' + Buffer.byteLength(before) + ' -> ' + Buffer.byteLength(after) + ' bytes');
    }
  }

  const saved = beforeTotal - afterTotal;
  const percent = beforeTotal ? (saved / beforeTotal * 100).toFixed(1) : '0.0';
  console.log('SVGO OK: ' + count + '/9, ' + beforeTotal + ' -> ' + afterTotal +
    ' bytes, saved ' + saved + ' bytes (' + percent + '%)');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
