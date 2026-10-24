'use strict';

/**
 * 板书评分（视觉模型可选）
 * ------------------------------------------------------------------
 * 有 AI_VISION_* 配置 → 真正的图片识别评分；
 * 没有（DeepSeek 等纯文本模型不支持识图）→ 降级为「板书自检清单 + 基于教案的建议」，
 * 保证这个功能在任何环境下都不会白屏。
 */

const fs = require('fs');
const ai = require('./deepseek');

function visionConfig() {
  return {
    key: process.env.AI_VISION_KEY || '',
    base: (process.env.AI_VISION_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.AI_VISION_MODEL || '',
  };
}

function hasVision() {
  const c = visionConfig();
  return c.key.length > 8 && !!c.base;
}

/* 视觉模型调用（OpenAI 兼容的多模态格式） */
async function chatVision(base64Image, promptText) {
  const c = visionConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(`${c.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model || 'qwen-vl-max',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
              { type: 'text', text: promptText },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`VISION_HTTP_${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('VISION_EMPTY');
    return String(content);
  } finally {
    clearTimeout(timer);
  }
}

const VISION_PROMPT = `你是一位中学教研组长，正在给一块课堂板书打分。请从以下维度评价，只输出 JSON：
{
  "structure_score": <0-100 分区合理性：主副板书分区、标题、层级>,
  "legibility_score": <0-100 字迹工整可读>,
  "completeness_score": <0-100 关键点是否齐全>,
  "layout_score": <0-100 留白与版面>,
  "total_score": <0-100 综合>,
  "highlights": ["<亮点，≤3条>"],
  "problems": ["<问题，≤3条>"],
  "rewrite": "<建议的板书结构草图，用纯文本分区表示>"
}`;

async function scoreBlackboard(imagePath, meta = {}) {
  const fileBuffer = await fs.promises.readFile(imagePath);

  if (hasVision()) {
    try {
      const raw = await chatVision(fileBuffer.toString('base64'), VISION_PROMPT);
      const json = ai.extractJson(raw);
      if (json && typeof json.total_score !== 'undefined') {
        return { ...json, engine: 'vision', mode: 'image' };
      }
    } catch (e) {
      console.warn('[blackboard] 视觉模型失败，降级：', e.message);
    }
  }

  // 降级：基于教案内容生成板书自检清单（纯文本模型也能做）
  const fallbackPrompt = `你是教研组长。没有板书照片，只有教案信息，请给出【板书设计自检清单】。只输出 JSON：
{
  "checklist": ["<板书自检项，≤6条，每条是可对照检查的具体标准>"],
  "layout_template": "<建议的主副板书分区模板，纯文本>",
  "key_points": ["<这节课板上必须出现的内容，≤6条>"],
  "common_mistakes": ["<新手板书常见错误，≤3条>"]
}
【课题】${meta.subject || '本节课'}（${meta.grade || ''}）`;
  try {
    if (ai.hasKey()) {
      const raw = await ai.chat([{ role: 'user', content: fallbackPrompt }], { temperature: 0.4, maxTokens: 900 });
      const json = ai.extractJson(raw);
      if (json) return { ...json, engine: 'llm', mode: 'checklist' };
    }
  } catch (e) { /* 继续降级 */ }

  return {
    mode: 'checklist',
    engine: 'rule',
    checklist: [
      '主板书（左侧）是否写了课题与主问题？',
      '推导过程是否编号分步，而不是一大坨？',
      '副板书（右侧）是否预留给课堂生成的内容？',
      '重点结论是否用下划线或彩色粉笔标记？',
      '板书占黑板面积是否达到 60% 以上且不拥挤？',
      '下课前黑板是否留有完整知识结构，而不是随写随擦？',
    ],
    layout_template: '左侧 2/3 主板书：课题 → 推导步骤 → 结论框；右侧 1/3 副板书：临时演算、学生回答、易错点。',
    key_points: ['课题标题', '核心概念定义', '推导关键步骤', '结论/公式', '典型例题'],
    common_mistakes: ['边讲边擦，下课前黑板空了', '主副板书混在一起', '字太小，后排看不清'],
  };
}

module.exports = { scoreBlackboard, hasVision };
