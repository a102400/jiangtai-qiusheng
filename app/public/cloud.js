'use strict';

/* ==================================================================
   讲台求生 · 云服务接入层（WorkBuddy Cloud）
   ------------------------------------------------------------------
   - SDK：CDN 全局 WorkBuddyCloud（项目无构建步骤，按规范用 CDN 形式）
   - Auth：手机验证码登录 + 微信扫码登录（Web OAuth，回调落在站点根路径）
   - Database：lesson_reports 表（用户私有，RLS 行级隔离）
   - 与 app.js 解耦：app.js 只调用 window.JTQCloud?.xxx，云服务不可用时静默降级
   ================================================================== */

(function () {
  // publicConfig 来自 workbuddy_cloud_service 激活结果，且仅含可公开下发的四个字段
  const PUBLIC_CONFIG = {
    resourceId: 'wbcs_2R9gQ5ikEk1snjOVeBdZME',
    endpoint: 'https://jiangtai-survival.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_G19b8uinF8NS1zn0yxJPYR_EmQjUH5FXZS9UzyhdD9ft0iOEhl7TEBS',
  };

  /* ---------- DOM（动态注入，不改 index.html 的主结构） ---------- */
  const state = {
    cloud: null,
    ready: false,
    user: null,
    pendingOtp: null,
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- UI：账户按钮 + 弹层 ---------- */
  function ensureUi() {
    if (document.getElementById('cloudAccountBtn')) return;
    const bad = document.querySelector('.badges');
    if (!bad) return;

    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.id = 'cloudAccountBtn';
    btn.type = 'button';
    btn.title = '登录账号 / 我的复盘记录';
    btn.textContent = '◔ 未登录';
    bad.insertBefore(btn, bad.firstChild);

    const overlay = document.createElement('div');
    overlay.id = 'cloudOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:90;display:none;' +
      'align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = '<div id="cloudModal" style="background:var(--bg,#fff);border-radius:14px;max-width:520px;width:100%;max-height:82vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25)"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    btn.addEventListener('click', openModal);
  }

  function closeModal() {
    const o = document.getElementById('cloudOverlay');
    if (o) o.style.display = 'none';
  }

  function openModal() {
    const o = document.getElementById('cloudOverlay');
    if (!o) return;
    o.style.display = 'flex';
    render();
  }

  function render() {
    const m = document.getElementById('cloudModal');
    if (!m) return;
    if (!state.ready) {
      m.innerHTML = '<h3 style="margin:0 0 8px">云服务</h3><p style="color:#64748b">云服务加载中…（需要联网）</p>';
      return;
    }
    if (state.user) {
      renderRecords(m);
    } else {
      renderLogin(m);
    }
  }

  /* ---------- 登录视图：手机验证码 + 微信 ---------- */
  function renderLogin(m) {
    m.innerHTML =
      '<h3 style="margin:0 0 6px">登录讲台求生</h3>' +
      '<p style="color:#64748b;margin:0 0 14px;font-size:13px">登录后，你的复盘报告会自动保存到云端，换设备也能查看。</p>' +

      '<form id="phoneLoginForm">' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<input id="cloudPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="手机号" autocomplete="tel" ' +
      'style="flex:1;padding:9px 12px;border:1px solid var(--line,#e2e8f0);border-radius:8px;font-size:14px;background:var(--card,#fff);color:inherit">' +
      '<button type="button" id="cloudSendCode" class="ghost-btn sm" style="white-space:nowrap">获取验证码</button>' +
      '</div>' +
      '<p id="cloudPhoneErr" style="color:#dc2626;font-size:12px;margin:0 0 8px;display:none"></p>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<input id="cloudCode" type="text" inputmode="numeric" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code" ' +
      'style="flex:1;padding:9px 12px;border:1px solid var(--line,#e2e8f0);border-radius:8px;font-size:14px;background:var(--card,#fff);color:inherit">' +
      '<button type="submit" class="primary sm" style="white-space:nowrap;padding:9px 18px;border:none;border-radius:8px;background:var(--brand,#4F46E5);color:#fff;font-size:14px;cursor:pointer">登录 / 注册</button>' +
      '</div>' +
      '</form>' +

      '<div style="text-align:center;color:#94a3b8;font-size:12px;margin:14px 0 10px">—— 或 ——</div>' +
      '<button type="button" id="cloudWechatBtn" style="width:100%;padding:10px;border:none;border-radius:8px;' +
      'background:#07C160;color:#fff;font-size:14px;cursor:pointer;font-weight:600">微信登录</button>' +

      '<p id="cloudLoginErr" style="color:#dc2626;font-size:13px;margin:10px 0 0"></p>' +
      '<button type="button" id="cloudCloseBtn" style="margin-top:14px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:13px">暂不登录，先用着</button>';

    $('cloudSendCode').addEventListener('click', onSendCode);
    $('cloudPhone').addEventListener('input', () => hidePhoneErr());
    $('phoneLoginForm').addEventListener('submit', onSubmitCode);
    $('cloudWechatBtn').addEventListener('click', onWechatLogin);
    $('cloudCloseBtn').addEventListener('click', closeModal);
  }

  function $(id) { return document.getElementById(id); }

  function showLoginErr(msg) {
    const el = $('cloudLoginErr');
    if (el) el.textContent = msg || '';
  }
  function showPhoneErr(msg) {
    const el = $('cloudPhoneErr');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
  function hidePhoneErr() { showPhoneErr(''); }

  /* 手机验证码：发送 */
  async function onSendCode() {
    const phone = ($('cloudPhone').value || '').trim();
    if (!/^1\d{10}$/.test(phone)) {
      showPhoneErr('请输入正确的 11 位手机号');
      return;
    }
    showPhoneErr('');
    const btn = $('cloudSendCode');
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      const sent = await state.cloud.auth.sendOtp({ phone });
      if (sent.error) {
        showLoginErr(sent.error.message || '验证码发送失败');
        return;
      }
      // 保存 challenge，提交验证码时使用（发送与校验是两个独立动作）
      state.pendingOtp = { phone, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
      showLoginErr('');
      let sec = 60;
      const tick = () => {
        if (sec <= 0) { btn.disabled = false; btn.textContent = '重新获取'; return; }
        btn.textContent = sec + 's 后重发';
        sec--;
        setTimeout(tick, 1000);
      };
      tick();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      showLoginErr('网络异常，请稍后再试');
    }
  }

  /* 手机验证码：提交登录 */
  async function onSubmitCode(e) {
    e.preventDefault();
    const phone = ($('cloudPhone').value || '').trim();
    const code = ($('cloudCode').value || '').trim();
    const pending = state.pendingOtp;
    if (!pending || pending.phone !== phone) {
      showLoginErr('请先为当前手机号获取验证码');
      return;
    }
    if (!code) {
      showLoginErr('请输入验证码');
      return;
    }
    try {
      const done = await state.cloud.auth.verifyOtp({
        phone: pending.phone,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code,
      });
      if (done.error) {
        showLoginErr(done.error.message || '验证码不正确');
        return;
      }
      state.pendingOtp = null;
      await onSignedIn(done.data && done.data.user);
    } catch (err) {
      showLoginErr('登录失败，请重试');
    }
  }

  /* 微信登录：跳转授权，回调落回站点根路径 */
  async function onWechatLogin() {
    // 保留应用自己的查询参数（线上分享链接需要 sharecode），只清回调参数
    const back = new URL(location.href);
    back.pathname = '/';
    for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key);

    const res = await state.cloud.auth.signInWithOAuth({ provider: 'wechat', redirectTo: back.toString() });
    if (res.error) {
      showLoginErr(res.error.message || '微信登录暂不可用');
      return;
    }
    location.assign(res.data.url); // 必须同页跳转
  }

  /* ---------- OAuth 回调分发（必须在路由守卫之前执行） ---------- */
  async function restoreAuth() {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
      continueNormalStartup();
      return;
    }
    const provider = url.searchParams.get('provider');
    if (provider !== 'workbuddy' && provider !== 'wechat') {
      // 不是 OAuth 回调（可能是别的带 code 的参数），按普通启动处理
      continueNormalStartup();
      return;
    }
    const handle = provider === 'workbuddy'
      ? state.cloud.auth.handleWorkBuddyCallback
      : state.cloud.auth.handleWechatWebCallback;
    if (typeof handle !== 'function') {
      showLoginErr('暂时无法使用此方式登录');
      return;
    }
    const { data: session, error } = await handle.call(state.cloud.auth);
    if (error) {
      showLoginErr(error.message || '登录失败，请重试');
      continueNormalStartup();
    } else if (session) {
      // 清理回调参数，但保留 sharecode 等业务参数
      for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      await onSignedIn(session.user);
    } else {
      continueNormalStartup();
    }
  }

  async function continueNormalStartup() {
    try {
      const { data: session } = await state.cloud.auth.getSession();
      if (session && session.user) await onSignedIn(session.user, true);
    } catch (e) { /* 未登录是正常状态 */ }
  }

  /* ---------- 登录后的状态 ---------- */
  async function onSignedIn(user, silent) {
    state.user = user || null;
    const btn = document.getElementById('cloudAccountBtn');
    if (btn) {
      const name = (user && user.name) || '已登录';
      btn.textContent = '◉ ' + name;
      btn.title = name + ' · 点击查看我的复盘记录';
    }
    render();
    if (!silent) await listRecords(); // 数据库请求自动携带会话
  }

  function onSignedOut() {
    state.user = null;
    const btn = document.getElementById('cloudAccountBtn');
    if (btn) btn.textContent = '◔ 未登录';
    render();
  }

  /* ---------- 我的复盘记录 ---------- */
  async function listRecords() {
    const m = $('cloudModal');
    if (!m || !state.user) return [];
    const box = m.querySelector('#cloudRecords');
    if (box) box.innerHTML = '<p style="color:#94a3b8;font-size:13px">加载中…</p>';
    const { data, error } = await state.cloud.database
      .from('lesson_reports')
      .select('id, subject, grade, overall_score, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      if (box) box.innerHTML = '<p style="color:#dc2626;font-size:13px">读取失败：' + esc(error.message || '') + '</p>';
      return [];
    }
    if (box) {
      if (!data || data.length === 0) {
        box.innerHTML = '<p style="color:#94a3b8;font-size:13px">还没有记录。提交一次讲稿分析，报告就会自动保存到这里。</p>';
      } else {
        box.innerHTML = data.map((r) =>
          '<div class="cloud-rec" data-id="' + r.id + '" title="点击查看完整报告" style="display:flex;justify-content:space-between;align-items:center;' +
          'gap:10px;padding:10px 12px;border:1px solid var(--line,#e2e8f0);border-radius:10px;margin-bottom:8px;cursor:pointer" ' +
          'onmouseover="this.style.borderColor=\'#4F46E5\'" onmouseout="this.style.borderColor=\'\'">' +
          '<div style="min-width:0;flex:1">' +
          '<b style="font-size:14px">' + esc(r.subject || '未命名试讲') + '</b>' +
          '<span style="color:#94a3b8;font-size:12px;margin-left:8px">' + esc(r.grade || '') + '</span>' +
          '<p style="margin:4px 0 0;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(r.summary || '') + '</p>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:20px;font-weight:700;color:var(--brand,#4F46E5)">' + (r.overall_score != null ? r.overall_score : '—') + '</div>' +
          '<div style="font-size:11px;color:#94a3b8">' + new Date(r.created_at).toLocaleDateString('zh-CN') + '</div>' +
          '</div>' +
          '<button type="button" class="cloud-del" data-id="' + r.id + '" title="删除" ' +
          'style="border:none;background:none;color:#cbd5e1;cursor:pointer;font-size:16px">✕</button>' +
          '</div>'
        ).join('');
        box.querySelectorAll('.cloud-rec').forEach((card) => {
          card.addEventListener('click', () => showRecordDetail(Number(card.getAttribute('data-id'))));
        });
        box.querySelectorAll('.cloud-del').forEach((b) => {
          b.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const id = Number(b.getAttribute('data-id'));
            if (!confirm('删除这条复盘记录？不可恢复。')) return;
            const { data: removed } = await state.cloud.database.from('lesson_reports').delete().eq('id', id).select();
            const arr = Array.isArray(removed) ? removed : [];
            if (arr.length === 0) { alert('删除失败：记录不存在或不属于你'); return; }
            await listRecords();
          });
        });
      }
    }
    return data || [];
  }

  /* ---------- 记录详情回看 ---------- */
  async function showRecordDetail(id) {
    const m = $('cloudModal');
    if (!m) return;
    m.innerHTML = '<p style="color:#94a3b8;font-size:13px">加载中…</p>';
    const { data, error } = await state.cloud.database
      .from('lesson_reports')
      .select('*')
      .eq('id', id)
      .limit(1);
    const rec = (!error && Array.isArray(data)) ? data[0] : null;
    if (!rec) {
      m.innerHTML = '<p style="color:#dc2626;font-size:13px">读取失败：记录不存在或不属于你</p>' +
        '<button type="button" id="cloudBackList" style="margin-top:10px">← 返回列表</button>';
      $('cloudBackList').addEventListener('click', () => { render(); listRecords(); });
      return;
    }
    const r = rec.report_json || {};
    const metric = (k, v, sub) =>
      '<div style="flex:1;min-width:130px;border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:10px 12px">' +
      '<div style="font-size:12px;color:#64748b">' + k + '</div>' +
      '<div style="font-size:18px;font-weight:700;margin:2px 0">' + esc(v) + '</div>' +
      '<div style="font-size:12px;color:#94a3b8">' + esc(sub || '') + '</div></div>';
    const sr = r.speech_rate || {}, pw = r.pauses || {}, fw = r.filler_words || {}, q = r.questions || {};
    const cards = [
      sr.chars_per_min != null ? metric('语速', sr.chars_per_min + ' 字/分', sr.judge || '') : '',
      pw.count_gt_2s != null ? metric('长停顿', pw.count_gt_2s + ' 次', '最长 ' + (pw.longest_sec || 0) + 's') : '',
      fw.total != null ? metric('口头禅', fw.total + ' 处', '') : '',
      q.total != null ? metric('提问', (q.total || 0) + ' 次', '真提问 ' + (q.authentic || 0) + ' 次') : '',
    ].join('');
    const sugs = (r.suggestions || []).map((s) => {
      const t = typeof s === 'string' ? s : (s.title || '');
      const d = (s && s.detail) || '';
      return '<li style="margin-bottom:6px"><b>' + esc(t) + '</b>' +
        (d ? '<span style="display:block;color:#64748b;font-size:13px">' + esc(d) + '</span>' : '') + '</li>';
    }).join('');

    m.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<button type="button" id="cloudBackList" style="border:none;background:none;color:#64748b;cursor:pointer;font-size:13px">← 返回列表</button>' +
      '<h3 style="margin:0">' + esc(rec.subject || '未命名试讲') + '</h3>' +
      '<span style="font-size:12px;color:#94a3b8">' + esc(rec.grade || '') + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:14px;background:var(--card,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:14px 18px;margin-bottom:10px">' +
      '<div style="font-size:36px;font-weight:800;color:var(--brand,#4F46E5)">' + (rec.overall_score != null ? rec.overall_score : '—') + '</div>' +
      '<p style="margin:0;font-size:13px;color:#475569;flex:1">' + esc(rec.summary || '') + '</p>' +
      '<button type="button" id="cloudExportBtn" style="padding:8px 14px;border:none;border-radius:8px;background:var(--brand,#4F46E5);color:#fff;cursor:pointer;font-size:13px;white-space:nowrap">导出 PDF</button>' +
      '</div>' +
      (cards ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + cards + '</div>' : '') +
      (sugs ? '<h4 style="margin:14px 0 8px;font-size:14px">行动建议</h4><ul style="margin:0;padding-left:18px;font-size:13px">' + sugs + '</ul>' : '') +
      (rec.transcript ? '<h4 style="margin:14px 0 8px;font-size:14px">逐字稿</h4>' +
        '<div style="background:var(--card,#f8fafc);border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:12px;max-height:200px;overflow:auto;white-space:pre-wrap;font-size:13px;color:#334155">' + esc(rec.transcript) + '</div>' : '') +
      '<p style="color:#94a3b8;font-size:12px;margin:12px 0 0">保存于 ' + new Date(rec.created_at).toLocaleString('zh-CN') + '</p>';

    $('cloudBackList').addEventListener('click', () => { render(); listRecords(); });
    $('cloudExportBtn').addEventListener('click', () => exportReport(r, rec));
  }

  /* ---------- 导出 PDF（走后端 /api/export，返回可打印页自动触发打印） ---------- */
  function exportReport(report, rec) {
    const payload = {
      report: report || {},
      meta: {
        subject: rec.subject,
        grade: rec.grade,
        owner: rec.owner_name,
        created: rec.created_at,
        transcript: rec.transcript,
      },
    };
    // 用隐藏表单 POST 打开新窗口，避免 URL 长度限制
    const form = document.createElement('form');
    form.method = 'POST';
    const expSc = (function () { try { return new URLSearchParams(window.location.search).get('sharecode'); } catch (e) { return null; } })();
    form.action = '/api/export' + (expSc ? ('?sharecode=' + encodeURIComponent(expSc)) : '');
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'json';
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  function renderRecords(m) {
    m.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<h3 style="margin:0">我的复盘记录</h3>' +
      '<button type="button" id="cloudLogout" style="border:none;background:none;color:#94a3b8;cursor:pointer;font-size:13px">退出登录</button>' +
      '</div>' +
      '<p style="color:#64748b;margin:0 0 12px;font-size:13px">每次 AI 复盘后自动存档（仅自己可见）。</p>' +
      '<div id="cloudRecords"></div>' +
      '<button type="button" id="cloudCloseBtn2" style="margin-top:10px;width:100%;padding:9px;border:1px solid var(--line,#e2e8f0);' +
      'border-radius:8px;background:none;color:#64748b;cursor:pointer;font-size:13px">关闭</button>';
    $('cloudLogout').addEventListener('click', async () => {
      await state.cloud.auth.signOut();
      onSignedOut();
    });
    $('cloudCloseBtn2').addEventListener('click', closeModal);
    listRecords();
  }

  /* ---------- 对外：保存复盘（app.js 在分析成功后调用） ---------- */
  let cloudRecordsCache = [];
  async function saveReport(report, meta) {
    // 演示页面与演示结果不得写入云端报告存档
    if (
      new URLSearchParams(window.location.search).get('jtq-demo') === '1' ||
      (report && report.engine === 'offline-demo')
    ) {
      return { saved: false, reason: 'demo-result' };
    }
    if (!state.ready || !state.user) return { saved: false, reason: 'not-signed-in' };
    try {
      const { data, error } = await state.cloud.database
        .from('lesson_reports')
        .insert({
          subject: (meta && meta.subject) || null,
          grade: (meta && meta.grade) || null,
          transcript: String((meta && meta.transcript) || ''),
          overall_score: report.overall_score != null ? Number(report.overall_score) : null,
          summary: report.summary || null,
          report_json: report, // 完整报告存 JSONB
          owner_name: (state.user && state.user.name) || null,
        })
        .select();
      if (error) return { saved: false, reason: error.message };
      const arr = Array.isArray(data) ? data : [];
      const rec = arr[0];
      if (rec) {
        cloudRecordsCache.push({
          at: rec.created_at,
          subject: rec.subject,
          score: rec.overall_score,
          filler: (report && report.filler_words || {}).total || 0,
          questions: (report && report.questions || {}).total || 0,
          rate: (report && report.speech_rate || {}).chars_per_min || 0,
        });
      }
      return { saved: arr.length > 0, id: rec && rec.id };
    } catch (e) {
      return { saved: false, reason: 'network' };
    }
  }

  /* ---------- 排行榜（21）：公开读、仅本人可写 ---------- */
  const NICK_KEY = 'jtq_nickname';
  const SCHOOL_KEY = 'jtq_school';
  const AVATAR_KEY = 'jtq_avatar';
  const TEAM_KEY = 'jtq_team';
  function lsGet(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function lsSet(k, v) {
    try {
      if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
    } catch (e) { /* 隐私模式：仅本次会话有效 */ }
  }
  function getNickname() {
    return lsGet(NICK_KEY);
  }
  function setNickname(n) {
    const v = String(n || '').trim().slice(0, 12);
    try {
      if (v) localStorage.setItem(NICK_KEY, v); else localStorage.removeItem(NICK_KEY);
    } catch (e) { /* 隐私模式：仅本次会话有效 */ }
    return v;
  }
  function getSchool() { return lsGet(SCHOOL_KEY); }
  function setSchool(v) {
    const s = String(v || '').trim().slice(0, 16);
    lsSet(SCHOOL_KEY, s);
    return s;
  }
  function getTeam() { return lsGet(TEAM_KEY); }
  function setTeam(v) {
    const s = String(v || '').trim().slice(0, 20);
    lsSet(TEAM_KEY, s);
    return s;
  }
  function getAvatar() { return lsGet(AVATAR_KEY) || '🎓'; }
  function setAvatar(v) {
    const s = String(v || '').trim().slice(0, 4);
    lsSet(AVATAR_KEY, s);
    return s || '🎓';
  }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  function startOfWeek() {
    const d = new Date();
    const day = d.getDay() || 7; // 周日按周一为一周起点
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  /* 本周进步榜：同一人的记录按时间排序，进步 = 最近一次 − 上一次 */
  function computeProgress(rows) {
    const byOwner = {};
    (rows || []).forEach((r) => {
      const k = r.owner_id || r.owner_name || r.nickname || 'unknown';
      (byOwner[k] = byOwner[k] || []).push(r);
    });
    const list = [];
    Object.keys(byOwner).forEach((k) => {
      const arr = byOwner[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (arr.length < 2) return; // 至少两次试讲才谈得上「进步」
      const last = arr[arr.length - 1];
      const prev = arr[arr.length - 2];
      list.push({
        owner_id: last.owner_id,
        nickname: last.nickname || last.owner_name || '华师同学',
        score: last.score,
        gain: (last.score || 0) - (prev.score || 0),
        subject: last.subject,
        created_at: last.created_at,
        school: last.school,
        avatar: last.avatar,
        team: last.team,
      });
    });
    list.sort((a, b) => b.gain - a.gain);
    return list;
  }

  /* 战队榜：按 team 聚合平均分/人次/最高分 */
  function computeTeams(rows) {
    const map = {};
    (rows || []).forEach((r) => {
      const t = (r.team || '').trim();
      if (!t || r.score == null) return;
      if (!map[t]) map[t] = { team: t, sum: 0, n: 0, best: 0, school: r.school || '', avatar: r.avatar || '' };
      const m = map[t];
      m.sum += Number(r.score) || 0;
      m.n += 1;
      if ((Number(r.score) || 0) > m.best) m.best = Number(r.score) || 0;
    });
    const list = Object.keys(map).map((k) => ({
      team: k,
      avg: Math.round(map[k].sum / map[k].n),
      count: map[k].n,
      best: map[k].best,
      school: map[k].school,
      avatar: map[k].avatar,
    }));
    list.sort((a, b) => b.avg - a.avg || b.count - a.count);
    return list.slice(0, 20);
  }

  /* type: today | week | total | team */
  async function fetchLeaderboard(type) {
    if (type === 'team') {
      if (!state.ready) return { rows: [], type: 'team', error: 'cloud-not-ready' };
      try {
        const { data, error } = await state.cloud.database
          .from('leaderboard')
          .select('team, score, school, avatar, created_at')
          .order('score', { ascending: false })
          .limit(300);
        if (error) return { rows: [], type: 'team', error: error.message };
        return { rows: computeTeams(data || []), type: 'team' };
      } catch (e) {
        return { rows: [], type: 'team', error: 'network' };
      }
    }
    if (!state.ready) return { rows: [], type: type, error: 'cloud-not-ready' };
    try {
      if (type === 'week') {
        const { data, error } = await state.cloud.database
          .from('leaderboard')
          .select('owner_id, owner_name, nickname, score, subject, created_at, school, avatar, team')
          .gte('created_at', startOfWeek())
          .order('created_at', { ascending: true })
          .limit(300);
        if (error) return { rows: [], type: 'week', error: error.message };
        return { rows: computeProgress(data || []), type: 'week' };
      }
      let q = state.cloud.database
        .from('leaderboard')
        .select('owner_id, owner_name, nickname, score, subject, created_at, school, avatar, team')
        .order('score', { ascending: false })
        .limit(20);
      if (type === 'today') q = q.gte('created_at', startOfToday());
      const { data, error } = await q;
      if (error) return { rows: [], type: type, error: error.message };
      return { rows: data || [], type: type };
    } catch (e) {
      return { rows: [], type: type, error: 'network' };
    }
  }

  /* 复盘成功后调用：登录用户才写入（RLS 要求 owner_id = auth.uid()） */
  async function pushLeaderboard(score, subject, grade) {
    // 演示页面不得写入排行榜（防止绕过 runAnalyze() 的其他调用路径）
    if (
      new URLSearchParams(window.location.search).get('jtq-demo') === '1'
    ) {
      return { saved: false, reason: 'demo-result' };
    }
    if (!state.ready || !state.user) return { saved: false, reason: 'not-signed-in' };
    try {
      const nickname = getNickname() || (state.user && state.user.name) || '华师同学';
      const { data, error } = await state.cloud.database
        .from('leaderboard')
        .insert({
          nickname: nickname,
          score: score != null ? Number(score) : null,
          subject: subject || null,
          grade: grade || null,
          school: getSchool() || null,
          avatar: getAvatar() || null,
          team: getTeam() || null,
          owner_name: (state.user && state.user.name) || null,
        })
        .select();
      if (error) return { saved: false, reason: error.message };
      const arr = Array.isArray(data) ? data : [];
      return { saved: arr.length > 0 };
    } catch (e) {
      return { saved: false, reason: 'network' };
    }
  }

  /* ---------- 匿名树洞（B）：公开读、匿名可写、仅本人可删 ---------- */
  async function fetchHollowPosts() {
    if (!state.ready) return { posts: [], error: 'cloud-not-ready' };
    try {
      const { data, error } = await state.cloud.database
        .from('hollow_posts')
        .select('id, owner_id, text, reply, likes, school, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return { posts: [], error: error.message };
      return { posts: data || [] };
    } catch (e) {
      return { posts: [], error: 'network' };
    }
  }

  async function pushHollowPost(post) {
    if (!state.ready) return { saved: false, reason: 'cloud-not-ready' };
    const text = String((post && post.text) || '').trim().slice(0, 300);
    if (!text) return { saved: false, reason: 'empty' };
    try {
      const { data, error } = await state.cloud.database
        .from('hollow_posts')
        .insert({
          text: text,
          reply: String((post && post.reply) || '').slice(0, 600),
          school: getSchool() || null,
        })
        .select();
      if (error) return { saved: false, reason: error.message };
      const arr = Array.isArray(data) ? data : [];
      return { saved: arr.length > 0, row: arr[0] };
    } catch (e) {
      return { saved: false, reason: 'network' };
    }
  }


  /* 点赞：append-only 计数表（不给 UPDATE 权限，杜绝改帖正文） */
  async function fetchHollowLikes() {
    if (!state.ready) return { counts: {}, error: 'cloud-not-ready' };
    try {
      const { data, error } = await state.cloud.database
        .from('hollow_likes')
        .select('post_id')
        .limit(2000);
      if (error) return { counts: {}, error: error.message };
      const counts = {};
      (data || []).forEach((r) => {
        const k = String(r.post_id);
        counts[k] = (counts[k] || 0) + 1;
      });
      return { counts: counts };
    } catch (e) {
      return { counts: {}, error: 'network' };
    }
  }

  async function pushHollowLike(postId) {
    if (!state.ready) return { saved: false, reason: 'cloud-not-ready' };
    try {
      const { data, error } = await state.cloud.database
        .from('hollow_likes')
        .insert({ post_id: Number(postId) })
        .select();
      if (error) return { saved: false, reason: error.message };
      const arr = Array.isArray(data) ? data : [];
      return { saved: arr.length > 0 };
    } catch (e) {
      return { saved: false, reason: 'network' };
    }
  }

  /* 举报：只写不读（客户端无 SELECT 权限，仅运营侧可见） */
  async function pushHollowReport(postId, reason) {
    if (!state.ready) return { saved: false, reason: 'cloud-not-ready' };
    try {
      const { data, error } = await state.cloud.database
        .from('hollow_reports')
        .insert({ post_id: Number(postId), reason: String(reason || 'other').slice(0, 40) })
        .select();
      if (error) return { saved: false, reason: error.message };
      const arr = Array.isArray(data) ? data : [];
      return { saved: arr.length > 0 };
    } catch (e) {
      return { saved: false, reason: 'network' };
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    ensureUi();
    const btn = document.getElementById('cloudAccountBtn');
    if (typeof window.WorkBuddyCloud === 'undefined' || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
      // CDN 加载失败：云服务整体禁用，其余功能不受影响
      if (btn) { btn.textContent = '◔ 离线'; btn.title = '云服务加载失败（需联网），本地功能不受影响'; }
      return;
    }
    try {
      state.cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: PUBLIC_CONFIG.endpoint,
        oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
        publishableKey: PUBLIC_CONFIG.publishableKey,
      });
      state.ready = true;
    } catch (e) {
      if (btn) { btn.textContent = '◔ 云服务异常'; btn.title = '云服务初始化失败：' + (e.message || e); }
      return;
    }
    await restoreAuth();
  }

  // 暴露给 app.js 的最小接口；未就绪时全部安全降级
  window.JTQCloud = {
    get signedIn() { return !!(state.ready && state.user); },
    get currentUserId() { return (state.user && (state.user.id || state.user.uid)) || ''; },
    get userName() { return (state.user && state.user.name) || ''; },
    saveReport,
    open: openModal,
    // 成长档案合并云端记录用（未登录返回空数组）
    getRecords: function () { return cloudRecordsCache || []; },
    // 排行榜（21）
    getNickname,
    setNickname,
    getSchool,
    setSchool,
    getTeam,
    setTeam,
    fetchHollowPosts,
    pushHollowPost,
    fetchHollowLikes,
    pushHollowLike,
    pushHollowReport,
    getAvatar,
    setAvatar,
    fetchLeaderboard,
    pushLeaderboard,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
