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
 * 发起一次对话请求
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, maxTokens?:number, timeoutMs?:number}} opts
 * @returns {Promise<string>} 模型返回的文本
 */
async function chat(messages, opts = {}) {
  if (!hasKey()) throw new Error('NO_API_KEY');

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
      throw new Error(`AI_HTTP_${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw new Error('AI_EMPTY_RESPONSE');
    return String(content);
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

module.exports = { chat, extractJson, hasKey, modelName, baseUrl };
