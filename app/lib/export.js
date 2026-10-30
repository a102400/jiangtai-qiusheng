'use strict';

/**
 * 讲台求生 · 复盘报告导出（零依赖）
 * ------------------------------------------------------------------
 * POST /api/export
 * 输入：{ report: <analyze 返回的 data>, meta: { subject, grade, owner, created } }
 * 输出：自包含可打印 HTML（用户在浏览器 Ctrl+P 即可另存为 PDF）。
 * 不引入 puppeteer 之类依赖：打印成 PDF 由浏览器原生完成，服务端只负责排版。
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metricCards(report) {
  const items = [];
  const sr = report.speech_rate || {};
  if (sr.chars_per_min != null) {
    items.push(['语速', sr.chars_per_min + ' 字/分', sr.judge || '']);
  }
  const pw = report.pauses || {};
  if (pw.count_gt_2s != null) {
    items.push(['长停顿', pw.count_gt_2s + ' 次', '最长 ' + (pw.longest_sec || 0) + 's']);
  }
  const fw = report.filler_words || {};
  if (fw.total != null) {
    const detail = fw.detail ? Object.keys(fw.detail).map((k) => k + '×' + fw.detail[k]).join('，') : '';
    items.push(['口头禅', fw.total + ' 处', detail]);
  }
  const q = report.questions || {};
  // 新数据用 asked / genuine_questions；同时兼容旧历史记录的 total / authentic。
  // 不输出任何等待秒数：没有音频时间戳，等待时长不可测量。
  if (
    q.asked != null ||
    q.genuine_questions != null ||
    q.total != null ||
    q.authentic != null
  ) {
    const asked = q.asked != null ? q.asked : q.total;
    const genuine =
      q.genuine_questions != null
        ? q.genuine_questions
        : q.authentic;
    items.push([
      '文本提问',
      asked == null ? '未提供' : asked + ' 次',
      genuine == null
        ? '候选分类未记录'
        : '候选思考题 ' + genuine + ' 次'
    ]);
  }
  if (!items.length) return '';
  return (
    '<div class="metrics">' +
    items.map(([k, v, sub]) =>
      '<div class="m"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      '</div><div class="sub">' + esc(sub) + '</div></div>'
    ).join('') +
    '</div>'
  );
}

function suggestionList(report) {
  const list = report.suggestions || [];
  if (!list.length) return '';
  return (
    '<h2>行动建议</h2><ul class="sug">' +
    list.map((s) => {
      const title = typeof s === 'string' ? s : (s.title || '');
      const detail = (s && s.detail) || '';
      return '<li><b>' + esc(title) + '</b>' + (detail ? '<span>' + esc(detail) + '</span>' : '') + '</li>';
    }).join('') +
    '</ul>'
  );
}

function buildExportHtml(report, meta) {
  meta = meta || {};
  const created = meta.created ? new Date(meta.created) : new Date();
  const score = report.overall_score != null ? report.overall_score : '—';
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>试讲复盘报告 · ' + esc(meta.subject || '未命名') + '</title>' +
    '<style>' +
    '*{box-sizing:border-box}body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;' +
    'color:#1e293b;margin:0;padding:40px;max-width:820px;margin:0 auto;line-height:1.7}' +
    'header{border-bottom:3px solid #4F46E5;padding-bottom:16px;margin-bottom:24px}' +
    'h1{margin:0 0 6px;font-size:26px}h2{font-size:17px;margin:28px 0 10px;color:#4F46E5}' +
    '.meta{color:#64748b;font-size:13px}' +
    '.score{display:flex;align-items:center;gap:18px;background:#f8fafc;border:1px solid #e2e8f0;' +
    'border-radius:12px;padding:18px 22px;margin-bottom:8px}' +
    '.score .num{font-size:44px;font-weight:800;color:#4F46E5;min-width:80px;text-align:center}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}' +
    '.m{flex:1;min-width:150px;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}' +
    '.m .k{font-size:12px;color:#64748b}.m .v{font-size:20px;font-weight:700;margin:2px 0}' +
    '.m .sub{font-size:12px;color:#94a3b8}' +
    '.sug li{margin-bottom:8px}.sug span{display:block;color:#475569;font-size:14px}' +
    '.transcript{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' +
    'white-space:pre-wrap;font-size:14px;color:#334155}' +
    'footer{margin-top:36px;border-top:1px solid #e2e8f0;padding-top:12px;color:#94a3b8;font-size:12px}' +
    '@media print{body{padding:0}h2{page-break-after:avoid}.m,.score{page-break-inside:avoid}}' +
    '</style></head><body>' +
    '<header><h1>讲台求生 · 试讲复盘报告</h1>' +
    '<div class="meta">课题：' + esc(meta.subject || '—') + '　·　学段：' + esc(meta.grade || '—') +
    '　·　' + esc(meta.owner ? meta.owner + '　·　' : '') + created.toLocaleString('zh-CN') + '</div></header>' +
    '<div class="score"><div class="num">' + esc(score) + '</div><div>' +
    '<b style="font-size:15px">总分</b><p style="margin:4px 0 0;color:#475569;font-size:14px">' +
    esc(report.summary || '') + '</p></div></div>' +
    metricCards(report) +
    suggestionList(report) +
    (meta.transcript ? '<h2>试讲逐字稿</h2><div class="transcript">' + esc(meta.transcript) + '</div>' : '') +
    '<footer>本报告由「讲台求生」AI 试讲教练生成 · 可打印或另存为 PDF</footer>' +
    '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print()}catch(e){}},400)})</scr' + 'ipt>' +
    '</body></html>';
}

/* ==================================================================
   师范院校标准「实习/试讲考核表」
   ================================================================== */
