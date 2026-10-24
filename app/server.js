'use strict';

/**
 * 讲台求生 · 全栈后端
 * ------------------------------------------------------------------
 * 零第三方依赖：只用 Node 内置模块（http / fs / path）+ Node 18+ 全局 fetch。
 * 所以不需要 npm install，保存后直接 node server.js 就能跑。
 *
 * 接口：
 *   GET  /api/health        查看当前是真实大模型还是本地演示引擎
 *   POST /api/analyze       复盘分析（讲稿 -> 结构化报告）
 *   POST /api/improve       生成改进稿与教学建议
 *   POST /api/student/chat  AI 学生多轮对话（拆台核心）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------------- 极简 .env 加载（不装 dotenv） ---------------- */
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m || line.trim().startsWith('#')) return;
      let val = (m[2] || '').trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
  } catch (e) {
    // 没有 .env 文件是正常情况，跳过
  }
}
// 必须在 require 业务模块之前加载，否则模块加载时读不到环境变量
loadEnv(path.join(__dirname, '.env'));

const engine = require('./lib/engine');
const transcribe = require('./lib/transcribe');
const exporter = require('./lib/export');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

/* ---------------- 安全与限流配置 ---------------- */
const SHARECODE = (process.env.SHARECODE || '').trim();            // 留空=不启用（本地开发）；部署时填与页面网关一致的码
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').trim();  // 留空=*；生产填具体域名，如 https://xxx.workbuddy.host
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;       // 音频/视频上传上限（MB）
const TRANSCRIPT_MAX_CHARS = Number(process.env.TRANSCRIPT_MAX_CHARS) || 20000; // 单条讲稿字符上限，遏制 LLM 成本

// 开放端点：不校验 sharecode（只读、无 LLM 成本）
const OPEN_ENDPOINTS = new Set(['/api/health', '/api/drill/skills']);

// sharecode 读取：查询参数或自定义请求头（前端 post/上传走头，导出表单走查询）
function getShareCode(req, url) {
  const fromQuery = url.searchParams.get('sharecode');
  if (fromQuery) return fromQuery.trim();
  return String(req.headers['x-share-code'] || '').trim();
}
function checkShareCode(req, url) {
  if (!SHARECODE) return true;                  // 未配置则不拦截，保持本地兼容
  if (OPEN_ENDPOINTS.has(url.pathname)) return true;
  return getShareCode(req, url) === SHARECODE;
}

