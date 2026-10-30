'use strict';

/**
 * 契约测试：规则判据的改动不得引入未登记的变化
 * ---------------------------------------------------------------------------
 * 这个测试守的不是「某一句判得对不对」，而是「改动影响面是否可控」。
 *
 * 为什么要单列一个文件：判据之间会互相干扰，任何一条判据放宽都可能顺手改掉
 * 一批本来正确的句子，而这种回归单测很难穷举。scripts/rule-change-audit.js
 * 把「修复前判据」原样内嵌做全量对比，凡是变化都必须能归到手册第 9 节的 D 编号上。
 *
 * 曾经抓到过的真实回归（现已修复，见 ifias-rule-d-cases.test.js）：
 *   修 D1「采纳」时把正则写成「好|对|是 …… 数字」，
 *   于是「你为什么觉得是 5 呢？」被判成采纳。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const audit = require('../scripts/rule-change-audit.js');
const ifias = require('../lib/ifias.js');
const { DEMO_CORPUS } = require('../scripts/build-annotation-set.js');

test('改动影响面：示例语料上不存在未登记的变化', () => {
  const units = ifias.splitUnits(DEMO_CORPUS.join('\n'));
  const regress = [];
  units.forEach((u) => {
    const before = audit.OLD_RULE(u).code;
    const after = ifias.ruleCodeOne(u).code;
    if (before === after) return;
    const c = audit.classify(u, before, after);
    if (!c || !c.expected) regress.push(`「${u}」 ${before} → ${after}`);
  });
  assert.deepStrictEqual(regress, [],
    '出现未登记的变化，必须补进 docs/iFIAS标注手册.md 第 9 节或回退判据：\n' + regress.join('\n'));
});

test('改动影响面：每一条预期修复都确实发生且方向正确', () => {
  // 反向验证：如果某条修法被误删，这个测试会失败，而不是静默通过。
  // 只验证「没有回归」是不够的——把判据全删掉也能让「没有回归」成立。
  const units = ifias.splitUnits(DEMO_CORPUS.join('\n'));
  const changed = new Map();
  units.forEach((u) => {
    const before = audit.OLD_RULE(u).code;
    const after = ifias.ruleCodeOne(u).code;
    if (before !== after) changed.set(u, { before, after });
  });

  const seen = new Set();
  changed.forEach((v, k) => {
    const c = audit.classify(k, v.before, v.after);
    if (c && c.expected) seen.add(c.id);
  });

  // 示例语料能触发 D1/D2/D6/D7/D8/D9/D13；D4 的连写句示例语料里没有，不强制要求。
  const must = ['D1', 'D2', 'D6', 'D7', 'D8', 'D9', 'D13'];
  const missing = must.filter((id) => !seen.has(id));
  assert.deepStrictEqual(missing, [],
    '下列修法在示例语料上没有被触发，可能已被误删：' + missing.join(', '));
});

test('审计脚本本身可用：OLD_RULE 与当前判据在两个已知句上必须不同', () => {
  // 防止 OLD_RULE 被「顺手改好」——它一旦等于当前判据，整个审计就永远报 0。
  assert.strictEqual(audit.OLD_RULE('小组讨论一下').code, '10', 'OLD_RULE 必须保持修复前的行为');
  assert.strictEqual(ifias.ruleCodeOne('小组讨论一下').code, '6', '当前判据应为修复后的值');
  assert.notStrictEqual(audit.OLD_RULE(path.join('x')).code, undefined);
});
