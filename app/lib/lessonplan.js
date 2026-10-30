'use strict';

/**
 * 教案导入（25）：对照教案检查试讲是否覆盖全部知识点
 * 双引擎：有 Key 走大模型逐条比对；无 Key 走关键词匹配兜底。
 */

const ai = require('./deepseek');
const { withFallback } = require('./fallback-reason');

/* ---------------- Prompt ---------------- */
function lessonPlanPrompt({ plan, transcript, subject }) {
  return `你是一位微格教学比赛的评委组长。下面是一位实习老师的【教案】和他实际的【试讲逐字稿】（课题：《${subject || '本节课'}》）。
请对照检查：试讲是否覆盖了教案中的全部知识点、有没有讲跑偏。只输出 JSON，不要任何解释：

{
  "coverage": [
    {"point": "<教案中的知识点，≤20字>", "status": "讲透了|提到了|漏讲", "evidence": "<逐字稿中的证据，或缺失说明，≤30字>"}
  ],
  "missing": ["<漏讲的知识点，≤15字>"],
  "verdict": "<一句话总评，≤50字>",
  "suggestions": ["<补讲或纠偏建议，≤30字>"]
}

【硬性要求】
1. coverage 覆盖教案中每一个知识点（最多 10 条），一条不漏
2. status 三档判定：讲透了 = 有推导/例子/练习支撑；提到了 = 只报了名字；漏讲 = 逐字稿中完全没出现
3. 逐字稿讲了很多教案外的内容时，在 suggestions 里明确提醒「讲跑偏」
4. 教案本身结构混乱时，在 verdict 里点出来

【教案】
${plan}

【试讲逐字稿】
${transcript}`;
}

/* ---------------- 本地规则兜底 ---------------- */
/* 从教案文本里提取知识点：先按行拆，再按句号/分号补拆，兼容「一行多个知识点」的紧凑教案 */
function extractPoints(plan) {
  const chunks = [];
  String(plan)
    .split(/\r?\n/)
    .forEach((line) => {
      line.split(/[。；;]/).forEach((seg) => {
        if (seg.trim()) chunks.push(seg);
      });
    });
  const points = [];
  chunks.forEach((seg) => {
    const line = seg
      .replace(/^[\s\-*·•]+/, '')
      .replace(/^\d+\s*[.、]\s*/, '')
      .replace(/^[一二三四五六七八九十]+\s*[、.]\s*/, '')
      .trim();
    if (!line || line.length < 4 || line.length > 60) return;
    if (/知识点|教学目标|目标|重点|难点|掌握|理解|了解|运用|能够|学会|认识|原理|公式|定理|性质|方法|过程|情感|素养|算理|归纳|推导/.test(line)) {
      // 去掉「教学目标：」类前缀后，可能又露出「1.」编号，再剥一次；剥空则丢弃
      const p = line
        .replace(/^(知识点|教学目标?|重点|难点|教学重?难点)\s*[:：]?\s*/, '')
        .replace(/^\d+\s*[.、]\s*/, '')
        .trim()
        .slice(0, 40);
      if (p && points.indexOf(p) === -1) points.push(p);
    }
  });
  return points.slice(0, 10);
}

/* 教学高频词：点和讲稿同时出现即视为有覆盖信号 */
const LEXICON = ['法则', '定理', '公式', '性质', '算理', '导入', '新授', '练习', '小结', '板书',
  '提问', '讨论', '情境', '探究', '合作', '归纳', '演示', '复习', '作业', '评价', '反馈', '拓展'];

/* 去掉「理解/掌握」类动词前缀和「…的意义/法则」类后缀，拿到可用于匹配的核心短语 */
function cleanPoint(point) {
  return String(point || '')
    .replace(/^(通过|借助|引导|启发|培养|初步|理解|掌握|了解|运用|能够|学会|认识|体会|感悟)+/, '')
    .replace(/(的意义|的概念|的含义|的计算方法|的计算法则|的法则|的方法|的过程|及其应用|的应用|的推导|的思路)+$/, '');
}

