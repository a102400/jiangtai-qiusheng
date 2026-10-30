'use strict';

/* ==================================================================
 * 提问与追问专项训练 · 本地文本量规（纯函数，无 DOM 依赖）
 * ----------------------------------------------------------------
 * 这个文件只做一件事：把一段会话（session.messages）按三条量规判成
 * 一个 evaluation 对象。它**不碰** DOM、window 存储、网络，因此可以被
 * node:test 直接加载单测（见 tests/question-drill-local.test.js）。
 *
 * 设计边界（与 question-drill.js 顶部声明一致，务必遵守）：
 *  - 这是**明确标注的本地启发式规则**，不调用模型，不冒充「AI 客观评分」
 *    或「教学效果证据」。
 *  - 未识别 ≠ 没发生。规则没找到线索只说明文本规则没看到，不推断学生
 *    理解或学习效果。
 *  - evidence_quote 必须是教师发言原文的子串，不得编造。
 *  - 三项量规各自独立打分，**不做求和**，也不产生总分。
 *
 * 三条量规的判据（为什么这样设计，见各段注释）：
 *  - clear_question_task  提出明确问题或任务：有提问标记或请求/任务动词，
 *    且不是教师自己在讲（排除「我来解释一下…」这类第一人称讲授句）。
 *  - expression_space     给学生留下表达思路的空间：句子里既要有「表达类」
 *    词（说说/理由/思路/为什么…），又要构成提问或请求。只看疑问号会把
 *    带读句（「大家看这里」）算成邀请，所以必须两者同时成立。
 *  - follow_up_adaptation 根据学生回应继续追问：既要承接学生（最长公共字串，
 *    或「接纳/肯定语 + 第二人称回指」——先接住「不会 / 不知道」的处境
 *    （答对场景则为「说得对 / 很好」），再对一个还留在这个话题里的追问
 *    分句说「你/您」），又要继续追问且没终止话题（换个人/下一题…）。
 *    终止语按**分句**判定，只对自己所在的分句生效，所以
 *    「你刚才说不会，那我们换个人」里前半句的承接仍然算数。
 *    「没关系」只作接纳语、不作终止语 —— 一个词挂两个身份会把无逗号的
 *    「没关系你再说说你的思路？」整句打死（那是同批最该奖励的动作）。
 *    继续追问的分句若和教师第一人称讲授分句同源（「我来解释一下…」
 *    「我们来看这个结论」），不算追问 —— 那是自述讲解，不是对这个学生发问。
 *    只满足一半 → partial，不满足 → not-found，无学生发言 → not-observable。
 * ================================================================== */

