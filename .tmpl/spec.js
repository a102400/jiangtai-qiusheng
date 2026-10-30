
(function () {
  'use strict';

  /* 参数表：value 一律照抄源码里的数字，不凭印象写。
     src 说明它从哪来；note 说明「为什么是这个数」，方便你判断要不要。 */
  var DATA = [
    {
      title: '一、区块渐入（滚动进入视野时）',
      sub: 'motion.css / motion.js',
      rows: [
        { id: 'rv-y', name: '上浮距离', value: '20px', src: 'taste', note: '再大就像弹窗飞进来；再小看不出「进来了」。' },
        { id: 'rv-o', name: '透明度时长', value: '620ms', src: 'taste', note: '透明度先到位，位移还在收尾，观感更松弛。' },
        { id: 'rv-t', name: '位移时长', value: '820ms', src: 'taste', note: '长位移配长时长，避免「啪」一下到位的机械感。' },
        { id: 'rv-st', name: '同批错峰', value: '50ms × 最多 8 档', src: 'AnimatedList', note: '报告一次冒出十几张卡片时，逐张出现而不是整片闪。' },
        { id: 'rv-first', name: '首屏是否等滚动', value: '不等，立即入场', src: '本站', note: '本站没有加载屏，等滚动会让首屏空着。' },
        { id: 'rv-once', name: '是否随滚动重播', value: '只播一次', src: 'taste', note: '反复重播是最典型的「模板感」。' },
        { id: 'rv-max', name: '一页最多挂载点', value: '48 个', src: '本站', note: '护栏：防止某个页面把整页所有 div 都挂上隐藏态。' }
      ]
    },
    {
      title: '二、标题遮罩行（大标题按视觉行升起）',
      sub: 'motion.css / motion.js',
      rows: [
        { id: 'ln-mask', name: '遮罩偏移', value: '110%', src: 'taste', note: '多出的 10% 是为了让文字完全藏在遮罩外，带一点下划线也不露头。' },
        { id: 'ln-st', name: '行间错峰', value: '每行递增', src: 'taste', note: '两行标题几乎同时起、第二行晚一点，读起来有节奏。' },
        { id: 'ln-dur', name: '单行时长', value: '800ms · expo-out', src: 'taste', note: 'expo 的急停感替代回弹，结尾利落不冲过头。' },
        { id: 'ln-only', name: '拆分范围', value: '仅纯文本标题，≤160 字', src: '本站', note: '含子元素的标题不拆（landing 的中英双语会被拍平）。' }
      ]
    },
    {
      title: '三、材质（圆角 / 阴影 / 毛玻璃 / 颗粒）',
      sub: 'material.css',
      rows: [
        { id: 'mt-r', name: '圆角档位', value: '8 / 10 / 16 / 999px 四档', src: 'taste', note: '改之前站内有 8 种圆角（12/10/999/99/14…），看起来像几个人拼的。' },
        { id: 'mt-e', name: '三级高程', value: '静止 / hover / 浮层', src: 'taste', note: '静止卡片几乎无阴影，只有浮层才有明显投影。' },
        { id: 'mt-glass', name: '毛玻璃', value: 'blur 14px · saturate 180%', src: 'taste（限 4 类浮层）', note: '只给顶栏 / 弹窗 / 下拉 / Toast；正文卡片一律不透明（毛玻璃正文会糊字）。' },
        { id: 'mt-grain', name: '颗粒纹理', value: 'alpha 0.05', src: 'taste', note: '极淡一层，负责「不是纯色块」的质感；.no-texture 可一键关掉。' },
        { id: 'mt-mesh', name: '渐变网格', value: '三团 radial，alpha ≤0.075', src: 'taste', note: '不写底色，只叠光斑——写底色会盖掉 workbench / landing 各自的背景。' }
      ]
    },
    {
      title: '四、背景粒子与极光',
      sub: 'fx.js / fx.css',
      rows: [
        { id: 'fx-den', name: '粒子密度', value: '面积 ÷ 13000', src: '本站（调过）', note: '最初 ÷26000 在浅蓝底上完全看不见，翻倍后才成立。' },
        { id: 'fx-cap', name: '数量夹取', value: '40 – 110 颗', src: '本站', note: '大屏不无限加、小屏不至于没有。' },
        { id: 'fx-r', name: '半径', value: '0.9 – 3.1px', src: '本站（调过）', note: '1–2px 在浅色底上会被当成脏点。' },
        { id: 'fx-a', name: '透明度', value: '0.20 – 0.46', src: '本站（调过）', note: '原来 0.08–0.26 实测不可见。' },
        { id: 'fx-z', name: '深度层', value: 'z 0.25 – 1.0', src: '本站', note: '用 CSS 造纵深，替代 Three.js 的相机视差。' },
        { id: 'fx-scroll', name: '滚动视差', value: '0.07 × z', src: '本站', note: '逐粒位移而不是整层平移——整层平移读不出前后关系。' },
        { id: 'fx-mouse', name: '鼠标视差', value: '22px × z', src: '本站', note: '指针移动时近处的粒子动得多，远处几乎不动。' },
        { id: 'fx-aurora', name: '极光呼吸', value: '0.80 ± 0.20 · 周期 2600ms', src: '本站', note: '正弦呼吸，避免背景是死的。' },
        { id: 'fx-dpr', name: 'DPR 上限', value: '2', src: '本站', note: '3 倍屏不铺 3 倍像素，肉眼几乎无差、开销省一半。' },
        { id: 'fx-degrade', name: '掉帧降级', value: '连续 90 帧 >26ms → 12 颗 → 全关', src: '本站', note: '宁可没有特效，也不要卡。' }
      ]
    },
    {
      title: '五、卡片倾斜与拆台高光',
      sub: 'fx.js',
      rows: [
        { id: 'tl-deg', name: '倾斜上限', value: '6.5°（perspective 900px）', src: '本站（调过）', note: '4.5° 太含蓄，6.5° 才有手感。' },
        { id: 'tl-lerp', name: '倾斜跟随系数', value: '0.18 / 帧', src: '本站', note: '数值越小越「糯」，越大越跟手。' },
        { id: 'hk-flash', name: '拆台红闪 + 抖动', value: '全屏红闪 + 元素抖动', src: '本站', note: 'AI 学生拆台时的高光动作，路演最抓眼的一下。' },
        { id: 'hk-wait', name: '抖动让路', value: '入场未完成时等 660ms', src: '本站', note: '入场用 transition、抖动用 animation，同时跑会互相覆盖。' }
      ]
    },
    {
      title: '六、数字滚动（CountUp）',
      sub: 'countup.js · 本周新增',
      rows: [
        { id: 'cu-score', name: '报告总分', value: '机械数字列 · 2s', src: 'CountUp（模板默认 2s）', note: '总分是这一页的主角，值得 2 秒的仪式感。' },
        { id: 'cu-grid', name: '指标卡数值', value: '文本插值 · 1.1s', src: '本站（模板 2s 偏拖）', note: '一屏 6 个数字同时滚 2 秒，会让人觉得页面没加载完。' },
        { id: 'cu-ease', name: '缓动', value: 'cubic-bezier(.33,1,.68,1)', src: 'CountUp', note: '前段极快、后半段收得慢：0.15 处已到 38%，0.5 处到 87%。' },
        { id: 'cu-cell', name: '数字格尺寸', value: '1.2em / 格 · 每列 4 格', src: 'CountUp', note: '4 格刚好够上下缓冲，多了是浪费节点。' },
        { id: 'cu-st', name: '列间错峰', value: '0.07s（压进总时长 40%）', src: 'CountUp', note: '各位不同时起跑，像真的机械计数器。' },
        { id: 'cu-turn', name: '低位旋转圈数', value: '最多 3 圈', src: 'CountUp', note: '个位转 3 圈、十位 2 圈、百位 1 圈——越靠右越活泼。' },
        { id: 'cu-blur', name: '运动中动态模糊', value: '≤ 格高的 5%', src: 'CountUp', note: '快速滚动时轻微纵向模糊；落位必须清零，否则最后一位一直糊。' },
        { id: 'cu-fold', name: '落位后', value: '换回纯文本', src: '本站（模板留着滚动 DOM）', note: '不换回的话，复制和读屏会读到「012908…」一整串格子。' },
        { id: 'cu-ring', name: '分数环同步', value: '与数字同一条曲线', src: '本站', note: '数字到 60 时环也正好 60%，两条线不同步会像各说各话。' }
      ]
    },
    {
      title: '七、结论句模糊渐入（BlurText）',
      sub: 'blurtext.js · 本周新增',
      rows: [
        { id: 'bt-dur', name: '单字时长', value: '700ms（350ms × 2 段）', src: 'BlurText', note: '模板 stepDuration 默认 0.35s、三个关键帧两段。' },
        { id: 'bt-blur', name: '模糊量', value: '10px → 5px → 0', src: 'BlurText', note: '中途 5px + 半透明，像从雾里被「解析」出来。' },
        { id: 'bt-y', name: '位移', value: '+50px → -5px → 0', src: 'BlurText', note: '先下后上一点再归位，这一下小回摆是它显得「活」的原因。' },
        { id: 'bt-st', name: '逐字错峰', value: '200ms，压缩到总错峰 ≤1s', src: 'BlurText（压缩为本站改）', note: '40 个字按 200ms 排要 8 秒才出完，必须压。' },
        { id: 'bt-ease', name: '缓动', value: 'linear', src: 'BlurText', note: '这一档模板本来就用线性——模糊和位移同帧推进才不脱节。' },
        { id: 'bt-punct', name: '标点处理', value: '句读标点粘前一个字', src: '本站', note: '标点单独成片会被挤到行首。' }
      ]
    },
    {
      title: '八、对话消息入场',
      sub: 'msg.css / msg.js',
      rows: [
        { id: 'ms-spring', name: '弹簧曲线', value: '29 点 linear() · 峰值 1.0828', src: 'AnimatedList', note: '约 8.3% 过冲后收敛，是它「有弹性」的全部来源。' },
        { id: 'ms-t', name: '过渡', value: 'transform 620ms / opacity 300ms', src: 'AnimatedList', note: '位置慢慢弹到位，透明度快速到位，不会出现「半透明块在飘」。' },
        { id: 'ms-d', name: '位移', value: '18px（模板 28px）', src: '本站（唯一改动）', note: '气泡行距只有 12px，28px 会在起始帧压住上一条。' },
        { id: 'ms-s', name: '缩放', value: '0.98', src: 'AnimatedList', note: '几乎看不见的缩放，但去掉后会显得「硬」。' },
        { id: 'ms-st', name: '消息间错峰', value: '50ms', src: 'AnimatedList', note: '和报告卡片的 50ms 是同一套节奏。' },
        { id: 'ms-dir', name: '三种方向', value: '学生上浮 / 教师右进 / 系统淡入', src: '本站', note: '对话里能一眼分清「谁在说」。' },
        { id: 'ms-caret', name: '末尾光标', value: '0.5s × 4 次', src: 'TextType', note: '不做全文字打字机（60~120 字要 3~6 秒，会拖慢阅读）。' },
        { id: 'ms-typing', name: '等待三点', value: '1.2s 循环', src: '本站', note: 'AI 学生思考时对话区不能一动不动。' }
      ]
    },
    {
      title: '九、交互反馈',
      sub: 'motion.css / ui.css',
      rows: [
        { id: 'ui-press', name: '按压', value: 'scale(.975) · 140ms', src: 'taste', note: '按下要有回应，抬起来要马上回。' },
        { id: 'ui-hover', name: 'hover 变色', value: '180ms', src: 'taste', note: '比按压慢一点，避免鼠标划过时一片闪。' },
        { id: 'ui-focus', name: '焦点环', value: '2px brand · offset 2px', src: '本站', note: '键盘用户要能看见自己在哪。' },
        { id: 'ui-loading', name: '按钮加载态', value: '文字保留 + 转圈', src: '本站', note: '不把按钮文字换成「加载中」，避免布局跳动。' }
      ]
    },
    {
      title: '十、降级与开关',
      sub: '全局',
      rows: [
        { id: 'gd-reduce', name: '减少动效', value: '系统开启后全部退掉', src: '本站', note: 'prefers-reduced-motion: reduce → 数字、模糊、粒子、弹簧一个都不注册。' },
        { id: 'gd-js', name: '无 JS', value: '内容全可见', src: '本站', note: '所有隐藏态都挂在 html.js 下，脚本没跑就不会白屏。' },
        { id: 'gd-texture', name: '颗粒开关', value: '.no-texture 一键关', src: '本站', note: '觉得颗粒脏就加这个类，不用改 CSS。' }
      ]
    }
  ];

  var KEY = 'jtq-motion-spec-v1';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }

  var rows = [];
  DATA.forEach(function (sec) {
    sec.rows.forEach(function (r) {
      if (!state[r.id]) state[r.id] = 'yes';
      rows.push(r);
    });
  });

  var listEl = document.getElementById('list');
  var html = DATA.map(function (sec) {
    var body = sec.rows.map(function (r) {
      return '<div class="row" data-id="' + r.id + '" data-state="' + state[r.id] + '">' +
        '<div>' +
          '<div class="p-name">' + esc(r.name) +
            '<span class="p-val">' + esc(r.value) + '</span>' +
            '<span class="p-src">' + esc(r.src) + '</span>' +
          '</div>' +
          '<div class="p-note">' + esc(r.note) + '</div>' +
        '</div>' +
        '<div class="seg" role="group" aria-label="' + esc(r.name) + ' 取舍">' +
          '<button type="button" data-s="yes" aria-pressed="' + (state[r.id] === 'yes') + '">要</button>' +
          '<button type="button" data-s="todo" aria-pressed="' + (state[r.id] === 'todo') + '">待定</button>' +
          '<button type="button" data-s="no" aria-pressed="' + (state[r.id] === 'no') + '">不要</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<section><h2>' + esc(sec.title) + '<span>' + esc(sec.sub) + '</span></h2>' + body + '</section>';
  }).join('');

  listEl.innerHTML = html;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function counts() {
    var c = { yes: 0, no: 0, todo: 0 };
    rows.forEach(function (r) { c[state[r.id]]++; });
    document.getElementById('cYes').textContent = c.yes;
    document.getElementById('cNo').textContent = c.no;
    document.getElementById('cTodo').textContent = c.todo;
    return c;
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-s]') : null;
    if (!btn) return;
    var row = btn.closest('.row');
    var id = row.getAttribute('data-id');
    var next = btn.getAttribute('data-s');
    state[id] = next;
    row.setAttribute('data-state', next);
    Array.prototype.forEach.call(row.querySelectorAll('.seg button'), function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    persist();
    counts();
  });

  document.getElementById('reset').addEventListener('click', function () {
    rows.forEach(function (r) { state[r.id] = 'yes'; });
    persist();
    Array.prototype.forEach.call(listEl.querySelectorAll('.row'), function (row) {
      var id = row.getAttribute('data-id');
      row.setAttribute('data-state', 'yes');
      Array.prototype.forEach.call(row.querySelectorAll('.seg button'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-s') === 'yes'));
      });
    });
    counts();
  });

  document.getElementById('copy').addEventListener('click', function () {
    var no = [], todo = [];
    rows.forEach(function (r) {
      if (state[r.id] === 'no') no.push('· ' + r.name + '（' + r.value + '）');
      if (state[r.id] === 'todo') todo.push('· ' + r.name + '（' + r.value + '）');
    });
    var c = counts();
    var text = '【动效参数取舍 · m4】\n' +
      '要 ' + c.yes + ' / 不要 ' + c.no + ' / 待定 ' + c.todo + '\n\n' +
      '■ 不要（请删掉）：\n' + (no.length ? no.join('\n') : '（无）') + '\n\n' +
      '■ 待定（保留但我想再调）：\n' + (todo.length ? todo.join('\n') : '（无）') + '\n';

    var out = document.getElementById('out');
    out.textContent = text;
    out.classList.add('show');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        document.getElementById('copy').textContent = '已复制 ✓';
        setTimeout(function () { document.getElementById('copy').textContent = '复制我的选择'; }, 1800);
      }, function () {});
    }
  });

  counts();
})();