/* 离线粗判：最长核心短语命中 + 教学词共现 */
function ruleMatchOne(point, transcript) {
  const cleaned = cleanPoint(point);
  let best = 0;
  [10, 8, 6, 4].forEach((n) => {
    if (cleaned.length >= n && transcript.indexOf(cleaned.slice(0, n)) !== -1 && n > best) best = n;
  });
  if (cleaned.length >= 2 && cleaned.length < 4 && transcript.indexOf(cleaned) !== -1) best = cleaned.length;
  const lexHits = LEXICON.filter((w) => point.indexOf(w) !== -1 && transcript.indexOf(w) !== -1);
  const score = (best >= 4 ? 2 : best >= 2 ? 1 : 0) + (lexHits.length >= 2 ? 1 : lexHits.length === 1 ? 1 : 0);
  const status = score >= 3 ? '讲透了' : score >= 1 ? '提到了' : '漏讲';
  const evidence = best >= 4
    ? '讲稿中出现「' + cleaned.slice(0, best) + '」'
    : lexHits.length ? '讲稿涉及：' + lexHits.slice(0, 2).join('、')
    : '讲稿中未找到「' + cleaned.slice(0, 8) + '」相关内容';
  return { point, status, evidence };
}

function ruleCoverage(plan, transcript) {
  const points = extractPoints(plan);
  if (!points.length) {
    return {
      coverage: [],
      missing: [],
      verdict: '离线模式：未能从教案中识别出知识点，建议检查教案格式，或联网获取 AI 对照检查。',
      suggestions: ['把教案的知识点/目标整理成列表再粘贴', '联网后可获得逐条覆盖分析'],
      engine: 'rule',
    };
  }
  const coverage = points.map((p) => ruleMatchOne(p, transcript));
  const covered = coverage.filter((c) => c.status !== '漏讲').length;
  const missing = coverage.filter((c) => c.status === '漏讲').map((c) => c.point.slice(0, 15));
  return {
    coverage,
    missing,
    verdict: '离线模式：关键词粗判，' + coverage.length + ' 个知识点中 ' + covered + ' 个在讲稿中有覆盖（仅供参考）。',
    suggestions: missing.length
      ? ['补讲遗漏知识点：' + missing.slice(0, 3).join('、'), '联网后可获得「讲透 / 提到 / 漏讲」的精细判定']
      : ['联网后可获得「讲透 / 提到 / 漏讲」的精细判定'],
    engine: 'rule',
  };
}

/* ---------------- 主入口 ---------------- */
async function lessonPlanCoverage(input = {}) {
  const plan = String(input.plan || '').trim();
  const transcript = String(input.transcript || '').trim();
  if (plan.length < 10) throw new Error('教案内容太短，请至少粘贴 10 个字');
  if (transcript.length < 10) throw new Error('请先输入试讲逐字稿');

  // 捕获真实错误：模型失败时据此判定降级原因（不许笼统报成一种）
  let modelError = null;
  if (ai.hasKey()) {
    try {
      console.log('[lessonplan] 调用大模型对照教案检查覆盖…');
      const raw = await ai.chat(
        [
          {
            role: 'user',
            content: lessonPlanPrompt({
              plan: plan.slice(0, 3000),
              transcript: transcript.slice(0, 4000),
              subject: input.subject,
            }),
          },
        ],
        { temperature: 0.3, maxTokens: 1200 }
      );
      const json = ai.extractJson(raw);
      if (json && Array.isArray(json.coverage)) {
        return withFallback(
          {
            coverage: json.coverage.slice(0, 10).map((c) => ({
              point: String(c.point || '').slice(0, 40),
              status: ['讲透了', '提到了', '漏讲'].indexOf(c.status) !== -1 ? c.status : '提到了',
              evidence: String(c.evidence || '').slice(0, 60),
            })),
            missing: (Array.isArray(json.missing) ? json.missing : []).map((m) => String(m).slice(0, 20)).slice(0, 8),
            verdict: String(json.verdict || '').slice(0, 80),
            suggestions: (Array.isArray(json.suggestions) ? json.suggestions : []).map((s) => String(s).slice(0, 50)).slice(0, 4),
            engine: 'llm',
          },
          null,
          true
        );
      }
      throw new Error('模型未返回合法 JSON');
    } catch (e) {
      modelError = e;
      console.warn('[lessonplan] 降级本地规则 ->', e && e.message ? e.message : e);
    }
  }
  return withFallback(ruleCoverage(plan, transcript), modelError, ai.hasKey());
}

module.exports = { lessonPlanCoverage };
