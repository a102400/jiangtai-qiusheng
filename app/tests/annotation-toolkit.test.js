'use strict';

/**
 * 标注工具链测试
 * ------------------------------------------------------------------
 * 这里测的不是「代码跑不跑得起来」，而是**方法学约束有没有被破坏**：
 *
 *   1. 标注页绝不能显示系统判断 —— 一旦显示，标注员被锚定，
 *      算出来的 κ 是「人和系统的一致度」，不是「两人独立判断的一致度」，
 *      前者天然偏高，且无法解释。这是整条证据链最容易被人为破坏的一环。
 *   2. 抽样必须可复现 —— 报告里写了种子，别人必须能抽出一模一样的样本，
 *      否则「我们的 κ 是 0.72」这句话无法被复核。
 *   3. 分层必须生效 —— 纯随机抽样会让 70% 样本都是「讲授」，
 *      4.1/4.2 这类真正容易分歧的类别样本不足，κ 的置信区间宽到没有意义。
 *   4. CSV 必须带 BOM —— 不带的话 Excel 打开中文全乱码，
 *      标注员会以为文件损坏，然后放弃标注。
 */

const test = require('node:test');
const assert = require('node:assert');
const { makeRng, stratifiedSample, buildLabelHtml, csvCell, DEMO_CORPUS } = require('../scripts/build-annotation-set');

const units = DEMO_CORPUS.map((text, i) => ({ text, code: String(['5', '4.1', '4.2', '6', '2', '1', '3', '7'][i % 8]), source: 'demo' }));

test('标注页不得包含系统编码：防止锚定效应', () => {
  const html = buildLabelHtml(units);
  const m = html.match(/const ITEMS = (\[[\s\S]*?\]);/);
  assert.ok(m, '标注页里应有 ITEMS 数据');
  const items = JSON.parse(m[1]);
  const keys = new Set();
  items.forEach((it) => Object.keys(it).forEach((k) => keys.add(k)));
  assert.deepStrictEqual([...keys].sort(), ['id', 'source', 'text'],
    '每句只允许带 id/text/source；出现 code / rule_code 就说明系统判断泄露了，κ 会被污染');
});

test('抽样可复现：同 seed 两次抽样结果完全一致', () => {
  const a = stratifiedSample(units, 12, 20261030);
  const b = stratifiedSample(units, 12, 20261030);
  assert.deepStrictEqual(a.map((x) => x.text), b.map((x) => x.text), '同种子必须抽出同一批句子');
});

test('抽样可复现：换 seed 应当抽出不同样本（否则种子是假的）', () => {
  const a = stratifiedSample(units, 12, 1);
  const b = stratifiedSample(units, 12, 999);
  assert.notDeepStrictEqual(a.map((x) => x.text), b.map((x) => x.text));
});

test('分层抽样：尽量覆盖每个类别，而不是被「讲授」刷屏', () => {
  const picked = stratifiedSample(units, 8, 42);
  const cats = new Set(picked.map((u) => u.code));
  assert.ok(cats.size >= 6, '抽 8 句应覆盖至少 6 个类别，实得 ' + cats.size + ' 个');
});

test('抽样不会超出语料总量', () => {
  const picked = stratifiedSample(units, 999, 7);
  assert.ok(picked.length <= units.length, '抽出的句子不能比语料还多');
});

test('PRNG 是确定性的：同 seed 序列一致', () => {
  const r1 = makeRng(123);
  const r2 = makeRng(123);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  assert.deepStrictEqual(seq1, seq2);
});

test('CSV 转义：含逗号、引号、换行的句子不能破坏列结构', () => {
  assert.strictEqual(csvCell('普通句子'), '普通句子');
  assert.strictEqual(csvCell('有,逗号'), '"有,逗号"');
  assert.strictEqual(csvCell('有"引号'), '"有""引号"');
  assert.strictEqual(csvCell('有\n换行'), '"有\n换行"');
});

test('CSV 必须带 UTF-8 BOM（否则 Excel 打开中文乱码，标注员会以为文件坏了）', () => {
  // writeCsv 内部加 BOM；这里验证约定不被删掉
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'build-annotation-set.js'), 'utf8');
  assert.ok(src.includes("'\\ufeff' + lines.join"), 'writeCsv 必须写入 BOM');
});
