'use strict';

/**
 * 语音转写模块（双通道）
 * ------------------------------------------------------------------
 * 通道 A（优先）：本地 faster-whisper —— 离线、免费、不断网，黑客松现场首选
 * 通道 B（备选）：云端 Whisper API —— 需要 OpenAI 兼容的音频接口与 Key
 * 都没有：返回 available:false，前端引导用户粘贴文本（MVP 保底路径）
 *
 * 之所以把本地放在第一位：现场网络不稳时，云端接口是最大的风险点。
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { toSimplified, needsConversion } = require('./zh-simplify');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

// ffmpeg 不一定在系统 PATH 里（按项目安装纪律装在 D 盘），逐个候选探测
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  'D:/Tools/ffmpeg/bin/ffmpeg.exe',
  'ffmpeg',
].filter(Boolean);

// 本地离线模型的候选目录（%s 是模型尺寸）
const MODEL_SIZES = ['small', 'base', 'tiny', 'medium'];
const DEFAULT_MODEL_SIZE = 'small';
const MODEL_DIR_PATTERNS = [
  process.env.WHISPER_MODEL_DIR,
  'D:/Tools/whisper-models/Systran/faster-whisper-%s',
  'D:/Tools/whisper-models/faster-whisper-%s',
  'D:/Tools/whisper-models/%s',
].filter(Boolean);
const PY_CANDIDATES = [
  process.env.PYTHON_PATH,
  // 项目专用环境（装在 D 盘，含 faster-whisper）
  'D:/Tools/jiangtai-whisper/venv/Scripts/python.exe',
  'C:/Users/ASUS/.workbuddy/binaries/python/envs/default/Scripts/python.exe',
  'C:/Users/ASUS/.workbuddy/binaries/python/versions/3.13.12/python.exe',
  'python',
  'python3',
].filter(Boolean);

let capabilityCache = null;

/* ---------------- 能力探测（结果缓存） ---------------- */
function detect() {
  if (capabilityCache) return capabilityCache;

  const result = { ffmpeg: false, fasterWhisper: false, python: null, cloud: false, localModels: [] };

  // 1. ffmpeg（记住命中的那个，后续可直接用绝对路径调用）
  let ffmpegBin = null;
  for (const ff of FFMPEG_CANDIDATES) {
    const probe = spawnSync(ff, ['-version'], { windowsHide: true });
    if (!probe.error && probe.status === 0) { ffmpegBin = ff; break; }
  }
  result.ffmpeg = Boolean(ffmpegBin);
  result.ffmpegBin = ffmpegBin;

  // 2. python + faster_whisper
  for (const py of PY_CANDIDATES) {
    const probe = spawnSync(py, ['-c', 'import faster_whisper; print(faster_whisper.__version__)'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (!probe.error && probe.status === 0) {
      result.python = py;
      result.fasterWhisper = true;
      break;
    }
    // 记录能用的 python（哪怕没装 whisper）
    const verProbe = spawnSync(py, ['--version'], { windowsHide: true, encoding: 'utf8' });
    if (!result.python && !verProbe.error && verProbe.status === 0) {
      result.python = py;
    }
  }

  // 3. 本地离线模型目录（有了它，断网也能转写）
  for (const size of MODEL_SIZES) {
    for (const pat of MODEL_DIR_PATTERNS) {
      const dir = pat.replace('%s', size);
      if (fs.existsSync(path.join(dir, 'model.bin'))) {
        result.localModels.push({ size, dir });
        break;
      }
    }
  }

  // 4. 云端音频接口
  result.cloud = Boolean(process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY);

  capabilityCache = result;
  return result;
}

/** 把模型名映射成本地目录（若有），用于纯离线转写 */
function resolveLocalModel(size) {
  const cap = detect();
  const hit = cap.localModels.find((m) => m.size === (size || DEFAULT_MODEL_SIZE));
  return hit ? hit.dir : size || DEFAULT_MODEL_SIZE;
}

/* ---------------- 通道 A：本地转写 ---------------- */
function transcribeLocal(filePath, modelSize) {
  const cap = detect();
  // 注意：不再强制要求系统安装 ffmpeg —— 转写脚本已改用 PyAV 解码音视频
  if (!cap.fasterWhisper || !cap.python) {
    return Promise.resolve({
      ok: false,
      available: false,
      reason: '未检测到 Python 环境的 faster-whisper（执行 pip install faster-whisper 后即可）',
    });
  }
  if (cap.localModels.length === 0 && !cap.cloud) {
    return Promise.resolve({
      ok: false,
      available: false,
      reason: '未找到本地能用的离线模型，且未配置云端 Key',
    });
  }

  // 本地有模型就传目录路径（纯离线），否则退回尺寸名让它自行下载
  const modelArg = resolveLocalModel(modelSize);

  return new Promise((resolve) => {
    const env = Object.assign({}, process.env);
    if (cap.ffmpegBin) env.FFMPEG_BIN = cap.ffmpegBin;   // 供 Python 备用解码使用
    if (env.WHISPER_MODEL_DIR) env.WHISPER_MODEL_DIR = String(env.WHISPER_MODEL_DIR);
    const child = spawn(cap.python, [path.join(SCRIPTS_DIR, 'transcribe.py'), filePath, modelArg], {
      windowsHide: true,
      env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000); // 10 分钟兜底
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out);
        return resolve(json);
      } catch (e) {
        return resolve({ ok: false, error: '本地转写未返回有效结果：' + (err || out || '').slice(0, 300) });
      }
    });
    child.on('error', (e) => resolve({ ok: false, error: String(e.message) }));
  });
}

