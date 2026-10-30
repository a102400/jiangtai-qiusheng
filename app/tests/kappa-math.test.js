'use strict';

/**
 * κ 计算正确性测试
 * ------------------------------------------------------------------
 * 用**能手算**的表格验证，而不是「跑出来是个 0~1 的数字就算对」。
 * 因为 κ 算错时不会报错，只会给出一个看起来合理的数字，
 * 然后被写进论文，而且没人会去复核。
 */

const test = require('node:test');
const assert = require('node:assert');
const { cohenKappa, binaryKappa, confusion, disagreements, interpret } = require('../scripts/kappa');

const close = (actual, expected, msg) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, (msg || '') + ` 期望 ${expected}，实得 ${actual}`);
};

/** 构造 pairs：先 yy 个 (yes,yes)，再 yn 个 (yes,no)，再 ny 个 (no,yes)，再 nn 个 (no,no) */
function grid(yy, yn, ny, nn) {
  return [
    ...Array(yy).fill(['yes', 'yes']),
    ...Array(yn).fill(['yes', 'no']),
    ...Array(ny).fill(['no', 'yes']),
    ...Array(nn).fill(['no', 'no']),
  ];
}

test('κ：经典 2×2 表格手算核对（20/5/10/15 → 0.4）', () => {
  // Po = (20+15)/50 = 0.7
  // Pe = (25/50)(30/50) + (25/50)(20/50) = 0.3 + 0.2 = 0.5
  // κ  = (0.7-0.5)/(1-0.5) = 0.4
  const r = cohenKappa(grid(20, 5, 10, 15));
  assert.strictEqual(r.n, 50);
  close(r.po, 0.7, 'Po');
  close(r.pe, 0.5, 'Pe');
  close(r.kappa, 0.4, 'κ');
});

test('κ：完全一致时为 1', () => {
  const pairs = [['5', '5'], ['4.1', '4.1'], ['6', '6'], ['2', '2']];
  close(cohenKappa(pairs).kappa, 1);
});

test('κ：两人各用同一个类别但不同的类 → 0（不是负数、不是 NaN）', () => {
  // A 全标 5，B 全标 6：Po=0，Pe=0 → κ=0
  const pairs = Array(10).fill(['5', '6']);
  const r = cohenKappa(pairs);
  close(r.po, 0);
  close(r.pe, 0);
  close(r.kappa, 0);
});

test('κ：两人都只用同一类 → Pe=1 的退化情况按 1 处理，不产生 NaN', () => {
  const r = cohenKappa(Array(5).fill(['5', '5']));
  assert.ok(!Number.isNaN(r.kappa), '不能出现 NaN');
  close(r.kappa, 1);
});

test('κ：空输入返回 null 而不是 0（0 会被误读成「完全不一致」）', () => {
  const r = cohenKappa([]);
  assert.strictEqual(r.n, 0);
  assert.strictEqual(r.kappa, null);
});

test('κ：一致率高达 82% 但 κ=0 —— 高一致率可以是纯巧合', () => {
  // A: 90 个 5 / 10 个 6；B 也是 90/10。
  // 81 个 (5,5) + 1 个 (6,6) = 82 一致 → Po = 0.82
  // Pe = 0.9×0.9 + 0.1×0.1 = 0.82
  // κ = (0.82−0.82)/(1−0.82) = 0
  // 这正是必须用 κ 而不是一致率的原因：不看 Pe 就会写出「一致率 82%，编码可靠」。
  const pairs = [...Array(81).fill(['5', '5']), ...Array(9).fill(['5', '6']), ...Array(9).fill(['6', '5']), ['6', '6']];
  const r = cohenKappa(pairs);
  close(r.po, 0.82);
  close(r.pe, 0.82);
  close(r.kappa, 0, 'κ 应为 0');
  assert.ok(r.kappa < r.po - 0.5, 'κ 必须显著低于原始一致率，否则说明 Pe 没被扣掉');
});

test('单类 κ：把「是不是这一类」当二分类，结果应等于同一张 2×2 表', () => {
  const r = binaryKappa(grid(20, 5, 10, 15), 'yes');
  close(r.kappa, 0.4);
});

test('单类 κ：某类两人都没标过 → 两人在这一类上「完全一致地都说不是」，κ 为 1', () => {
  const pairs = [['5', '6'], ['5', '5']];
  const r = binaryKappa(pairs, '10');
  close(r.kappa, 1);
});

test('混淆矩阵：行列方向不能反（row=A，col=B）', () => {
  const { codes, matrix } = confusion([['5', '6'], ['6', '5'], ['5', '5']]);
  assert.deepStrictEqual(codes, ['5', '6']);
  assert.strictEqual(matrix[0][1], 1, 'A 标 5 而 B 标 6 应落在第 0 行第 1 列');
  assert.strictEqual(matrix[1][0], 1, 'A 标 6 而 B 标 5 应落在第 1 行第 0 列');
  assert.strictEqual(matrix[0][0], 1);
});

test('分歧排序：跨组分歧必须排在组内分歧前面', () => {
  const groupOf = (c) => (['1', '2', '3', '4.1', '4.2', '5', '6', '7'].includes(c) ? 'teacher' : 'student');
  const pairs = [['5', '6'], ['5', '8'], ['2', '3']];
  const ids = [1, 2, 3];
  const list = disagreements(pairs, ids, groupOf);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].severity, '跨组', '跨组分歧必须排第一');
  assert.strictEqual(list[0].id, 2);
  assert.strictEqual(list[2].severity, '组内');
});

test('解读：边界值不应错位', () => {
  assert.strictEqual(interpret(0.6), '中等');
  assert.strictEqual(interpret(0.61), '高度');
  assert.strictEqual(interpret(0.4), '一般');
  assert.strictEqual(interpret(-0.1), '差于随机（判据有系统性冲突）');
  assert.strictEqual(interpret(null), '无法计算');
});
