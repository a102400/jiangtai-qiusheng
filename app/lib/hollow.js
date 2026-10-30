'use strict';

/**
 * 匿名树洞（32）：试讲翻车后的情绪接住 + 可执行的小建议
 * 双引擎：有 Key 走大模型；无 Key 走关键词分类兜底。
 * 设计原则：先共情、再归因、最后给一个立刻能做的小动作；不评判、不灌鸡汤。
 */

const ai = require('./deepseek');
const { withFallback } = require('./fallback-reason');

function hollowPrompt(text) {
  return `你是一位带过很多届师范生的资深教研员，也是个很会安慰人的前辈。一位实习老师刚在试讲里翻车，来树洞倾诉。

【他说】
${text}

请回一封短信。要求：
1. 第一句先接住情绪——具体指出他难受的点（不要泛泛说"别难过"），像朋友而不是客服。
2. 中间用一句话帮他重新归因：把"我不适合当老师"这类灾难化结论，拆成"某个具体环节没设计好"。
3. 最后给一个 30 秒内就能做的小动作（不是大道理），让他马上有掌控感。
4. 全文 120–180 字，第二人称，口语，温暖但不腻。禁止用"加油""相信自己""你是最棒的"这类空话。
5. 只输出回信正文，不要标题、不要分点、不要 JSON。`;
}

/* ---------------- 本地规则兜底 ---------------- */
const CASES = [
  {
    keys: ['忘词', '卡住', '卡壳', '空白', '想不起来', '断片'],
    open: '讲到一半脑子突然空白，那种当众失重的感觉，比讲错更难受。',
    reframe: '这不是你不会讲，是你把它当成了背诵——背的东西一断就接不上，而讲的东西断了还能绕回来。',
    action: '现在花 30 秒，只给开头那 30 个字写三个关键词，明天开口只说关键词，不许背句子。',
  },
  {
    keys: ['冷场', '没人', '举手', '沉默', '不回答', '安静'],
    open: '问出去没人接，教室里静得能听见自己吞口水，那种尴尬会记很久。',
    reframe: '冷场大多不是学生不给你面子，是问题太大——"谁来回答一下"这种问法，本来就没有人有把握开口。',
    action: '把下一个问题改成两选一，例如"你们觉得是 A 还是 B，举手表决"，先让手举起来，再让人说话。',
  },
  {
    keys: ['笑', '嘲笑', '哄堂', '起哄', '吵', '乱'],
    open: '被学生一笑，那一下脸上发烫、心里发慌，是真的很伤人。',
    reframe: '他们笑的多半是那个瞬间的意外，不是笑你这个人；课堂失控往往只需要你安静三秒就能收回来。',
    action: '下次遇到，先不说话，站着扫视全班五秒，再用很轻的声音说一句话——安静比提高音量更有力量。',
  },
  {
    keys: ['评委', '老师听', '督导', '领导', '打分', '被批评', '评课'],
    open: '有人在下面打分的时候，每一句都像被放大，这种压力很真实。',
    reframe: '评委在意的从来不是你完美，而是你有没有教学意识——一个清楚的提问、一次等学生说完，就足够成为亮点。',
    action: '下一次试讲只盯一个指标：提问后数到三再说话。达标了，这堂课就算成功一半。',
  },
  {
    keys: ['紧张', '手抖', '发抖', '心跳', '腿软', '说不出'],
    open: '上台前心跳到耳朵里，那种身体先于脑子失控的感觉，谁都骗不了自己。',
    reframe: '紧张不是能力问题，是身体在提醒你"这件事很重要"；它不会消失，但可以被安排到开场前两分钟用掉。',
    action: '现在站起来，把开场第一句大声说三遍，说完深吸一口气——真正上台时，身体会记得这句话。',
  },
  {
    keys: ['不想', '放弃', '不适合', '没用', '没天赋', '难过', '哭'],
    open: '会开始怀疑自己适不适合，说明你其实很在乎这件事——不在乎的人不会难受。',
    reframe: '一次讲砸只能说明这一节课的设计有问题，不能推出"我不适合"；这两件事之间差着几十次练习。',
    action: '今晚只做一件事：把你讲得最顺的那两分钟写下来说清楚，提醒自己你不是从零开始。',
  },
];

const FALLBACK = {
  open: '愿意把这件事说出来，本身就比硬撑着强。',
  reframe: '试讲翻车几乎每个师范生都经历过，它证明的是"这次设计没兜住"，不是"你不行"。',
  action: '挑一个最小的动作先做：把开场第一句话写下来，读三遍，明天开口就只练这一句。',
};

function ruleReply(text) {
  const hit = CASES.find((c) => c.keys.some((k) => text.indexOf(k) !== -1)) || FALLBACK;
  return hit.open + hit.reframe + hit.action;
}

/* ---------------- 主入口 ---------------- */
async function hollowComfort(input = {}) {
  const text = String(input.text || '').trim();
  if (text.length < 6) throw new Error('再多说两句吧，树洞在听');
  if (text.length > 800) throw new Error('太长了，先说最扎心的那一段就好');

  // 捕获真实错误：模型失败时据此判定降级原因（不许笼统报成一种）
  let modelError = null;
  if (ai.hasKey()) {
    try {
      console.log('[hollow] 调用大模型写回信…');
      const raw = await ai.chat([{ role: 'user', content: hollowPrompt(text) }], {
        temperature: 0.85,
        maxTokens: 500,
      });
      const reply = String(raw || '').replace(/```/g, '').trim();
      if (reply.length >= 40) return withFallback({ reply, engine: 'llm' }, null, true);
      throw new Error('回复过短');
    } catch (e) {
      modelError = e;
      console.warn('[hollow] 降级本地规则 ->', e && e.message ? e.message : e);
    }
  }
  return withFallback({ reply: ruleReply(text), engine: 'rule' }, modelError, ai.hasKey());
}

module.exports = { hollowComfort };
