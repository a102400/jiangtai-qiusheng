'use strict';

/**
 * 余额 / 用量自查
 * ------------------------------------------------------------------
 * 用法：node scripts/check-balance.js
 *
 * 为什么需要它
 *   在「暂不轮换密钥」的前提下，最重要的补偿措施是**尽早发现异常消费**。
 *   密钥若被第三方使用，最先变化的信号就是余额下降速度。
 *   跑一次这个脚本，10 秒内能确认「钱还在不在、今天被调了多少次」。
 *
 * 安全约定
 *   只读取密钥用于发请求，**任何情况下都不打印密钥本身**（连片段也不打）。
 */

const fs = require('fs');
const path = require('path');

// 极简 .env 读取（与 server.js 同逻辑，避免为此引入依赖）
function loadEnv(file) {
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      let val = (m[2] || '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
  } catch (e) { /* 没有 .env 也继续，可能用系统环境变量 */ }
}

loadEnv(path.join(__dirname, '..', '.env'));

const KEY = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const BASE = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');

async function main() {
  console.log('');
  console.log('  讲台求生 · 用量自查');
  console.log('  ' + '-'.repeat(46));

  // 本地配额用量
  const quota = require('../lib/quota');
  const q = quota.status();
  console.log('  今日 AI 调用：' + q.used + ' 次' + (q.limit > 0 ? '（上限 ' + q.limit + '，剩余 ' + q.left + '）' : '（未设上限）'));

  if (!KEY) {
    console.log('  密钥状态：    未配置（当前为演示模式）');
    console.log('');
    return;
  }
  console.log('  密钥状态：    已配置（' + KEY.length + ' 位，不显示内容）');
  console.log('');

  // 上游余额
  try {
    const res = await fetch(BASE + '/user/balance', {
      headers: { Authorization: 'Bearer ' + KEY },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.log('  余额查询失败：HTTP ' + res.status + '（该网关可能不支持 /user/balance 接口）');
      console.log('  可登录平台后台查看余额：https://platform.deepseek.com/usage');
      console.log('');
      return;
    }

    const data = await res.json();
    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    if (!infos.length) {
      console.log('  余额：接口返回为空，请到平台后台确认');
    } else {
      infos.forEach((b) => {
        const cur = b.currency || 'CNY';
        console.log('  账户余额：    ' + (b.total_balance || '?') + ' ' + cur +
          '（充值 ' + (b.topped_up_balance || '?') + ' / 赠送 ' + (b.granted_balance || '?') + '）');
      });
      console.log('  账户可用：    ' + (data.is_available ? '正常' : '余额不足，调用会被拒绝'));
    }
  } catch (e) {
    console.log('  余额查询失败：' + (e && e.name === 'TimeoutError' ? '请求超时' : (e && e.message ? e.message : e)));
    console.log('  可登录平台后台查看：https://platform.deepseek.com/usage');
  }

  console.log('');
  console.log('  提示：若「今日调用」异常增长而你没在用，说明密钥可能已被他人使用，请立即轮换。');
  console.log('');
}

main().catch((e) => {
  console.error('执行失败：', e && e.message ? e.message : e);
  process.exit(1);
});
