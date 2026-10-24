'use strict';

/**
 * 课堂崩塌模拟器 · 事件引擎
 * ------------------------------------------------------------------
 * 模拟完整课堂突发事故链：设备断电、学生吵架、家长推门、学生哭了……
 * 每次老师应对后，按 FIAS（弗兰德斯互动分析）量化「控场得分」。
 * 与 studentChat 共用 LLM，无 Key 时降级为本地事件卡 + 规则评分。
 */

/* ---------------- 事件卡池 ---------------- */
const CRISIS_EVENTS = [
  {
    id: 'power',
    title: '⚡ 投影仪突然断电',
    desc: '你正讲到关键推导，教室投影「啪」一声黑了，PPT 全没了。学生开始骚动。',
    persona: 'naughty',
    hint: '考察：临场应变 / 是否还能脱离课件继续讲课',
    rule_score: { reinforce: ['继续讲', '板书', '没关系', '不要紧', '我们继续'], weaken: ['怎么办', '等一下', '大家安静', '暂停'] },
    fallback_replies: ['老师！黑屏了！这节课是不是不用上了？', '老师你的 PPT 没了，那你还会讲吗？'],
  },
  {
    id: 'fight',
    title: '💢 后排两名学生吵起来了',
    desc: '后排两个学生因为借橡皮吵起来，声音越来越大，全班都在看热闹。',
    persona: 'naughty',
    hint: '考察：课堂管理 / 处理冲突时是否兼顾教学连续性',
    rule_score: { reinforce: ['冷静', '先', '课后', '我们来看', '回到'], weaken: ['都给我', '滚', '站起来', '罚站', '吵什么'] },
    fallback_replies: ['老师，是他先抢我橡皮的！', '他推我！你看到没老师！'],
  },
  {
    id: 'parent',
    title: '🚪 家长突然推门而入',
    desc: '一位家长推开后门，站在教室后面，脸色不太好看，说「我就看一眼」。全班目光转向门口。',
    persona: 'drift',
    hint: '考察：情绪稳定 / 教学节奏是否被打断',
    rule_score: { reinforce: ['欢迎', '请坐', '我们继续', '不好意思', '稍后'], weaken: ['谁让你', '出去', '干什么', '怎么进来的'] },
    fallback_replies: ['老师，我妈怎么来了……', '（全班哄笑，有人小声起哄）'],
  },
  {
    id: 'cry',
    title: '😢 有学生趴在桌上哭了',
    desc: '一个女生突然趴在桌上哭，肩膀在抖。周围同学在递纸巾，有人在看你。',
    persona: 'drift',
    hint: '考察：人文关怀 / 是否关注个体又不冷落全班',
    rule_score: { reinforce: ['没事', '关心', '陪你', '班长', '照顾', '我们继续'], weaken: ['哭什么', '别哭了', '出去哭', '多大点事'] },
    fallback_replies: ['老师……她好像是压力太大了，上周考试没考好……', '（她还是趴着，同桌在拍她的背）'],
  },
  {
    id: 'chaos',
    title: '🎈 教室后排炸开了锅',
    desc: '不知谁把一个气球踩爆了，后排像炸锅一样，笑声、起哄声混成一片，你说的最后一句话完全被淹没。',
    persona: 'naughty',
    hint: '考察：音量控制 / 快速镇场的技巧',
    rule_score: { reinforce: ['安静', '看着我', '深呼吸', '倒数', '1分钟'], weaken: ['闭嘴', '都别说话', '谁干的', '举报'] },
    fallback_replies: ['哈哈哈哈哈哈不是吧谁带的气球！', '老师他也踩了！不止我一个人！'],
  },
  {
    id: 'phone',
    title: '📱 学生当众玩手机被抓包',
    desc: '你看到有个学生一直低头，走近才发现他在打游戏，还外放出了声音。周围同学在偷笑。',
    persona: 'naughty',
    hint: '考察：处理个体问题时的权力边界与分寸',
    rule_score: { reinforce: ['先收', '下课', '课后再说', '我们继续', '相信你'], weaken: ['没收', '砸', '滚出去', '叫家长', '全班'] },
    fallback_replies: ['老师我马上就打完了！就差最后一下！', '为什么只说我，他也在玩！'],
  },
];