/* ---- 限流：每客户端 IP 滑动窗口 ---- */
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60000;
const RATE_MAX_PER_IP = Number(process.env.RATE_MAX_PER_IP) || 30;
const rateBuckets = new Map(); // ip -> number[]（请求时间戳）
function rateLimited(ip) {
  const now = Date.now();
  let arr = rateBuckets.get(ip);
  if (!arr) { arr = []; rateBuckets.set(ip, arr); }
  while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
  if (arr.length >= RATE_MAX_PER_IP) return true;
  arr.push(now);
  return false;
}
// 定期回收空桶，避免长期内存占用
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of rateBuckets) {
    while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
    if (arr.length === 0) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

/* ---- 全局并发闸：限制同时进行的昂贵请求（LLM/转写） ---- */
const GLOBAL_CONCURRENCY = Number(process.env.GLOBAL_CONCURRENCY) || 8;
let activeHeavy = 0;
const heavyQueue = [];
function acquireHeavy() {
  return new Promise((resolve) => {
    if (activeHeavy < GLOBAL_CONCURRENCY) { activeHeavy++; resolve(); }
    else heavyQueue.push(resolve);
  });
}
function releaseHeavy() {
  activeHeavy--;
  if (heavyQueue.length) { activeHeavy++; heavyQueue.shift()(); }
}

/* ---------------- 工具 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('上传文件超过大小上限'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 手写 multipart 解析：避免为了一个上传功能引入 multer 之类的第三方依赖
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delim = Buffer.from('--' + boundary);
  const positions = [];
  let idx = buffer.indexOf(delim);
  while (idx !== -1) {
    positions.push(idx);
    idx = buffer.indexOf(delim, idx + delim.length);
  }
  // 最后一段是结束标记 "--boundary--"，因此只遍历到 length-1
  for (let i = 0; i < positions.length - 1; i++) {
    const body = buffer.slice(positions[i] + delim.length, positions[i + 1]);
    const headerEnd = body.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = body.slice(2, headerEnd).toString('utf8'); // 去掉开头的 CRLF
    const content = body.slice(headerEnd + 4, Math.max(headerEnd + 4, body.length - 2)); // 去掉结尾 CRLF
    const nameM = headers.match(/name="([^"]*)"/);
    const fileM = headers.match(/filename="([^"]*)"/);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : '',
      data: content,
    });
  }
  return parts;
}

function readJsonBody(req, limitBytes) {
  const limit = limitBytes || 1024 * 1024; // 默认 1MB，讲稿文本够用
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      // 支持 urlencoded 表单（导出报告用隐藏表单 POST 新窗口打开）
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/x-www-form-urlencoded')) {
        const obj = {};
        for (const pair of raw.split('&')) {
          const i = pair.indexOf('=');
          if (i === -1) continue;
          obj[decodeURIComponent(pair.slice(0, i).replace(/\+/g, ' '))] =
            decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
        }
        return resolve(obj);
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

async function handleUpload(req, res) {
  const ct = String(req.headers['content-type'] || '');
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!ct.startsWith('multipart/form-data') || !bm) {
    return sendJson(res, 400, { ok: false, error: '需要 multipart/form-data 格式' });
  }
  const boundary = bm[1] || bm[2];
  let filePath = null;
  try {
    const buffer = await readRawBody(req, MAX_UPLOAD_MB * 1024 * 1024); // 上传上限（默认 50MB，可在 .env 调整）
    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find((p) => p.filename);
    if (!filePart || !filePart.data || filePart.data.length === 0) {
      return sendJson(res, 400, { ok: false, error: '没有收到有效文件' });
    }

    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const safeName = Date.now() + '_' + String(filePart.filename).replace(/[^\w.\-]/g, '_');
    filePath = path.join(UPLOAD_DIR, safeName);
    await fs.promises.writeFile(filePath, filePart.data);
    console.log('[upload] 收到文件：' + filePart.filename + '（' + Math.round(filePart.data.length / 1024) + ' KB）');

    const result = await transcribe.transcribe(filePath, {});

    if (result && result.ok) {
      return sendJson(res, 200, {
        ok: true,
        transcribed: true,
        transcript: result.text || '',
        durationSec: Math.round(result.duration || 0),
        segments: result.segments || [],
        source: result.source || 'unknown',
      });
    }
    // 转写环境不可用：明确告诉前端，引导用户改用文本输入，而不是让页面崩掉
    return sendJson(res, 200, {
      ok: true,
      transcribed: false,
      transcript: '',
      durationSec: 0,
      reason: (result && (result.reason || result.error)) || '转写环境不可用',
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message || '处理上传失败' });
  } finally {
    if (filePath) fs.promises.unlink(filePath).catch(() => {});
  }
}

/* 板书图片评分：multipart 上传后交给 engine.blackboard */
async function handleBlackboard(req, res, bodyMeta) {
  const ct = String(req.headers['content-type'] || '');
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!ct.startsWith('multipart/form-data') || !bm) {
    return sendJson(res, 400, { ok: false, error: '需要 multipart/form-data 格式' });
  }
  const boundary = bm[1] || bm[2];
  let filePath = null;
  try {
    const buffer = await readRawBody(req, 20 * 1024 * 1024); // 板书照片 20MB 足够
    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find((p) => p.filename);
    const metaField = parts.find((p) => p.name === 'meta');
    let meta = {};
    if (metaField) { try { meta = JSON.parse(metaField.data.toString('utf8')); } catch (e) { /* ignore */ } }
    if (!filePart || !filePart.data || filePart.data.length === 0) {
      return sendJson(res, 400, { ok: false, error: '没有收到有效图片' });
    }
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    filePath = path.join(UPLOAD_DIR, 'bb_' + Date.now() + '_' + String(filePart.filename).replace(/[^\w.\-]/g, '_'));
    await fs.promises.writeFile(filePath, filePart.data);
    const data = await engine.blackboard({ imagePath: filePath, subject: meta.subject, grade: meta.grade });
    return sendJson(res, 200, { ok: true, data });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message || '板书评分失败' });
  } finally {
    if (filePath) fs.promises.unlink(filePath).catch(() => {});
  }
}

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 防目录穿越：规范化后必须仍位于 PUBLIC_DIR 内（覆盖 Windows 大小写/符号链接/.. 等）
  const resolved = path.resolve(PUBLIC_DIR, rel.replace(/^\/+/, ''));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { ok: false, error: '禁止访问' });
  }
  let filePath = resolved;

  try {
    let stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fs.promises.stat(filePath).catch(() => null);
    }
    if (!stat || !stat.isFile()) {
      return sendJson(res, 404, { ok: false, error: '页面不存在' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: '静态资源读取失败' });
  }
}