(function initQuestionDrillRules(global) {
  /* ---------------- 通用小工具 ---------------- */

  /* 分句：把整段话切成以标点为界的短句，标点保留在句尾，
     这样「你为什么这么想？」里的问号才不会丢。 */
  const CLAUSE_RE = /[^，。！？；：、,.!?;:\n]+[，。！？；：、,.!?;:]?/g;

  function splitClauses(text) {
    const raw = String(text == null ? '' : text);
    const matched = raw.match(CLAUSE_RE);
    if (!matched) return [];
    return matched
      .map(function (one) {
        return one.trim();
      })
      .filter(Boolean);
  }

  function hanziOnly(text) {
    return String(text == null ? '' : text).replace(/[^\u4e00-\u9fa5]/g, '');
  }

  /**
   * 最长公共子串（按字符，返回值是那个子串本身）。
   * 用滚动一维 DP：只需比较学生发言（几十字）与教师发言，成本可忽略。
   * 之所以不用分词正则：中文连续文本上 `[\u4e00-\u9fff]{2,}` 是贪婪整句
   * 匹配，长句永远匹配不到教师句里的局部片段（旧实现的系统性漏判根源）。
   */
  function longestCommonSubstring(a, b) {
    const s1 = String(a == null ? '' : a);
    const s2 = String(b == null ? '' : b);
    if (!s1 || !s2) return '';

    let prev = new Array(s2.length + 1).fill(0);
    let bestLen = 0;
    let bestEnd = 0;

    for (let i = 1; i <= s1.length; i++) {
      const cur = new Array(s2.length + 1).fill(0);
      for (let j = 1; j <= s2.length; j++) {
        if (s1.charAt(i - 1) === s2.charAt(j - 1)) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > bestLen) {
            bestLen = cur[j];
            bestEnd = i;
          }
        }
      }
      prev = cur;
    }

    return bestLen ? s1.slice(bestEnd - bestLen, bestEnd) : '';
  }

  /* ---------------- 量规一 / 二：分句级判据 ---------------- */

  /* 教师第一人称讲授句：主语是「我 / 我们」且谓语是讲课动作。
     这类句子即使含「解释」「看」也不构成对学生的邀请或任务。
     例：「我来解释一下这个公式」「我们来看这个结论」 */
  const TEACHER_SELF_CLAUSE =
    /^(?:那么?|好|嗯|OK)?\s*(?:我|我们)(?!们)(?:来|先|再|就|给|带|看|说|讲|解释|示范|总结|一起|把|要)/;

  /* 表达类词（强）：出现即说明这句话在谈「怎么说/为什么/理由/思路」 */
  const EXPRESSION_STRONG =
    /说说|说一说|讲讲|讲一讲|谈谈|谈一谈|聊一聊|解释|理由|思路|想法|看法|观点|举例|例子|展开|为什么|怎么|如何/;

  /* 表达类词（弱）：方法/解法类名词，只有构成提问时才算邀请表达思路。
     「这道题有三种不同的方法」是陈述事实，不是邀请。 */
  const EXPRESSION_WEAK = /方法|解法|步骤|过程|别的|不同|觉得|认为/;

  /* 疑问标记 */
  const QUESTION_MARK =
    /[?？]|吗|呢|为什么|怎么|如何|哪些|什么|是否|谁|多少|对不对|好不好|是不是/;

  /* 请求 / 祈使标记（要求对方做某件事） */
  const REQUEST_MARK =
    /请|试着|能不能|能否|可以说|可以讲|可以谈|可以举|可以解释|说说|说一说|讲讲|讲一讲|谈谈|谈一谈|聊一聊|展开|解释一下|举个例子/;

  /* 明确的任务动词（要交出一个结果，而不是只在听）。
     注意不要收「写清楚」这类书写要求：那是教师在讲规范
     （「解释这一步要写清楚」），并没有向学生发出作答任务。 */
  const TASK_MARK =
    /写出|写下|计算|完成|证明|画出|列出|列表|找出|列式|想一想|思考|讨论|做一下|练一练|动笔|默写|读一读|背一背/;

  /* 假提问：问的是「听懂了吗」而不是「说说思路」，学生只需点头/报答案。
     这类句子不算邀请表达（但仍算提出了问题 → clear 给分，space 只给部分线索）。 */
  const FAKE_CHECK = /会了吗|会了没|懂了吗|明白了没|明白了吗|听懂了|听明白|清楚了吗/;

  /* 把一段教师发言切成分句后，逐句判断 */
  function clauseInvitesExpression(clause) {
    if (TEACHER_SELF_CLAUSE.test(clause)) return false;
    if (FAKE_CHECK.test(clause)) return false;
    if (EXPRESSION_STRONG.test(clause)) {
      return QUESTION_MARK.test(clause) || REQUEST_MARK.test(clause);
    }
    if (EXPRESSION_WEAK.test(clause)) {
      /* 弱表达词只认「提问」：「大家还有别的解法吗？」算，
         「这道题有三种不同的方法。」不算。 */
      return QUESTION_MARK.test(clause);
    }
    return false;
  }

  function clauseGivesTask(clause) {
    if (TEACHER_SELF_CLAUSE.test(clause)) return false;
    return (
      QUESTION_MARK.test(clause) ||
      REQUEST_MARK.test(clause) ||
      TASK_MARK.test(clause)
    );
  }

  function findQuote(texts, predicate) {
    for (let i = 0; i < texts.length; i++) {
      const clauses = splitClauses(texts[i]);
      if (clauses.some(predicate)) return texts[i];
    }
    return '';
  }

  /* ---------------- 量规三：承接学生回应 ---------------- */

  /* 终止语：出现这些词说明教师结束/跳过这个话题，不是继续追问。
     ⚠️ 只在**分句级**生效（见 clauseKeepsAsking），绝不整句命中即降级：
         「你刚才说不会，那我们换个人」
     前半句接住了学生原话，后半句才终止。整句降级会把「先接住、再收口」
     里那半句真实的承接一起抹掉。

     ⚠️ 这里**不含**「没关系」。它同时是答错场景的接纳语（见 FOLLOW_ACK），
     一个词挂两个身份会把无逗号写法打死：
         「没关系你再说说你的思路？」
     整句只有这一个分句，判终止就是 0 分 —— 而「先接住处境、再请他说
     思路」恰恰是这套量规最该奖励的动作，比「换个人」还低分是方向性误判。
     所以终止语只收真正**把话头转给别的对象/话题**的词
     （换人 / 跳题 / 课后 / 坐下）。「没关系，我们看下一题」不会因此漏判：
     后半句的「下一题」自己就是终止语，前面那半句也没有追问标记。 */
  const FOLLOW_ABORT = /换个人|下一位|先跳过|课后|坐下|下一题/;

  /* 接纳语 + 肯定语：都算「先接住学生，再继续邀请」。
    ｜接纳语（答错场景）：学生说「不会 / 不知道」，教师先接住他的处境，
      再邀请他说下去。承接的是**当下的困难**，不是他说的具体字词
      （学生只说「不会」两个字，教师也说不出「不会」以外的原词可借）。
    ｜肯定语（答对场景）：学生答出了要点，教师先肯定，再追问理由
      （「说得对，你再说说为什么是平角？」）。承接的是**他答对的那个点**。
      这同样是标准教学动作；不给它出路，量规就在惩罚正确行为。

     ⚠️ 两类词**走完全相同的条件**，肯定语不享受任何后门。它们都只是
     课堂里的通用开场语，单独出现不能证明「承接的是这个学生」：
     一句「很好」既可能在肯定他，也可能在收场（「很好，我们看下一题」）；
     一句「没关系」既可能接住他，也可能在换话题（「没关系，那地球是
     什么形状？」）。文本规则唯一能机械区分「接住后继续追这个学生」和
     「接住后换话题 / 自述讲解」的线索是**第二人称回指**：追问分句里
     有没有「你 / 您」。所以两类词都只在追问分句含 SECOND_PERSON 时
     才算承接，否则最多到 partial。见 evaluateFollowUp。

     ⚠️ 肯定语不收单字「对」：它太宽（「对，下一题」「对，就是这个」都含），
     没有第二人称约束时必然变成高频误报。只收两字以上的固定肯定说法。 */
  const FOLLOW_ACK =
    /没关系|不要紧|没事|别急|慢慢来|不着急|不用紧张|很正常|可以理解|说得对|说对了|很好|非常好|不错|没错|答对了|思路对/;

  /* 第二人称回指：把这句追问指向「你（这个学生）」，而不是泛指全班
     或转向别的对象。 */
  const SECOND_PERSON = /你|您/;

  /* 继续追问的语言线索：疑问或请求 */
  const FOLLOW_ASK =
    /[?？]|吗|呢|为什么|怎么|如何|能不能|能否|请|说说|说一说|讲讲|谈谈|解释|展开|再说|还有|试着|谁|继续/;

  /* 单个分句是否在继续追问：不是教师自述讲解，含追问标记，且本分句内
     没有终止语。终止语只对「自己所在的那个分句」生效。

     ⚠️ 先排除 TEACHER_SELF_CLAUSE（与量规一 / 二**同一个常量**，不另写
     判据）：否则「没关系，我来解释一下平行线」里的「解释」会被当成追问，
     教师自述讲解从 follow_up_adaptation 这个后门又回来了 —— 这一轮刚把
     「我来解释」从 expression_space 里踢出去，两处口径必须同源。 */
  function clauseKeepsAsking(clause) {
    if (TEACHER_SELF_CLAUSE.test(clause)) return false;
    return FOLLOW_ASK.test(clause) && !FOLLOW_ABORT.test(clause);
  }

  /**
   * 整句里**在继续追问**的那些分句（可能为空）。
   *  - 先按标点切分句（复用 splitClauses，标点保留）；
   *  - 逐句过 clauseKeepsAsking；
   *  - 返回分句本身而不是布尔值，因为接纳语计分还要检查这些分句里
   *    有没有第二人称回指（「你 / 您」）。
   * 注意：「换个人说说你的思路？」这种同一分句里既终止又追问的，仍按
   * 终止处理 —— clauseKeepsAsking 里终止语优先，那确实不是在跟这个学生
   * 继续聊。
   */
  function askingClauses(text) {
    const clauses = splitClauses(text);
    if (!clauses.length) {
      const whole = String(text == null ? '' : text).trim();
      return clauseKeepsAsking(whole) ? [whole] : [];
    }
    return clauses.filter(clauseKeepsAsking);
  }

  /* 整句里是否有一句在「接住这个学生」—— 接纳他的困难，或肯定他答对的点。
     两类词共用 FOLLOW_ACK，所以这里只判词，不判是否继续追问
     （不要求该分句不含终止语：「没关系，我们看下一题」确实先接住了，
     只是没继续追问 → partial；是否升 observed 由 evaluateFollowUp 的
     第二人称回指约束决定）。 */
  function acknowledgesStudent(text) {
    return splitClauses(text).some(function (clause) {
      return FOLLOW_ACK.test(clause);
    });
  }

  /**
   * 教师句是否承接了学生原话。
   * 阈值随学生发言长度自适应：学生说了 20+ 字时，教师只要接住其中
   * 3 个连续汉字即可（真实追问只引用局部）；学生只说「不会」两个字时，
   * 则要求整句出现（否则「不会」这种 2 字发言永远拿不到分，
   * 而它恰恰是最需要教师承接的情况）。
   */
  function sharesStudentWording(studentText, teacherText) {
    const studentHan = hanziOnly(studentText);
    if (!studentHan) return false;
    const need = Math.min(3, Math.max(2, studentHan.length));
    return (
      longestCommonSubstring(studentHan, hanziOnly(teacherText)).length >= need
    );
  }

  function evaluateFollowUp(messages) {
    let bestLevel = 0;
    let bestQuote = '';
    let sawStudent = false;

    for (let i = 0; i < messages.length; i++) {
      const current = messages[i];
      if (!current || current.role !== 'student') continue;
      if (typeof current.content !== 'string' || !current.content.trim()) continue;

      sawStudent = true;

      const nextTeacher = messages
        .slice(i + 1)
        .find((message) => message && message.role === 'teacher');
      if (!nextTeacher || typeof nextTeacher.content !== 'string') continue;

      const teacherText = nextTeacher.content.trim();
      if (!teacherText) continue;

      /* 承接 = 接住了学生的具体用词，或「先接住学生 + 追问仍指回这个学生」。
         第二句里的两个条件缺一不可，且对接纳语与肯定语一视同仁：
         只有「接纳/肯定」没有追问 → 是收场，不是承接；
         只有追问没有第二人称回指 → 可能是转向全班或换话题，走保守口径。 */
      const asks = askingClauses(teacherText);
      const continuing = asks.length > 0;
      const ackPointsBackAtStudent =
        acknowledgesStudent(teacherText) &&
        asks.some(function (clause) {
          return SECOND_PERSON.test(clause);
        });
      const borrowed =
        sharesStudentWording(current.content, teacherText) ||
        ackPointsBackAtStudent;

      /* 两条件都成立才是 observed(2)；
         只成立一个（承接了但换人 / 追问了但没接住原话）只能算部分线索(1)。 */
      const level = borrowed && continuing ? 2 : borrowed || continuing ? 1 : 0;

      if (level > bestLevel) {
        bestLevel = level;
        bestQuote = teacherText;
      }
      if (bestLevel === 2) break;
    }

    return { level: bestLevel, quote: bestQuote, sawStudent: sawStudent };
  }

  /* ---------------- 主函数：session → evaluation ---------------- */

  function evaluateLocalRules(session) {
    const messages = Array.isArray(session && session.messages)
      ? session.messages
      : [];

    const teachers = messages.filter(
      (message) =>
        message &&
        message.role === 'teacher' &&
        typeof message.content === 'string' &&
        message.content.trim()
    );

    const students = messages.filter(
      (message) =>
        message &&
        message.role === 'student' &&
        typeof message.content === 'string' &&
        message.content.trim()
    );

    const teacherText = teachers.map((message) => message.content.trim());

    const clearQuote = findQuote(teacherText, clauseGivesTask);
    const spaceQuote = findQuote(teacherText, clauseInvitesExpression);

    const follow = evaluateFollowUp(messages);
    const followLevel = follow.level;

    const dimensions = [
      {
        key: 'clear_question_task',
        score: clearQuote ? 2 : 0,
        evidence_quote: clearQuote,
        evidence_status: clearQuote ? 'observed' : 'not-found',
        feedback: clearQuote
          ? '文本中出现了明确的问题或任务。'
          : '当前文本规则未找到明确的问题或任务；请核对原句，也可补充明确的提问对象或作答任务。',
      },
      {
        key: 'expression_space',
        score: spaceQuote ? 2 : clearQuote ? 1 : 0,
        evidence_quote: spaceQuote || clearQuote,
        evidence_status: spaceQuote
          ? 'observed'
          : clearQuote
            ? 'partial'
            : 'not-found',
        feedback: spaceQuote
          ? '文本中邀请学生说明理由、思路或观点，而不只是报答案。'
          : clearQuote
            ? '文本中有提问线索，但暂未找到明确邀请学生展开思路的表达。'
            : '当前文本规则未找到表达邀请。可以尝试询问理由、方法或不同可能。',
      },
      {
        key: 'follow_up_adaptation',
        score: followLevel,
        evidence_quote: follow.quote,
        evidence_status:
          followLevel === 2
            ? 'observed'
            : followLevel === 1
              ? 'partial'
              : students.length === 0
                ? 'not-observable'
                : 'not-found',
        feedback:
          followLevel === 2
            ? '找到教师回应学生具体用词后继续追问的文本线索。'
            : followLevel === 1
              ? '找到继续追问的语言线索，但规则无法确认它是否针对学生的具体想法。'
              : students.length === 0
                ? '当前对话没有学生回应，无法观察教师是否根据学生回应调整。'
                : '当前文本规则未找到明确承接学生回应的线索。',
      },
    ];

    return {
      status: 'complete',
      evaluation_source: 'local-heuristic',
      rubric_version: 'question-drill-v2',
      dimensions,
      summary:
        '本反馈只依据文本中可观察到的表达线索。规则未识别到某项行为，不代表该行为一定没有发生。',
      boundary_note:
        '以上仅为文本和对话行为指标，不代表已经测得学生的真实理解。',
    };
  }

  const api = {
    evaluateLocalRules,
    longestCommonSubstring,
  };

  if (global && typeof global === 'object') {
    global.jtqQuestionDrillRules = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