/* ---------------- FIAS 控场评分 ---------------- */
/*
 * 简化 FIAS 量化模型（可解释，评委好懂）：
 * - reinforce（强化）：肯定/接纳学生情感、继续教学主线 → +分
 * - neutral（中立）：单纯指令、提问 → 不扣不加
 * - weaken（削弱）：否定情感、惩罚性语言、节奏彻底中断 → 扣分
 * 控场得分 = 60 + Σ(强化词命中×8) - Σ(削弱词命中×15)，夹在 0-100
 */
function ruleScoreResponse(eventId, response) {
  const ev = CRISIS_EVENTS.find((e) => e.id === eventId) || CRISIS_EVENTS[0];
  const text = String(response || '');
  let delta = 0;
  const hits = { reinforce: [], weaken: [] };
  for (const w of ev.rule_score.reinforce) {
    if (text.includes(w)) { delta += 8; hits.reinforce.push(w); }
  }
  for (const w of ev.rule_score.weaken) {
    if (text.includes(w)) { delta -= 15; hits.weaken.push(w); }
  }
  if (text.trim().length < 6) delta -= 10; // 冷场/沉默过短
  if (text.trim().length > 150) delta -= 5; // 说太多，节奏拖
  const score = Math.max(0, Math.min(100, 60 + delta));
  const grade = score >= 80 ? '优秀' : score >= 65 ? '合格' : '需改进';
  return {
    score,
    grade,
    dimension: ev.hint.replace('考察：', ''),
    feedback: buildRuleFeedback(hits, score),
    hits,
  };
}

function buildRuleFeedback(hits, score) {
  if (score >= 80) {
    return '你的应对兼顾了学生情绪和教学主线，FIAS 属「强化」区。' +
      (hits.reinforce.length ? '命中关键词：' + hits.reinforce.join('、') + '。' : '');
  }
  if (score >= 65) {
    return '应对基本过关，但处理偏「指令型」，还可以更多接纳学生情绪（FIAS 中立区）。';
  }
  return '本次应对偏「削弱」：' +
    (hits.weaken.length ? '出现了惩罚/否定性语言（' + hits.weaken.join('、') + '）。' : '回应过短或节奏中断。') +
    '试着先稳情绪、再回教学主线。';
}

/* ---------------- 随机抽卡（避免连续重复） ---------------- */
function pickEvent(lastId) {
  const pool = CRISIS_EVENTS.filter((e) => e.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- 教学环节加权抽卡 ----------------
 * 课堂事故强度应随教学环节递进：
 * 第 1 轮（导入期）→ 轻事故（手机/哄堂，干扰小）
 * 第 2-3 轮（讲授期）→ 中事故（吵架/断电，打断主线）
 * 第 4 轮起（后半场）→ 重事故（家长/哭，考验人文关怀）
 */
const PHASE_POOLS = [
  ['phone', 'chaos'],          // 导入期：轻
  ['power', 'fight', 'chaos'], // 讲授期：中
  ['parent', 'cry', 'fight'],  // 后半场：重
];

function pickEventByPhase(round, lastId) {
  const r = Math.max(0, Number(round) || 0);
  const poolIds = PHASE_POOLS[Math.min(r, PHASE_POOLS.length - 1)];
  let pool = CRISIS_EVENTS.filter((e) => poolIds.includes(e.id) && e.id !== lastId);
  if (pool.length === 0) pool = CRISIS_EVENTS.filter((e) => e.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------------- 次生事故判定 ----------------
 * 上一次控场得分 < 60 且分数继续走低时，课堂失控升级：
 * 返回升级事件（哄堂/吵架），desc 前缀标注「失控升级」。
 */
const ESCALATION = {
  from: ['power', 'phone', 'parent'],
  to: 'chaos',
  title: '🔴 失控升级：全班彻底炸锅',
  desc: '因为刚才的事故没处理好，骚动像多米诺一样扩散——现在不止后排，全班都在说话，有人开始起哄，有人已经趴下了。',
  hint: '考察：危机升级后的止损能力 / 是否敢于果断改变教学策略',
};

function shouldEscalate(scoreHistory) {
  const h = (scoreHistory || []).map(Number).filter((x) => !isNaN(x));
  if (h.length < 1) return false;
  const last = h[h.length - 1];
  if (h.length >= 2) return last < 60 && h[h.length - 2] < 65; // 连续两次失分
  return last < 50; // 单次严重失控
}

module.exports = {
  CRISIS_EVENTS,
  pickEvent,
  pickEventByPhase,
  shouldEscalate,
  ESCALATION,
  ruleScoreResponse,
};