/* ---------------- API 路由 ---------------- */
async function handleApi(req, res, pathname) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 限流（按客户端 IP 滑动窗口）
  const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0].trim();
  if (rateLimited(clientIp)) {
    return sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍后再试' });
  }

  // sharecode 网关：与线上页面网关保持一致（未配置则不拦截，本地开发兼容）
  if (!checkShareCode(req, url)) {
    return sendJson(res, 403, { ok: false, error: '缺少或错误的 sharecode' });
  }

  const needsHeavy = !OPEN_ENDPOINTS.has(pathname);
  if (needsHeavy) await acquireHeavy();
  // 外层 try/finally：保证 releaseHeavy() 在任何路径（早退 return、异常抛出）下都被调用。
  // 闸门漏一次释放会让后续所有请求永久挂起，所以 finally 必须挂在这一层。
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
    const mode = engine.mode();
    return sendJson(res, 200, {
      ok: true,
      ...mode,
      tip: mode.hasKey
        ? `已接入真实大模型（${mode.model}）`
        : '未检测到 API Key，当前使用本地规则引擎（演示模式，仍会给出基于真实计算的报告）',
    });
  }

  // 专项技能清单：只读接口（GET / POST 均按契约返回 405 / 200）
  if (pathname === '/api/drill/skills') {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: '该接口只支持 GET' });
    }
    const data = engine.drillSkills();
    return sendJson(res, 200, { ok: true, data });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: '只支持 POST' });
  }

  // 视频上传是 multipart，不走 JSON 解析
  if (pathname === '/api/transcribe') {
    // 必须 await：直接 return promise 会让外层 finally 提前释放并发闸门
    return await handleUpload(req, res);
  }
  if (pathname === '/api/blackboard') {
    return await handleBlackboard(req, res);
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }

  // 讲稿长度上限：遏制 LLM 成本与异常输入
  if (typeof body.transcript === 'string' && body.transcript.length > TRANSCRIPT_MAX_CHARS) {
    return sendJson(res, 400, { ok: false, error: `讲稿过长（上限 ${TRANSCRIPT_MAX_CHARS} 字）` });
  }
  if (Array.isArray(body.sessions)) {
    const total = body.sessions.reduce(
      (s, x) => s + (typeof (x && x.transcript) === 'string' ? x.transcript.length : 0), 0
    );
    if (total > TRANSCRIPT_MAX_CHARS * 5) {
      return sendJson(res, 400, { ok: false, error: '多课讲稿总量过大' });
    }
  }

  try {
    if (pathname === '/api/analyze') {
      const data = await engine.analyze({
        transcript: body.transcript,
        subject: body.subject,
        grade: body.grade,
        durationSec: body.durationSec,
        subjectKey: body.subjectKey, // 前端手动选的学科；auto 时 engine 内部走智能识别
      });
      return sendJson(res, 200, { ok: true, data });
    }

    if (pathname === '/api/improve') {
      const data = await engine.improve({
        transcript: body.transcript,
        analysis: body.analysis,
        subject: body.subject,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    if (pathname === '/api/student/chat') {
      const data = await engine.studentChat({
        messages: body.messages,
        persona: body.persona,
        customPersona: body.customPersona,
        topic: body.topic,
        transcript: body.transcript,
        profile: body.profile, // 新增可选字段：学情快照；缺失时行为与改造前完全一致
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // 复盘报告导出：返回自包含可打印 HTML（浏览器 Ctrl+P 存 PDF）
    // 兼容两种提交：application/json 直接是 {report,meta}；或表单字段 json=<JSON字符串>
    if (pathname === '/api/export') {
      let report = body && body.report;
      let meta = (body && body.meta) || {};
      if (!report && body && typeof body.json === 'string') {
        try {
          const parsed = JSON.parse(body.json);
          report = parsed.report;
          meta = parsed.meta || {};
        } catch (e) { /* 下面统一报参数错误 */ }
      }
      if (!report || typeof report !== 'object') {
        return sendJson(res, 400, { ok: false, error: '缺少 report 字段' });
      }
      // kind=form → 师范院校标准考核表；默认 → 图文复盘报告
      const html = meta.kind === 'form'
        ? exporter.buildEvaluationForm(report, meta)
        : exporter.buildExportHtml(report, meta);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'inline; filename="report.html"',
      });
      return res.end(html);
    }

    // ---- 课堂崩塌模拟 ----
    if (pathname === '/api/crisis/start') {
      const data = await engine.crisisStart({
        eventId: body.eventId,
        lastEventId: body.lastEventId,
        round: body.round,
        scoreHistory: body.scoreHistory,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    if (pathname === '/api/crisis/respond') {
      const data = await engine.crisisRespond({
        eventId: body.eventId,
        response: body.response,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 三学生课堂（多人同时在线 + 压力系统） ----
    if (pathname === '/api/classroom/round') {
      const data = await engine.classroomRound({
        topic: body.topic,
        transcript: body.transcript,
        teacherAnswer: body.teacherAnswer,
        pressure: body.pressure,
        history: body.history,
        profile: body.profile, // 新增可选字段：学情快照；缺失时行为与改造前完全一致
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 危险瞬间摘录 ----
    if (pathname === '/api/danger') {
      const data = await engine.dangerMoments({
        transcript: body.transcript,
        analysis: body.analysis,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 3 分钟专项技能练习 ----
    if (pathname === '/api/drill') {
      if (!body.skill || !String(body.skill).trim()) {
        return sendJson(res, 400, { ok: false, error: '缺少 skill 字段' });
      }
      if (!body.transcript || !String(body.transcript).trim()) {
        return sendJson(res, 400, { ok: false, error: '缺少 transcript 字段' });
      }
      let data;
      try {
        data = await engine.drill({
          skill: body.skill,
          transcript: body.transcript,
          durationSec: body.durationSec,
          task: body.task,
          profile: body.profile,
          subject: body.subject,
          subjectKey: body.subjectKey,
          grade: body.grade,
        });
      } catch (e) {
        // 参数类错误（未知技能 / 内容过短）→ 400；未知技能按契约返回 404
        const msg = e.message || '练习评分失败';
        if (msg.indexOf('未知技能') === 0) {
          return sendJson(res, 404, { ok: false, error: msg });
        }
        return sendJson(res, 400, { ok: false, error: msg });
      }
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 课标对照（2022 版） ----
    if (pathname === '/api/curriculum') {
      const data = await engine.curriculum({
        transcript: body.transcript,
        subject: body.subject,
        subjectKey: body.subjectKey,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 教案导入：对照检查知识点覆盖 ----
    if (pathname === '/api/lesson-plan') {
      const data = await engine.lessonPlan({
        plan: body.plan,
        transcript: body.transcript,
        subject: body.subject,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- iFIAS 课堂互动编码分析 ----
    if (pathname === '/api/ifias') {
      const data = await engine.ifias({
        transcript: body.transcript,
        subject: body.subject,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 多节课互动结构轨迹（PCA + 跨课聚类） ----
    if (pathname === '/api/ifias-batch') {
      const data = await engine.ifiasBatch({ sessions: body.sessions });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 匿名树洞：AI 安慰 ----
    if (pathname === '/api/hollow') {
      const data = await engine.hollow({ text: body.text });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 课堂可视化三件套（等待热力图 + 时间分配 + 分环节改进稿） ----
    if (pathname === '/api/heatmap') {
      const data = await engine.classroomMetricsView({
        transcript: body.transcript,
        subject: body.subject,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    // ---- 六视角全景透视 ----
    if (pathname === '/api/panorama') {
      const data = await engine.panorama({
        subject: body.subject,
        transcript: body.transcript,
        analysis: body.analysis,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    if (pathname === '/api/compare') {
      const data = await engine.compare({
        transcriptA: body.transcriptA,
        transcriptB: body.transcriptB,
        subject: body.subject,
      });
      return sendJson(res, 200, { ok: true, data });
    }

    return sendJson(res, 404, { ok: false, error: '接口不存在' });
  } catch (e) {
    console.error('[api error]', pathname, e);
    // 响应已发出时不能再写头，否则抛 ERR_HTTP_HEADERS_SENT
    if (!res.headersSent) {
      return sendJson(res, 500, { ok: false, error: e.message || '服务器内部错误' });
    }
    return;
  }
  } catch (e) {
    // 外层兜底：早退路径（上传 / 读体 / 未捕获异常）出错时也要给出响应
    console.error('[api error]', pathname, e);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: e.message || '服务器内部错误' });
    }
  } finally {
    // 并发闸门释放：必须在此层，任何路径都会执行
    if (needsHeavy) releaseHeavy();
  }
}

/* ---------------- 启动 ---------------- */
const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch (e) {
    pathname = '/';
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN || '*'); // 生产建议用 ALLOWED_ORIGIN 限定域名
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (e) {
    console.error('[server error]', e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
});

// 绑定 0.0.0.0：本地可用 localhost 访问，云端部署时也能被外部正确访问
server.listen(PORT, '0.0.0.0', () => {
  const mode = engine.mode();
  console.log('');
  console.log('  ██████  讲台求生 · 全栈服务已启动');
  console.log('');
  console.log(`  本地访问：  http://localhost:${PORT}`);
  console.log(`  AI 模式：   ${mode.hasKey ? '● 真实大模型（' + mode.model + '）' : '○ 演示模式（本地规则引擎）'}`);
  if (!mode.hasKey) {
    console.log('             提示：复制 .env.example 为 .env 并填入 AI_API_KEY，即可切换为真实模型');
  }
  console.log('');
});
