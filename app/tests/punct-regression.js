// 改进稿标点清洗回归测试
const { improveScriptRule, analyzeRule } = require('../lib/analyzer.js');

const BASE = {
  subject: '数学',
  durationSec: 120,
};

const cases = [
  {
    name: '句末句号 + 删词(那个) + 逗号',
    transcript: '今天我们来学习函数的单调性。那个，首先看一下定义。大家听懂了吗？好，继续。',
  },
  {
    name: '句首就是口头禅',
    transcript: '那个，今天我们学习勾股定理。a平方加b平方等于c平方。然后我们再做题。',
  },
  {
    name: '连续多个口头禅叠加',
    transcript: '嗯，那个，就是我们今天讲二次函数。然后就是把它配方。',
  },
  {
    name: '顿号粘连',
    transcript: '注意定义域、那个、值域都要写。就是把范围写清楚。',
  },
  {
    name: '稳妥基线（无明显口头禅）',
    transcript: '同学们请看黑板，这里我们推导一下判别式的来源。谁能说说为什么要分类讨论？',
  },
];

const BAD = [/。，/, /，。/, /，、/, /、，/, /。。/, /，，/, /^[，、,.。！？；]/];

let pass = 0;
let fail = 0;

cases.forEach((c, i) => {
  const input = Object.assign({}, BASE, { transcript: c.transcript });
  const out = improveScriptRule(input).improved_script;
  const hits = BAD.filter((re) => re.test(out)).map(String);
  const ok = hits.length === 0;
  ok ? pass++ : fail++;
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${i + 1}. ${c.name}`);
  console.log(`  原文: ${c.transcript}`);
  console.log(`  改后: ${out}`);
  if (!ok) console.log(`  命中脏标点: ${hits.join(' | ')}`);
});

console.log(`\n===== 标点清洗回归：${pass} 通过 / ${fail} 失败 =====`);

// 顺带确认分析端仍正常
const rep = analyzeRule(Object.assign({}, BASE, { transcript: cases[0].transcript }));
console.log('analyze 自检 -> score:', rep.overall_score, '| rate:', rep.speech_rate.chars_per_min, '| fillers:', rep.filler_words.total);