/* ---------------- 通道 B：云端 Whisper API ---------------- */
async function transcribeCloud(filePath) {
  const key = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY;
  const baseUrl = (process.env.WHISPER_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!key) return { ok: false, available: false, reason: '未配置音频接口 Key' };

  try {
    // 云端接口普遍有单文件体积上限（OpenAI 25MB），提前拦下比拿到 413 更友好
    const stat = await fs.promises.stat(filePath);
    const mb = stat.size / 1024 / 1024;
    if (mb > 25) {
      return {
        ok: false,
        error: `文件 ${mb.toFixed(1)}MB 超过云端接口 25MB 上限，请先压缩或裁剪片段后再上传`,
      };
    }

    const buffer = await fs.promises.readFile(filePath);
    // Node 18+ 内置 FormData / Blob，无需 multer 之类的第三方库
    const ext = path.extname(filePath).toLowerCase();
    const mime = /\.(mp3|mpeg)$/.test(ext) ? 'audio/mpeg'
      : /\.m4a$/.test(ext) ? 'audio/mp4'
      : /\.wav$/.test(ext) ? 'audio/wav'
      : /\.webm$/.test(ext) ? 'audio/webm'
      : 'video/mp4';

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), path.basename(filePath));
    form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
    form.append('language', 'zh');
    // verbose_json 才能拿到带时间戳的分段 —— 前端语速曲线依赖 segments
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await res.text();

    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? 'Key 无效或没有该模型的权限'
        : res.status === 429 ? '请求过于频繁或额度不足'
        : res.status === 413 ? '文件过大'
        : '接口调用失败';
      return { ok: false, error: `转写失败（${res.status}，${hint}）：${text.slice(0, 200)}` };
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      // 个别兼容服务即使指定了 verbose_json 仍只返回纯文本
      return { ok: true, text: text.trim(), duration: 0, segments: [], source: 'cloud-whisper' };
    }

    // 统一成与本地转写一致的结构，前端无需区分来源
    const segments = Array.isArray(json.segments)
      ? json.segments.map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || '').trim(),
        })).filter((s) => s.text)
      : [];

    return {
      ok: true,
      text: (json.text || segments.map((s) => s.text).join('') || '').trim(),
      duration: json.duration || (segments.length ? segments[segments.length - 1].end : 0),
      segments,
      source: 'cloud-whisper',
    };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

/* ---------------- 繁简归一 ----------------
 * 本地 faster-whisper small 对中文语音会输出繁体（实测原样输出：
 * 「汽車車身的設計和製造,不僅關乎美觀與性能」）。而本项目的
 * iFIAS 编码判据、标注手册、报告文案全部是简体：
 * 「請/說/課/題/覺/聽」这些字都不会命中关键词表，
 * 结果是整段话被兜底判成「讲授(5)」——教师语言占比、互动率全线失真。
 * 云端 Whisper 一般返回简体，但统一过一遍没有副作用，所以两条通道都走。
 * 转换表由 scripts/build-zh-simplify-table.js 从 OpenCC 字典生成，零依赖。
 */
function normalizeSimplified(r) {
  if (!r || !r.ok) return r;
  let touched = false;
  const out = Object.assign({}, r);
  if (typeof r.text === 'string' && needsConversion(r.text)) {
    out.text = toSimplified(r.text);
    touched = true;
  }
  if (Array.isArray(r.segments)) {
    out.segments = r.segments.map((s) => {
      if (s && typeof s.text === 'string' && needsConversion(s.text)) {
        touched = true;
        return Object.assign({}, s, { text: toSimplified(s.text) });
      }
      return s;
    });
  }
  if (touched) {
    // 保留原始输出，便于事后量化「繁简归一到底改了多少」。
    // 只在实际发生转换时带上，避免正常情况多传一份文本。
    if (typeof r.text === 'string') out.text_raw = r.text;
    out.zh_normalized = true;
  }
  return out;
}

/* ---------------- 统一入口 ---------------- */
async function transcribe(filePath, opts = {}) {
  return normalizeSimplified(await transcribeRaw(filePath, opts));
}

async function transcribeRaw(filePath, opts = {}) {
  const prefer = opts.prefer || process.env.TRANSCRIBE_MODE || 'auto';

  if (prefer === 'cloud') {
    const c = await transcribeCloud(filePath);
    if (c.ok || !c.available) return c;
  }

  const local = await transcribeLocal(filePath, opts.modelSize);
  if (local.ok) return local;
  if (local.available === false && prefer !== 'local') {
    const cloud = await transcribeCloud(filePath);
    if (cloud.ok) return cloud;
    return {
      ok: false,
      available: false,
      reason: local.reason || cloud.reason || '本地与云端转写均不可用',
    };
  }
  return local;
}

module.exports = { transcribe, detect };
