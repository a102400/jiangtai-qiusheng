'use strict';

/**
 * Codex 客户端（OpenAI Codex / Azure OpenAI）
 * ------------------------------------------------------------------
 * 双引擎铁律：
 *   1. 配置了 CODEX_API_KEY + CODEX_BASE_URL 时，调用 Codex（默认 Azure OpenAI
 *      Responses API；也可填 OpenAI 直连走 chat/completions）。
 *   2. 未配置 Codex，或 Codex 调用失败 → 自动降级到现有 DeepSeek 客户端
 *      （lib/deepseek.js），保证「无 key 不崩、可兜底」。
 *   3. 所有密钥只在服务端读取（process.env），本文件不出现在任何前端。
 *
 * 用法：
 *   const { chat, hasCodex, mode } = require('./codex');
 *   const r = await chat(messages, { temperature, maxTokens });
 *   // r = { text, engine: 'codex'|'deepseek-fallback', model, codexFellBack }
 */

const ai = require('./deepseek');

// 环境变量一律「用时再读」，不在模块加载时固化（避免 .env 加载顺序问题）
function codexKey() { return process.env.CODEX_API_KEY || ''; }
function codexBase() {
  // 默认走 Azure OpenAI（国内合规通道）；也可填 OpenAI 直连（国内不可达）
  return (process.env.CODEX_BASE_URL || '').replace(/\/+$/, '');
}
function codexModel() { return process.env.CODEX_MODEL || 'gpt-5-codex'; }
function codexWire() {
  const w = String(process.env.CODEX_WIRE_API || '').toLowerCase();
  if (w === 'chat') return 'chat';
  // 默认：Azure OpenAI Codex 用 Responses API
  return 'responses';
}
function hasCodex() {
  const k = codexKey();
  return typeof k === 'string' && k.trim().length > 8 && !!codexBase();
}

function mode() {
  return {
    codexConfigured: hasCodex(),
    codexModel: hasCodex() ? codexModel() : null,
    codexBase: hasCodex() ? codexBase() : null,
    codexWire: hasCodex() ? codexWire() : null,
    fallback: ai.hasKey() ? ai.modelName() : null,
  };
}

function warn(tag, err) {
  console.warn(`[codex] ${tag} 降级：${err && err.message ? err.message : err}`);
}

/* ---- Azure OpenAI / OpenAI Responses API ---- */
async function responsesApi(messages, opts) {
  const url = `${codexBase()}/responses`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${codexKey()}`,
      },
      body: JSON.stringify({
        model: codexModel(),
        input: messages.map((m) => ({ role: m.role, content: String(m.content || '') })),
        temperature: opts.temperature,
        max_output_tokens: opts.maxTokens,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CODEX_HTTP_${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    // 优先用便利字段 output_text；否则手动拼装 output[].content[].text
    let text = '';
    if (typeof data.output_text === 'string') text = data.output_text;
    else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (typeof c.text === 'string') text += c.text;
          }
        }
      }
    }
    if (!text) throw new Error('CODEX_EMPTY_RESPONSE');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- OpenAI 兼容 chat/completions（含 OpenAI 直连） ---- */
async function chatApi(messages, opts) {
  const url = `${codexBase()}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${codexKey()}`,
      },
      body: JSON.stringify({
        model: codexModel(),
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CODEX_HTTP_${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) throw new Error('CODEX_EMPTY_RESPONSE');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 统一的对话入口。
 * @returns {Promise<{text:string, engine:string, model:string, codexFellBack:boolean}>}
 */
async function chat(messages, opts = {}) {
  const normOpts = {
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
    maxTokens: opts.maxTokens || 2048,
    timeoutMs: opts.timeoutMs || 90000,
  };

  // Codex 配置存在 → 先尝试 Codex
  if (hasCodex()) {
    try {
      const raw = codexWire() === 'chat'
        ? await chatApi(messages, normOpts)
        : await responsesApi(messages, normOpts);
      return { text: String(raw), engine: 'codex', model: codexModel(), codexFellBack: false };
    } catch (err) {
      // Codex 调用失败 → 降级 DeepSeek（双引擎铁律）
      warn('codex→deepseek', err);
    }
  }

  // 降级到 DeepSeek（无 key 时这里会抛出 no_api_key，由上层捕获）
  const text = await ai.chat(messages, normOpts);
  return {
    text,
    engine: 'deepseek-fallback',
    model: ai.modelName(),
    codexFellBack: hasCodex(), // true=Codex 配了但失败；false=根本没配 Codex
  };
}

module.exports = { chat, hasCodex, mode };
