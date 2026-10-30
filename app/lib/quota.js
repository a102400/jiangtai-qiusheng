'use strict';

/**
 * 每日 AI 调用配额（最后一道成本闸门）
 * ------------------------------------------------------------------
 * 解决什么问题
 *   密钥一旦被第三方拿到（分享链接外流、前端源码被读、截图泄露……），
 *   攻击者可以无限制调用，账单不可控。轮换密钥是根治手段，
 *   但在「暂不轮换」的情况下，唯一能把损失变成**可控**的办法是：
 *   给每天的真实模型调用次数设一个硬上限。
 *
 * 为什么不在 deepseek.js 里拦
 *   engine 的降级原因（fallback_reason）是冻结契约，只有 5 个取值
 *   （none / key-not-configured / rate-limited / insufficient-balance / auth-failed / model-error）。
 *   配额超限既不是限流也不是欠费，硬塞进去就是「伪造降级原因」，违反项目铁律。
 *   所以配额判断放在 server 层，命中直接返回 429，不进降级体系。
 *
 * 计数口径
 *   只数「真正会请求大模型」的接口（见 server.js 的 LLM_ENDPOINTS）。
 *   纯计算接口（导出、iFIAS 矩阵）不计数 —— 它们不花钱。
 *
 * 持久化
 *   落在 app/.quota.json，按自然日分桶，进程重启不清零。
 *   该文件已被 .gitignore 忽略，不会入库。
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '.quota.json');

/* 上限解析
   安全默认 300：即使部署时漏配环境变量，也一定有一道硬闸 ——
   「忘了配 = 无限」是最危险的默认值，这里刻意反过来。
   显式写 0 才表示关闭限制（只在明确知道风险时使用）。
   非法值（如 "abc"）回落到 300，而不是静默变成 0。 */
const RAW_LIMIT = process.env.DAILY_LLM_QUOTA;
let DAILY_LIMIT = 300;
if (RAW_LIMIT !== undefined && String(RAW_LIMIT).trim() !== '') {
  const n = Number(RAW_LIMIT);
  DAILY_LIMIT = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 300;
}

/* 手动豁免开关：跑批量测试 / 压测时用 JIANGTAI_NO_QUOTA=1 启动，
   避免测试消耗真实配额导致后续用例被 429 打断。
   生产环境不要设。 */
function disabled() {
  return process.env.JIANGTAI_NO_QUOTA === '1';
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.date === today() && typeof obj.used === 'number') return obj;
  } catch (e) {
    // 文件不存在 / 跨天 / 内容损坏 —— 都视为新的一天，重新计
  }
  return { date: today(), used: 0 };
}

function write(obj) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(obj), 'utf8');
  } catch (e) {
    // 写不进去（只读文件系统等）不应让主流程失败；
    // 代价是计数不准，但限额仍在内存外失去持久性 —— 记录到日志便于排查。
    console.warn('[quota] 配额文件写入失败，计数可能不准：', e.message);
  }
}

function status() {
  const q = read();
  const limit = disabled() ? 0 : DAILY_LIMIT;
  return {
    date: q.date,
    used: q.used,
    limit,
    left: limit > 0 ? Math.max(0, limit - q.used) : null,
  };
}

/** 消耗一次额度。返回 false 表示今日已用尽，调用方应直接拒绝。 */
function consume() {
  if (disabled() || !DAILY_LIMIT) return true;   // 豁免或未配置上限 → 不限
  const q = read();
  if (q.used >= DAILY_LIMIT) return false;
  q.used += 1;
  write(q);
  return true;
}

module.exports = { status, consume, limit: () => (disabled() ? 0 : DAILY_LIMIT) };