function buildEvaluationForm(report, meta) {
  meta = meta || {};
  const rows = [
    ['教学目标', 15, report.goal_score],
    ['内容处理', 20, report.content_score],
    ['教学过程', 25, report.process_score],
    ['教学方法与手段', 15, report.method_score],
    ['教学基本功', 15, report.basic_score],
    ['教学效果', 10, report.effect_score],
  ];
  // 未提供分项分时，按总分比例折算，保证表格不空
  const total = Number(report.overall_score) || 0;
  const tableRows = rows.map(([name, full, val]) => {
    const v = val != null ? Number(val) : Math.round((total * full) / 100);
    return '<tr><td class="nm">' + esc(name) + '</td><td class="fu">' + full + '</td>' +
      '<td class="sc">' + v + '</td>' +
      '<td class="cm">' + esc((report.dimensions && report.dimensions[name]) || '') + '</td></tr>';
  }).join('');

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<title>试讲考核表 · ' + esc(meta.subject || '') + '</title><style>' +
    'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1e293b;margin:0;padding:36px;max-width:800px;margin:0 auto}' +
    '.hd{text-align:center;border-bottom:2px solid #1e293b;padding-bottom:14px;margin-bottom:8px}' +
    '.hd h1{margin:0 0 6px;font-size:22px;letter-spacing:2px}' +
    '.hd .sub{font-size:12px;color:#64748b}' +
    '.info{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}' +
    '.info td{border:1px solid #94a3b8;padding:7px 10px}' +
    '.info td.lb{background:#f1f5f9;width:110px;color:#334155}' +
    'table.score{width:100%;border-collapse:collapse;font-size:14px;margin-top:6px}' +
    'table.score th{border:1px solid #94a3b8;background:#f1f5f9;padding:8px}' +
    'table.score td{border:1px solid #94a3b8;padding:9px 10px;vertical-align:top}' +
    'td.nm{width:22%;font-weight:600}td.fu{width:10%;text-align:center}td.sc{width:10%;text-align:center;font-weight:700;color:#4F46E5}' +
    'td.cm{font-size:13px;color:#475569}' +
    '.tot{margin:14px 0;font-size:16px}.tot b{font-size:26px;color:#4F46E5;margin:0 6px}' +
    '.advice{border:1px solid #94a3b8;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.8;min-height:90px;margin-bottom:10px}' +
    '.sign{margin-top:36px;display:flex;justify-content:space-between;font-size:13px;color:#475569}' +
    '.sign div{text-align:center}.sign span{display:block;border-top:1px solid #94a3b8;margin-top:6px;padding-top:4px;min-width:120px}' +
    '@media print{body{padding:0}}' +
    '</style></head><body>' +
    '<div class="hd"><h1>师范生试讲考核表</h1>' +
    '<div class="sub">讲台求生 AI 试讲教练 · 自动生成（可作为过程性评价参考）</div></div>' +
    '<table class="info">' +
    '<tr><td class="lb">实习生</td><td>' + esc(meta.owner || '') + '</td><td class="lb">学科课题</td><td>' + esc(meta.subject || '') + '</td></tr>' +
    '<tr><td class="lb">授课年级</td><td>' + esc(meta.grade || '') + '</td><td class="lb">评价日期</td><td>' + new Date().toLocaleDateString('zh-CN') + '</td></tr>' +
    '</table>' +
    '<table class="score"><tr><th>评价项目</th><th>满分</th><th>得分</th><th>评语依据</th></tr>' +
    tableRows + '</table>' +
    '<p class="tot">总评得分：<b>' + esc(report.overall_score != null ? report.overall_score : '—') + '</b> / 100</p>' +
    '<p style="font-weight:600;margin:16px 0 6px">总体评语</p>' +
    '<div class="advice">' + esc(report.summary || '') +
    (((report.suggestions || []).map((s) => '· ' + (typeof s === 'string' ? s : (s.title || '') + '：' + (s.detail || ''))).join('<br>')) || '') +
    '</div>' +
    '<p style="font-weight:600;margin:0 0 6px">改进建议（下一次试讲重点）</p>' +
    '<div class="advice">' + esc(meta.nextFocus || (report.suggestions && report.suggestions[0] ? (report.suggestions[0].title || '') : '')) + '</div>' +
    '<div class="sign"><div>指导教师<span>签名</span></div><div>教研组长<span>签名</span></div><div>院系<span>盖章</span></div></div>' +
    '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print()}catch(e){}},400)})</scr' + 'ipt>' +
    '</body></html>';
}

module.exports = { buildExportHtml, buildEvaluationForm };
