'use strict';
/**
 * 云端转写 try-online（端到端，无需真实 Key）
 * 起一个本地 mock 服务冒充 OpenAI 兼容音频接口，验证：
 *   1. verbose_json 的 segments 能否被正确解析成 {start,end,text}
 *   2. duration 缺失时能否由 segments 末尾兜底
 *   3. 各家「只返回纯文本」的退化行为是否仍能出结果
 *   4. 超过 25MB 时是否给出友好拦截（而不是 413 才报错）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// mock 返回的 OpenAI verbose_json
const VERBOSE = {
  task: 'transcribe',
  duration: 120.5,
  text: '同学们好，今天讲函数的单调性。第一步求导。',
  segments: [
    { id: 0, start: 0.0, end: 4.2, text: ' 同学们好，今天讲函数的单调性。' },
    { id: 1, start: 4.2, end: 9.8, text: '第一步求导。' },
    { id: 2, start: 9.8, end: 9.8, text: '   ' }, // 空段应被过滤
  ],
};
// 某些服务不给 duration
const NO_DURATION = { text: '只有文本', segments: [{ start: 1, end: 3, text: '甲' }, { start: 3, end: 7.5, text: '乙' }] };

let mode = 'verbose';
const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', (d) => body.push(d));
  req.on('end', () => {
    if (mode === 'plaintext') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('纯文本返回值，某些兼容服务就是这样');
    }
    if (mode === 'err401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mode === 'noduration' ? NO_DURATION : VERBOSE));
  });
});

const tmpFile = path.join(os.tmpdir(), 'fake-lesson.mp4');
fs.writeFileSync(tmpFile, Buffer.alloc(1024 * 256, 1)); // 256KB 假文件
const bigFile = path.join(os.tmpdir(), 'big-lesson.mp4');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? ' -> ' + extra : ''}`);
}

server.listen(0, async () => {
  const port = server.address().port;
  process.env.WHISPER_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.WHISPER_API_KEY = 'test-key-for-mock';
  delete require.cache[require.resolve('../lib/transcribe.js')];
  const { transcribe } = require('../lib/transcribe.js');

  // 1. 标准 verbose_json
  const r1 = await transcribe(tmpFile, { prefer: 'cloud' });
  check('1 云端返回成功', r1.ok === true, r1.error || '');
  check('1 source 标记为 cloud-whisper', r1.source === 'cloud-whisper');
  check('1 解析出 2 个非空分段', Array.isArray(r1.segments) && r1.segments.length === 2, JSON.stringify(r1.segments));
  check('1 分段结构对齐 {start,end,text}', !!r1.segments[0] && r1.segments[0].start === 0 && r1.segments[0].end === 4.2 && r1.segments[0].text === '同学们好，今天讲函数的单调性。', JSON.stringify(r1.segments[0]));
  check('1 duration 取接口值 120.5', r1.duration === 120.5, String(r1.duration));
  check('1 text 非空且与 segments 一致', r1.text === VERBOSE.text, r1.text);

  // 2. 缺失 duration -> 由 segments 末尾兜底
  mode = 'noduration';
  const r2 = await transcribe(tmpFile, { prefer: 'cloud' });
  check('2 无 duration 时由末段兜底为 7.5', r2.ok && r2.duration === 7.5, String(r2 && r2.duration));

  // 3. 只返回纯文本的兼容服务
  mode = 'plaintext';
  const r3 = await transcribe(tmpFile, { prefer: 'cloud' });
  check('3 纯文本返回值仍能出结果', r3.ok === true && /纯文本返回值/.test(r3.text), JSON.stringify(r3).slice(0, 120));
  check('3 纯文本时 segments 为空数组不崩曲线', Array.isArray(r3.segments) && r3.segments.length === 0);

  // 4. 401 要给可读的失败原因
  mode = 'err401';
  const r4 = await transcribe(tmpFile, { prefer: 'cloud' });
  check('4 401 报错含「Key 无效」提示', r4.ok === false && /Key 无效/.test(r4.error || ''), r4.error);

  // 5. 超大文件提前拦截
  mode = 'verbose';
  try { fs.writeFileSync(bigFile, Buffer.alloc(1024 * 1024 * 26, 0)); } catch (e) { /* 空间不足则跳过 */ }
  if (fs.existsSync(bigFile)) {
    const r5 = await transcribe(bigFile, { prefer: 'cloud' });
    check('5 超 25MB 文件给出友好拦截', r5.ok === false && /25MB 上限/.test(r5.error || ''), r5.error);
    fs.unlinkSync(bigFile);
  } else {
    console.log('[SKIP] 5 超大文件用例（磁盘空间不足，未生成 26MB 测试文件）');
  }

  fs.unlinkSync(tmpFile);
  server.close();
  console.log(`\n===== 云端转写回归：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
});
