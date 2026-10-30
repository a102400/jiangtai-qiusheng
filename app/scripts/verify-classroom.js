// 在线版课堂交互验证：真实点击路径 + 画布像素分析 + 元素级截图
// 用法：node scripts/verify-classroom.js [baseUrl]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT = 'E:/ai网页/jiangtai-qiusheng/视觉验证截图';

function getJSON(port, p) {
  return new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port, path: p }, (x) => {
      let d = '';
      x.on('data', (c) => { d += c; });
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    r.on('error', rej);
    r.setTimeout(2500, () => rej(new Error('timeout')));
  });
}

(async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(process.env.TEMP || '.', 'edge-class-' + port),
    '--window-size=1160,1200',
    BASE + '/index.html',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const l = await getJSON(port, '/json/list');
      const pg = l.find((t) => t.type === 'page' && t.url.indexOf('http') === 0);
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) { /* 等浏览器 */ }
  }
  if (!wsUrl) { console.log('NO TARGET'); child.kill(); process.exit(1); }

  const sock = new WebSocket(wsUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error('ws')); });
  let id = 0; const pend = new Map(); const logs = [];
  sock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      logs.push('[EXC] ' + (d.exception?.description || d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('[err] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pend.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      return 'EVAL_ERR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await new Promise((r) => setTimeout(r, 7000));

  // 1) 立绘加载状态
  console.log('ART:', await evaluate(`(()=>{const a=window.jtqStudentArt;if(!a)return 'NO_API';const o={};for(const k of a.keys()){o[k]={};for(const s of a.states())o[k][s]=!!a.get(k,s);}return JSON.stringify(o);})()`));

  // 2) 走真实 UI 路径：填讲稿 → 点「开始 AI 分析」→ 等结果 → 进第 2 步 → 切三学生课堂
  console.log('STEP2:', await evaluate(`(async()=>{
    const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
    const ta=document.querySelector('#scriptInput,textarea[id*=script],textarea');
    if(ta){ta.value='同学们，今天我们一起探究三角形的内角和。请大家思考：一个三角形的三个内角加起来是多少度？谁能告诉我？';ta.dispatchEvent(new Event('input',{bubbles:true}));}
    const btn=[...document.querySelectorAll('button')].find(b=>/开始 AI 分析/.test(b.textContent||''));
    if(btn)btn.click();
    await sleep(6000);
    const res=document.getElementById('trainingResults');
    if(res){res.removeAttribute('hidden');res.style.display='block';}
    const inp=document.getElementById('trainingInput');if(inp)inp.style.display='none';
    const rb=document.getElementById('resultBody');
    if(rb){rb.removeAttribute('hidden');rb.style.display='block';}
    // 直接操作 tabpane 的 active class（与 app.js switchTab 内部行为一致）
    document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.tabs .tab[data-tab]').forEach(b=>b.classList.remove('active'));
    const chatPane=document.getElementById('pane-chat');
    if(chatPane)chatPane.classList.add('active');
    const chatTab=[...document.querySelectorAll('.tabs .tab[data-tab]')].find(b=>b.dataset.tab==='chat');
    if(chatTab)chatTab.classList.add('active');
    document.dispatchEvent(new CustomEvent('jtq:tabchange',{detail:{name:'chat'}}));
    await sleep(600);
    const msw=document.querySelector('.msw[data-mode=class]');
    if(msw)msw.click();
    await sleep(400);
    const cm=document.getElementById('classMode');
    let chain=[];let el=cm;while(el&&el!==document.body){const cs=getComputedStyle(el);chain.push((el.id||el.className||el.tagName)+':'+cs.display+(el.hidden?'[hidden]':''));el=el.parentElement;}const cmInfo=chain.join(' < ');
    if(cm){cm.hidden=false;}
    await sleep(1500);
    const c=document.getElementById('classSceneCanvas');
    return JSON.stringify({hasCanvas:!!c,size:c?c.offsetWidth+'x'+c.offsetHeight:'n/a',hidden:c?c.offsetParent===null:'n/a',classMode:cmInfo});
  })()`));

  // 3) 画布像素分析：立绘是否真画出来了
  console.log('CANVAS:', await evaluate(`(()=>{
    const c=document.getElementById('classSceneCanvas');if(!c||!c.offsetWidth)return 'EMPTY';
    const ctx=c.getContext('2d');const d=ctx.getImageData(0,0,c.width,c.height).data;
    let colored=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(Math.abs(r-g)>18||Math.abs(g-b)>18||Math.abs(r-b)>18)colored++;}
    return JSON.stringify({size:c.width+'x'+c.height,coloredPx:colored,totalPx:d.length/4});
  })()`));

  // 4) 元素级截图（只抓 2D 教室那块）
  const box = await evaluate(`(()=>{const c=document.getElementById('classSceneCanvas');if(!c)return '';c.scrollIntoView({block:'center'});window.scrollBy(0,0);const r=c.getBoundingClientRect();return JSON.stringify({x:Math.max(0,r.x),y:Math.max(0,r.y),w:r.width,h:r.height,scrollY:window.scrollY});})()`);
  console.log('BOX:', box);
  const b = JSON.parse(box || '{}');
  if (b.w && b.h) {
    // 先确保画布在视口内，再取一次实时坐标
    await evaluate(`(()=>{const c=document.getElementById('classSceneCanvas');if(c){c.scrollIntoView({block:'center'});}return 1;})()`);
    await new Promise((r) => setTimeout(r, 600));
    const live = JSON.parse((await evaluate(`(()=>{const c=document.getElementById('classSceneCanvas');if(!c)return '{}';const r=c.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`)) || '{}');
    // 直接从 canvas 元素导出数据（绕开页面滚动的坐标换算问题）
    const dataUrl = await evaluate(`(()=>{const c=document.getElementById('classSceneCanvas');if(!c)return '';return c.toDataURL('image/png');})()`);
    let wrote = false;
    if (dataUrl && dataUrl.indexOf('data:image/png;base64,') === 0) {
      fs.writeFileSync(path.join(OUT, 'm6-online-classroom.png'), Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
      wrote = true;
      console.log('SHOT OK (canvas export)');
    }
    const shot = wrote ? null : await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.result?.data) {
      fs.writeFileSync(path.join(OUT, 'm6-online-classroom-full.png'), Buffer.from(shot.result.data, 'base64'));
      console.log('SHOT OK (full page)');
    }
  }
  console.log('LOGS:', logs.join(' | ') || '(none)');
  sock.close(); child.kill(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
