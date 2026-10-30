'use strict';

/**
 * 录音 → 语料：把试讲录音批量转成可标注的纯文本
 * ----------------------------------------------------------------------------
 * 解决的是这条链路上唯一缺的一环：
 *   录音(mp3/m4a/wav) → [本脚本：whisper 转写] → annotation/corpus/*.txt
 *   → build-annotation-set.js 切句分层抽样 → 标注页 → cohen-kappa.js
 *
 * 设计取舍（每一条都会影响数据能不能用）：
 *   1. .txt 里只放纯转写，不放任何表头/元信息。切句器会把表头当课堂话语切进样本，
 *      一旦混进去就是数据污染。所有元信息写进同目录的 manifest.json。
 *   2. 已有同名 .txt 默认**拒绝覆盖**。真实录音转写很贵（时间），误覆盖等于丢数据；
 *      确实要重跑必须显式 --force。
 *   3. 空转写（静音段、纯环境音）不落盘，只记进 manifest 的 failures，
 *      但**不算错误**——真实课堂里静音是正常现象，把它当失败会让人误以为工具坏了。
 *   4. 转写保留口语原样，不做任何清洗。「嗯」「那个」「好」是反馈类编码的证据，
 *      删掉它们等于篡改数据，κ 就失去意义。
 *
 * 用法：
 *   node scripts/ingest-audio.js --check                 # 只检测能力，不转写
 *   node scripts/ingest-audio.js a.m4a b.mp3             # 转写指定文件
 *   node scripts/ingest-audio.js --dir ../录音           # 转写整个目录
 *   node scripts/ingest-audio.js a.m4a --force           # 覆盖已有转写
 *   node scripts/ingest-audio.js a.m4a --model medium    # 提高精度（更慢）
 */

const fs = require('fs');
const path = require('path');
const transcribeLib = require('../lib/transcribe.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'annotation', 'corpus');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.webm', '.mp4', '.mov', '.mkv']);

function parseArgs(argv) {
  const o = { files: [], dir: '', out: DEFAULT_OUT, model: 'small', force: false, check: false, minChars: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--force') o.force = true;
    else if (a === '--dir') o.dir = argv[++i];
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--min-chars') o.minChars = Number(argv[++i]);
    else if (!a.startsWith('-')) o.files.push(a);
  }
  return o;
}

function listAudio(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return AUDIO_EXT.has(path.extname(target).toLowerCase()) ? [target] : [];
  return fs.readdirSync(target)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(target, f))
    .sort();
}

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { note: '录音转写记录。每成功一篇追加一条 entries。', entries: [], failures: [] };
  }
}

