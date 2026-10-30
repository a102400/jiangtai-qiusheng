'use strict';

/**
 * 降级原因（fallback_reason）—— 全项目唯一真源
 * ==================================================================
 * 为什么需要这个字段
 * ------------------------------------------------------------------
 * 模型调用失败时，引擎会**静默**降级到本地规则引擎，前端只看到 engine='rule'，
 * 用户根本不知道发生了什么：是没配 Key？是模型欠费了？是被限流了？还是模型报错了？
 * 这四种情况用户要做的动作完全不同（去配 Key / 去充值 / 稍后再试 / 换模型），
 * 所以必须把「为什么降级」显式带出来，不能笼统报成一种。
 *
 * 完整取值表（前端据此提示；这是冻结契约，请勿增删或改写）：
 *   'none'                 本次没有降级（模型成功出结果，或根本没走模型）
 *   'key-not-configured'   没有配置 API Key，从未调用过模型
 *   'rate-limited'         上游限流（HTTP 429）
 *   'insufficient-balance' 模型账号余额不足 / 欠费（HTTP 402）
 *   'auth-failed'          鉴权失败（HTTP 401/403：Key 无效或无权限）
 *   'model-error'          其它模型失败（网络异常、超时、返回格式不合法等）
 *
 * 铁律：**不许伪造**。降级原因必须来自真实的错误信号，
 * 绝不允许把任意失败都报成 'rate-limited'。
 *
 * 为什么单独成一个模块（而不是留在 engine.js 里）
 * ------------------------------------------------------------------
 * heatmap / lessonplan / ifias / hollow / curriculum / panorama / blackboard
 * 这 7 个模块各自独立调用模型、各自 catch 错误。它们的降级原因必须与 engine.js
 * 用同一套判定 —— 否则同一份讲稿在 /api/analyze 报 'rate-limited'、
 * 在 /api/heatmap 却报 'model-error'，前端会弹出两个互相矛盾的提示。
 *
 * 而这 7 个模块反过来要被 engine.js require（engine.js 是编排层），
 * 若把本模块放进 engine.js 就会形成循环依赖。故提取为零依赖的独立模块。
 */

const FALLBACK_REASON = Object.freeze({
  NONE: 'none',
  KEY_NOT_CONFIGURED: 'key-not-configured',
  RATE_LIMITED: 'rate-limited',
  INSUFFICIENT_BALANCE: 'insufficient-balance',
  AUTH_FAILED: 'auth-failed',
  MODEL_ERROR: 'model-error',
});

/**
 * 取上游 HTTP 状态码（兼容多种错误对象的形状）
 * @returns {number|null} 没有状态码时返回 null
 */
function upstreamStatus(error) {
  const s = Number(
    error &&
      (error.status || error.statusCode || (error.response && error.response.status))
  );
  return isFinite(s) && s > 0 ? s : null;
}

/** 取稳定错误码（deepseek.js 打好的 error.code），没有则返回空串 */
function stableCode(error) {
  return String((error && error.code) || '').toLowerCase();
}

/**
 * 是否是「被限流」
 * 优先信结构化信号（上游状态码 / 稳定错误码）；
 * 只有在**完全没有**结构化信号时，才退化为 message 正则 ——
 * 因为 message 里是上游原始 body，文案随厂商变（英文、中文、别的格式都有），不可靠。
 */
function isRateLimitError(error) {
  const status = upstreamStatus(error);
  const code = stableCode(error);
  const message = String((error && error.message) || '');
  if (status !== null || code) {
    return status === 429 || code === 'rate_limit_exceeded';
  }
  return /rate.?limit|too many requests|请求过于频繁|调用频率/i.test(message);
}

/** 是否是「模型欠费」（402 余额不足） */
function isInsufficientBalanceError(error) {
  const status = upstreamStatus(error);
  const code = stableCode(error);
  const message = String((error && error.message) || '');
  if (status !== null || code) {
    return status === 402 || code === 'insufficient_balance';
  }
  return /insufficient.?balance|余额不足|欠费|额度不足|insufficient quota/i.test(message);
}

/** 是否是「鉴权失败」（401/403，Key 无效或无权限） */
function isAuthError(error) {
  const status = upstreamStatus(error);
  const code = stableCode(error);
  const message = String((error && error.message) || '');
  if (status !== null || code) {
    return status === 401 || status === 403 || code === 'auth_failed';
  }
  return /invalid_api_key|invalid api key|unauthorized|forbidden|鉴权|密钥无效|未授权/i.test(message);
}

/** 是否是「压根没配 Key」 */
function isNoKeyError(error) {
  const code = stableCode(error);
  if (code) return code === 'no_api_key';
  return /NO_API_KEY/i.test(String((error && error.message) || ''));
}

/**
 * 把一次模型失败归类成稳定的降级原因。
 * 顺序：先看最确定的信号（没 Key / 限流 / 欠费 / 鉴权），都排除才归到 model-error。
 * 判定全部基于真实错误信号，不猜、不伪造。
 */
function classifyFallbackReason(error) {
  if (isNoKeyError(error)) return FALLBACK_REASON.KEY_NOT_CONFIGURED;
  if (isRateLimitError(error)) return FALLBACK_REASON.RATE_LIMITED;
  if (isInsufficientBalanceError(error)) return FALLBACK_REASON.INSUFFICIENT_BALANCE;
  if (isAuthError(error)) return FALLBACK_REASON.AUTH_FAILED;
  return FALLBACK_REASON.MODEL_ERROR;
}

/**
 * 给任意模块的返回值补上降级信息 —— 7 个模块共用的唯一出口。
 *
 * @param {object}      result      模块原本要返回的对象（须含 engine）
 * @param {Error|null}  error       catch 到的真实错误；没有走模型或没有出错时传 null
 * @param {boolean}     keyPresent  本次是否配置了 API Key
 * @returns {object} 附加了 fallback_reason 的新对象（不修改入参）
 *
 * 判定规则（不许伪造）：
 *   · engine === 'llm'   → 'none'
 *       模型真的成功了。顺带把上游 JSON 里可能混进来的同名字段冲掉 ——
 *       降级原因只能由本地判定，不许由模型自曝。
 *   · 有 Key 但调用失败      → 按真实错误信号分类（429 / 402 / 401 / 其它）
 *   · 压根没配 Key          → 'key-not-configured'（从未调用过模型，不是「调用失败」）
 */
function withFallback(result, error, keyPresent) {
  const out = Object.assign({}, result);

  if (out.engine === 'llm') {
    out.fallback_reason = FALLBACK_REASON.NONE;
    return out;
  }

  out.fallback_reason = keyPresent
    ? classifyFallbackReason(error)
    : FALLBACK_REASON.KEY_NOT_CONFIGURED;

  return out;
}

module.exports = {
  FALLBACK_REASON,
  upstreamStatus,
  stableCode,
  isRateLimitError,
  isInsufficientBalanceError,
  isAuthError,
  isNoKeyError,
  classifyFallbackReason,
  withFallback,
};
