'use strict';

/**
 * 形态 C · Codex 自动化脚本
 * ------------------------------------------------------------------
 * 用统一的 Codex 客户端（lib/codex.js）批量生成「改进版逐字稿 / 教学建议」。
 * 双引擎：配置了 CODEX_* 走 Codex，否则/失败自动降级 DeepSeek。
 *
 * 用法：
 *   node scripts/codex-batch.js <讲稿文件.txt> [输出文件.md]
 *   # 不传参则读内部示例并输出到 stdout
 *
 * 约定：脚本仅服务端运行，密钥从 .env 读取（绝不进前端）。
 */

const fs = require('fs');
const path = require('path');

/* ---- 极简 .env 加载（与 server.js 一致，不装 dotenv） ---- */
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      let val = (m[2] || '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
  } catch (e) { /* 无 .env 正常跳过 */ }
}
loadEnv(path.join(__dirname, '..', '.env'));

const codex = require('../lib/codex');

const SAMPLE = `师：同学们，今天我们讲《牛吃草》。
有一片草地，27 头牛能吃 6 天，23 头牛能吃 9 天，问 21 头牛能吃几天？
生：老师，牛每天吃的一样多吗？
师：一样多。大家先自己算一算。`;

async function generate(transcript) {
  const prompt =
    '请基于下面这节试讲的讲稿，生成一份「改进版逐字稿」：\n' +
    '1) 指出当前讲稿在提问设计和概念建模上的 2-3 个薄弱点；\n' +
    '2) 给出可直接念的改进版逐字稿（口语化）；\n' +
    '3) 附 3 个分层追问话术（基础/进阶/挑战）。';
  const messages = [
    { role: 'system', content: '你是「讲台求生」Codex 教学教练，面向师范生试讲训练，输出结构清晰、可落地。' },
    { role: 'user', content: `【讲稿】\n${transcript}\n\n${prompt}` },
  ];
  const r = await codex.chat(messages, { temperature: 0.6, maxTokens: 4096 });
  return { text: r.text, engine: r.engine, model: r.model, fellBack: !!r.codexFellBack };
}

async function main() {
  const inFile = process.argv[2];
  const outFile = process.argv[3];
  let transcript;
  if (inFile) {
    transcript = fs.readFileSync(path.resolve(inFile), 'utf8');
  } else {
    transcript = SAMPLE;
    console.error('（未指定输入文件，使用内置示例讲稿）');
  }

  console.error(`引擎：${codex.hasCodex() ? 'Codex(' + codex.mode().codexModel + ')' : 'DeepSeek 兜底(' + (process.env.AI_MODEL || 'deepseek-chat') + ')'}（若 Codex 失败会自动降级）`);
  const r = await generate(transcript);
  const md = `# Codex 改进稿\n\n> 引擎：${r.engine === 'codex' ? 'Codex · ' + r.model : 'DeepSeek 兜底 · ' + r.model}${r.fellBack ? '（Codex 调用失败已降级）' : ''}\n\n${r.text}\n`;

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), md, 'utf8');
    console.error('已写入：' + outFile);
  } else {
    process.stdout.write(md);
  }
}

main().catch((e) => {
  console.error('失败：', e && e.message ? e.message : e);
  process.exit(1);
});
