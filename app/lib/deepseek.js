'use strict';

/**
 * 大模型调用封装（OpenAI 兼容格式）
 * 支持 DeepSeek / 通义千问 / OpenAI / 任何 OpenAI 兼容网关
 * 只需要 Node 18+ 的全局 fetch，零第三方依赖。
 */

// 注意：环境变量一律「用时再读」，不能在模块加载时固化。
// 否则只要 .env 晚于 require 被读取（顺序问题），密钥就会永远是空的。
function apiKey() { return process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || ''; }
function baseUrl() { return (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''); }
function modelId() { return process.env.AI_MODEL || 'deepseek-chat'; }

function hasKey() {
  const k = apiKey();
  return typeof k === 'string' && k.trim().length > 8;
}

function modelName() {
  return modelId();
}

/**
 * 上游 HTTP 状态码 → 稳定错误码
 * ------------------------------------------------------------------
 * 为什么必须有这张表：
 * 上游返回的 body 文案随厂商而变（可能是英文 Rate limit reached、
 * 可能是中文、可能是别的格式），靠正则匹配 message 不可靠。
 * 上层（engine.js）要能可靠区分「限流 / 欠费 / 鉴权失败 / 上游故障」，
 * 才能诚实地告诉用户「这次为什么不是模型结果」，而不是把所有失败都笼统报成限流。
 *
 * 402 是真实场景：模型账号余额不足时上游返回 402（线上实测遇到过）。
 */
function mapUpstreamCode(status) {
  const s = Number(status);
  if (s === 429) return 'rate_limit_exceeded';
  if (s === 402) return 'insufficient_balance';
  if (s === 401 || s === 403) return 'auth_failed';
  if (s === 404) return 'model_not_found';
  if (s >= 500) return 'upstream_error';
  return 'upstream_http_error';
}

/* 上游报错原文的脱敏：某些网关会在错误信息里回显 Authorization 头或密钥片段。
   这段文本可能被写进日志、也可能经 500 响应外泄，因此先抹掉密钥形态再留存。 */
const SECRET_RE = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
function scrubSecrets(text) {
  let s = String(text == null ? '' : text);
  for (const re of SECRET_RE) s = s.replace(re, '[REDACTED]');
  return s;
}

/**
 * 造一个带稳定错误码的错误对象。
 * 不改变原有 message 文案（便于日志排查），只补结构化字段。
 */
function taggedError(message, code, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach((k) => { err[k] = extra[k]; });
  }
  return err;
}

/**
 * 把任意异常规范化成「带稳定 code 的错误」：
 * - 已经有 code 的（我们自己打的）原样返回；
 * - AbortError（超时中断）→ 'timeout'；
 * - 其它网络/底层异常 → 'network_error'。
 * 错误本身**不会被吞掉**，只是补上一个可判定的字段。
 */
function normalizeError(err) {
  if (!err || typeof err !== 'object') return taggedError(String(err), 'network_error');
  if (typeof err.code === 'string' && err.code) return err;
  let code = 'network_error';
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') code = 'timeout';
  try {
    err.code = code;
  } catch (e) {
    /* 极端情况（对象被冻结）忽略即可，不影响主流程 */
  }
  return err;
}

/**
 * 发起一次对话请求
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number, timeoutMs?:number}} opts
 * @returns {Promise<string>} 模型返回的文本
 */
async function chat(messages, opts = {}) {
  if (!hasKey()) throw taggedError('NO_API_KEY', 'no_api_key');

  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.7;
  const maxTokens = opts.maxTokens || 2048;
  const timeoutMs = opts.timeoutMs || 90000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        model: modelId(),
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 把上游状态码与稳定错误码挂到 error 对象上，
      // 让上层能可靠区分「限流 / 欠费 / 服务端错误」，而不是去正则匹配 message。
      //
      // 安全约束：message 里**绝不拼接上游 body**。
      // message 会被 engine 的 console.warn 写进日志，也可能经 500 响应外泄；
      // 而部分网关会在报错里回显 Authorization 头或请求片段 —— 那就是二次泄露。
      // 上游原文只保留在 error.upstreamBody 字段，且已脱敏，仅供服务端内部判断。
      throw taggedError(`AI_HTTP_${res.status}`, mapUpstreamCode(res.status), {
        status: res.status,
        upstreamBody: scrubSecrets(text.slice(0, 200)),
      });
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      // 上游返回的不是合法 JSON —— 属于协议层问题，不是网络问题，单独标码
      throw taggedError('AI_INVALID_JSON: 上游返回的不是合法 JSON', 'invalid_response');
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw taggedError('AI_EMPTY_RESPONSE', 'empty_response');
    return String(content);
  } catch (err) {
    // 规范化后重抛：错误不被吞掉，只是补上稳定错误码
    throw normalizeError(err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从模型回复里剥出 JSON
 * 模型偶尔会用 ```json 代码块包一层，直接 JSON.parse 会炸，所以先正则清理
 */
function extractJson(raw) {
  if (!raw) return null;
  let clean = String(raw)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  // 兜底：截取第一个 { 到最后一个 }
  if (clean[0] !== '{') {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) clean = clean.slice(start, end + 1);
  }
  try {
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
}

module.exports = { chat, extractJson, hasKey, modelName, baseUrl, mapUpstreamCode };