function fmtSec(s) {
  if (!s && s !== 0) return '?';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? m + ' 分 ' + r + ' 秒' : r + ' 秒';
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));

  // ---- 能力检测：先看能不能跑，别让人等半天才发现缺环境 ----
  const cap = transcribeLib.detect();
  console.log('=== 转写能力检测 ===');
  console.log('  本地 faster-whisper : ' + (cap.fasterWhisper ? '可用（' + cap.python + '）' : '不可用'));
  console.log('  本地模型            : ' + (cap.localModels.length ? cap.localModels.map((m) => m.size).join(', ') : '无'));
  console.log('  ffmpeg              : ' + (cap.ffmpeg ? cap.ffmpegBin : '未检测到（改用 PyAV 解码）'));
  console.log('  云端 Whisper API    : ' + (cap.cloud ? '已配置 Key' : '未配置'));
  if (!cap.fasterWhisper && !cap.cloud) {
    console.error('\n没有可用的转写通道。装本地引擎：pip install faster-whisper，或配置 OPENAI_API_KEY。');
    process.exit(2);
  }
  if (opt.check) {
    console.log('\n（--check 模式，不执行转写）');
    return;
  }

  // ---- 收集输入 ----
  const inputs = [];
  opt.files.forEach((f) => inputs.push(...listAudio(path.resolve(f))));
  if (opt.dir) inputs.push(...listAudio(path.resolve(opt.dir)));
  if (!inputs.length) {
    console.error('\n没有找到音频文件。支持：' + [...AUDIO_EXT].join(' '));
    console.error('用法：node scripts/ingest-audio.js --dir <录音目录>');
    process.exit(1);
  }

  fs.mkdirSync(opt.out, { recursive: true });
  const manifestPath = path.join(opt.out, 'manifest.json');
  const manifest = readManifest(manifestPath);

  console.log('\n=== 开始转写 ' + inputs.length + ' 个文件 ===');
  const done = [];
  const skipped = [];
  const empty = [];
  const failed = [];

  for (const audio of inputs) {
    const base = path.basename(audio, path.extname(audio));
    const txtPath = path.join(opt.out, base + '.txt');
    const rel = path.relative(ROOT, audio);

    if (fs.existsSync(txtPath) && !opt.force) {
      console.log('  跳过（已存在）  ' + path.basename(txtPath) + '   —— 要重跑加 --force');
      skipped.push(rel);
      continue;
    }

    console.log('  转写中…         ' + rel);
    const t0 = Date.now();
    let r;
    try {
      r = await transcribeLib.transcribe(audio, { modelSize: opt.model, prefer: 'auto' });
    } catch (e) {
      r = { ok: false, error: String(e && e.message) };
    }
    const secs = Math.round((Date.now() - t0) / 1000);

    if (!r || !r.ok) {
      const why = (r && (r.error || r.reason)) || '未知原因';
      console.log('  失败            ' + rel + ' —— ' + why);
      failed.push({ audio: rel, reason: why });
      continue;
    }

    const text = String(r.text || '').trim();
    const entry = {
      audio: rel,
      seconds: r.duration === undefined ? null : r.duration,
      chars: text.length,
      language: r.language || null,
      model: r.model || opt.model,
      channel: r.source || null,
      elapsedSec: secs,
      at: new Date().toISOString(),
    };

    if (!text) {
      // 静音/no speech。不落盘空的 .txt，否则切句器会读到一个空文件而误报「语料为空」。
      console.log('  无语音内容      ' + rel + ' —— 静音或纯环境音，已记入 manifest，不生成 txt');
      empty.push(entry);
      continue;
    }

    fs.writeFileSync(txtPath, text + '\n', 'utf8');
    entry.txt = path.relative(ROOT, txtPath);
    manifest.entries.push(entry);
    done.push(entry);
    console.log('  完成            ' + path.basename(txtPath) + '  ' + text.length + ' 字 / ' + fmtSec(r.duration) + ' 用时 ' + secs + 's'
      + (opt.minChars && text.length < opt.minChars ? '   ⚠ 低于 --min-chars，可能抽不满样本' : ''));
  }

  manifest.failures = (manifest.failures || []).concat(failed.map((f) => ({ at: new Date().toISOString(), ...f })));
  manifest.empty = (manifest.empty || []).concat(empty);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // ---- 汇总 ----
  const totalChars = done.reduce((s, e) => s + e.chars, 0);
  console.log('\n=== 汇总 ===');
  console.log('  成功 ' + done.length + ' 篇 / ' + totalChars + ' 字（约可切 ' + Math.round(totalChars / 18) + ' 句）');
  if (skipped.length) console.log('  跳过 ' + skipped.length + ' 篇（已存在）');
  if (empty.length) console.log('  空转写 ' + empty.length + ' 篇（静音，非错误）');
  if (failed.length) console.log('  失败 ' + failed.length + ' 篇（见 manifest.json 的 failures）');

  if (!totalChars) {
    console.log('\n没有产出任何文本，无法抽样。请确认录音里确实有人说话。');
    process.exit(3);
  }
  if (totalChars < 1000) {
    console.log('\n⚠ 语料不足 1000 字，抽 200 句会很勉强。建议再录 2–3 段（每段 3 分钟以上）。');
  }
  console.log('\n下一步：');
  console.log('  node scripts/build-annotation-set.js --input annotation/corpus --n 200');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('执行出错：' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}

module.exports = { listAudio, parseArgs, AUDIO_EXT };
