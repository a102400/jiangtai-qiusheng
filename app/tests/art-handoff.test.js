'use strict';

/**
 * 美术资产交接包契约测试
 *
 * 交接包是「把设计资产交出去」的产物，最怕两件事：
 *   1. 目录结构被改坏，接手方不知道哪些是源文件、哪些是生成产物；
 *   2. README 里的约定与代码里的实际约定漂移（比如状态数从 5 变回 3，
 *      但文档还写着 5 种状态）—— 文档比代码更危险。
 * 所以这里把「包该有什么」和「文档说的与代码做的是否一致」都钉住。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, '..', 'docs', '美术资产包');
const STATES = ['default', 'closed', 'raise', 'speak-raise', 'idle-down'];
const KEYS = ['geek', 'naughty', 'drift'];

test('交接包目录存在，且结构完整', () => {
  assert.ok(fs.existsSync(PKG), '缺少 docs/美术资产包');
  ['README.md', 'tokens.json', 'preview.html'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(PKG, name)), '缺少 ' + name);
  });
  ['masters', 'classroom', 'states', 'preview'].forEach((dir) => {
    assert.ok(fs.existsSync(path.join(PKG, dir)), '缺少目录 ' + dir);
  });
});

test('母版三张 + 教室图层两张都在包里', () => {
  ['geek.svg', 'naughty.svg', 'drift.svg'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(PKG, 'masters', name)), '缺母版 ' + name);
  });
  ['backdrop.svg', 'desks.svg'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(PKG, 'classroom', name)), '缺教室图层 ' + name);
  });
});

test('包里覆盖全部 15 张状态图', () => {
  KEYS.forEach((key) => {
    STATES.forEach((state) => {
      const p = path.join(PKG, 'states', key + '-' + state + '.svg');
      assert.ok(fs.existsSync(p), '缺状态图 ' + key + '-' + state + '.svg');
    });
  });
});

test('README 的状态清单与代码里的实际状态一致（文档不能漂）', () => {
  const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
  STATES.forEach((state) => {
    assert.ok(readme.indexOf('`' + state + '`') !== -1, 'README 未提到状态 ' + state);
  });
  const roster = fs.readFileSync(path.join(ROOT, 'public', 'classroom-roster.js'), 'utf8');
  STATES.forEach((state) => {
    assert.ok(roster.indexOf("'" + state + "'") !== -1, '代码里没有状态 ' + state);
  });
});

test('README 写明了两个最容易踩的坑（不写死宽高 / 分组 id 是契约）', () => {
  const readme = fs.readFileSync(path.join(PKG, 'README.md'), 'utf8');
  assert.ok(readme.indexOf('width/height') !== -1, 'README 必须说明「不要写死 width/height」');
  assert.ok(readme.indexOf('id') !== -1 && readme.indexOf('arm-raise') !== -1,
    'README 必须列出功能分组 id');
  assert.ok(readme.indexOf('0.845') !== -1, 'README 必须写明地板线比例 0.845');
});

test('tokens.json 是合法 JSON，且含教室与角色两套色板', () => {
  const tokens = JSON.parse(fs.readFileSync(path.join(PKG, 'tokens.json'), 'utf8'));
  assert.ok(tokens.color.classroom, '缺少教室色板');
  assert.ok(tokens.color.characters, '缺少角色色板');
  assert.strictEqual(tokens.color.classroom.floor.$value, '#ddd3bf');
  assert.strictEqual(tokens.size.floorLineRatio.$value, 0.845);
});

test('打包脚本存在且可重复执行', () => {
  const p = path.join(ROOT, 'scripts', 'build-art-handoff.js');
  assert.ok(fs.existsSync(p), '缺少 scripts/build-art-handoff.js');
  const src = fs.readFileSync(p, 'utf8');
  assert.ok(src.indexOf("'states'") !== -1, '打包脚本应输出 states 目录');
  assert.ok(src.indexOf("'masters'") !== -1, '打包脚本应输出 masters 目录');
});
