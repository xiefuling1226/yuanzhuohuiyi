// 名人圆桌会议 H5 - 核心业务逻辑

// ========== 欢迎语 ==========
const SLOGANS = [
  '以光年为席，聚古今中外智者。',
  '一席光年，对话全人类的思想星光。',
  '跨越时空山海，共赴一场光年之约。',
  '光年之上，思想无界。',
  '微光聚智，对话光年。',
  '光年对话・思想无界。'
];

const WELCOME_MESSAGE = '你好！我是风玲，光年之外圆桌会的主持人。\n\n告诉我你想讨论什么话题，我会为你推荐合适的嘉宾。你也可以点击右上角的 + 号自己挑选参会人员。\n\n准备好了吗？说出你的问题吧！';

/** 第三段按流程图经 LLM 判型后硬注入。D=结束 A=点名 B=有问无点名 C=只续谈 U=不明 */
const FLOWCHART_MSG = {
  D: '[系统通知]【流程图D】用户同意结束/作会议总结。本回复仅【风玲】输出会议总结报告，无嘉宾段；总结后会议结束。',
  A: '[系统通知]【流程图A】用户点名让某位/几位嘉宾回答。本轮嘉宾段仅让被点名的在【】回应用户；无必要不拉未点名者各作长段。随后风玲再邀用户或再征求收束/总结（小循环）。',
  B: '[系统通知]【流程图B】用户有具体问题但没说谁答。风玲据专业/立场点最合适的人在【】先答透，可短补。随后把话筒交还用户或再征求是否收束/总结（小循环）。',
  C: '[系统通知]【流程图C】用户主诉求是再聊/继续/先别收束/未展开新问。风玲新切口+本拍只邀与切口最相关的个别嘉宾各回应一次，防全员同义长念。随后风玲再促用户或再收束问；第三段整体仍可多轮交锋。',
  U: '[系统通知]【流程图U】语义分类无法明确归入A/B/C/D。请风玲据用户本句在第三段主规则下判断；可一句请用户澄清；在无人明确同意前勿输出成稿式终局总结。'
};

// ========== 应用状态 ==========
/** 主持自动续写强控：与 hostedRound/系统注入协同；USER=禁止续链至用户发话，ONE_SHOT=消费一次停链。 */
const HostFlow = { OPEN: 'open', ONE_SHOT: 'one_shot', USER: 'user' };

const state = {
  messages: [],              // { role: 'user'|'assistant', content: string }
  selectedCelebrities: [],   // 已选参会人员 key 列表
  pendingSelection: [],      // 面板中临时勾选的参会人员
  selectionMode: 'auto',     // auto=主持人模式, manual=无主持人模式
  meetingStarted: false,     // 主持人模式下是否已确认开始
  meetingEnded: false,       // 主持人模式下是否已结束并总结
  allowExternalCelebrities: false, // 是否允许推荐名人库之外人员（需用户确认）
  pendingExternalApproval: false,  // 是否正在等待用户确认“库外推荐”授权
  lastRejectedExternalNames: [],   // 最近一轮被拦截的“非真实名人名”候选
  hostedRound: 0,            // 主持人模式：会议开始后已完成的助手回复轮次（三阶段≈3，封顶3）
  awaitingEndConfirmation: false, // 主持人已发起收尾确认，等待用户确认是否结束
  summaryReady: false,       // 用户已确认结束，下一轮应输出会议总结
  autoContinueRetries: 0,    // 自动续写重试次数，防止死循环
  recentHostUtterances: [],  // 最近若干条主持人发言（normalized 文本），用于跨条复读检测
  consecutiveUserInvitePending: 0, // 主持人连续邀请用户但用户未回复的次数
  /** 同一条自动续写链中：已因「S3 末位为嘉宾」强注入过补【风玲】，防止嵌套 check 再次 2819 导致主持人连发多遍邀用户 */
  s3BridgeFromGuestInFlight: false,
  hostFlowLock: HostFlow.OPEN, // 强控门：等用户(USER)与编排单停(ONE_SHOT)优先于所有解析
  hostIntroShown: false,     // 风玲开场自我介绍是否已展示
  isGenerating: false,
  abortController: null,
  isPaused: false,           // 会议是否暂停
  sessionId: Date.now().toString(36), // 当前会话ID
  removedCelebrities: new Set(), // 用户手动删除的参会人员 key 集合（防止重新添加）
};

function getHostNextSegment() {
  return Math.min(3, (state.hostedRound || 0) + 1);
}

/** 强控：下一条起必须等用户发话，禁止一切自动续写 */
function hostFlowRequireUserTurn() {
  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
    state.hostFlowLock = HostFlow.USER;
  }
}

/** 强控：系统已注入「本拍输出后必停链」的续写，下一拍先消费此锁再解析 */
function hostFlowArmOneShotStop() {
  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
    state.hostFlowLock = HostFlow.ONE_SHOT;
  }
}

function hostFlowResetLock() {
  state.hostFlowLock = HostFlow.OPEN;
}

const START_MEETING_KEYWORDS = [
  '开始会议', '开始吧', '开始讨论', '确认开始', '可以开始',
  '进入会议', '就这几位开始', '就这样开始', '按这份开始', '开始',
  '满意', '就这些人', '没问题', '可以了'
];

const ADJUST_GUEST_KEYWORDS = [
  '不满意', '重新推荐', '再推荐', '换一批', '换一组', '全部换',
  '换', '替换', '换成', '改成',
  '加', '加上', '增加', '添加', '邀请', '也要', '还要', '再加', '请来', '叫上',
  '删', '删除', '去掉', '移除', '减少', '不要', '去除', '排除',
  '偏重', '侧重', '更关注', '从.*角度'
];

function normalizeText(text) {
  return (text || '').replace(/\s+/g, '').toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

function findCelebrityKeyByDisplayName(rawName) {
  const cleanName = (rawName || '').replace(/[（(].+?[）)]$/g, '').trim();
  if (!cleanName || cleanName.length < 1) return null;

  // 1. 精确匹配 displayName
  for (const k in CELEBRITIES) {
    if (CELEBRITIES[k].displayName === cleanName) return k;
  }

  // 2. 名人别名/常见缩写（优先于模糊匹配，避免误匹配）
  const ALIASES = {
    '伯林': 'isaiah-berlin', '柏林': 'isaiah-berlin',
    '弗洛伊德': 'sigmund-freud', '佛洛依德': 'sigmund-freud',
    '弗兰克尔': 'viktor-frankl', '弗兰克': 'viktor-frankl',
    '贝多芬': 'ludwig-van-beethoven',
    '马丁·路德·金': 'martin-luther-king', '马丁路德金': 'martin-luther-king',
    '丘吉尔': 'winston-churchill',
    '杜威': 'john-dewey', '约翰·杜威': 'john-dewey',
    '马斯洛': 'abraham-maslow',
    '亚当斯密': 'adam-smith',
    '冯诺依曼': 'von-neumann',
  };
  if (ALIASES[cleanName] && CELEBRITIES[ALIASES[cleanName]]) return ALIASES[cleanName];

  // 3. 子串匹配：用户输入包含库中 displayName（如输入"以赛亚·伯林先生"包含"以赛亚·伯林"）
  for (const k in CELEBRITIES) {
    const dn = CELEBRITIES[k].displayName;
    if (cleanName.length > dn.length && cleanName.includes(dn)) return k;
  }

  // 4. 子串匹配：库中 displayName 包含用户输入（如"以赛亚·伯林"包含"伯林"），
  //    要求搜索词至少3字符，防止短词误匹配（如"洛克"误匹配"洛克菲勒"）
  if (cleanName.length >= 3) {
    for (const k in CELEBRITIES) {
      const dn = CELEBRITIES[k].displayName;
      if (dn.includes(cleanName) && dn !== cleanName) return k;
    }
  }

  // 5. key 匹配（如 "isaiah-berlin"）
  const lowerName = cleanName.toLowerCase().replace(/[\s·・]/g, '-');
  if (CELEBRITIES[lowerName]) return lowerName;

  return null;
}

/**
 * 半角 [xxx] 是否像「人名片段」再转成【】，避免 [1]、[a,b]、长英文句 误伤解析。
 * 能匹配库中人物或符合短中/英人名特征才通过。
 */
function isLikelyBracketedPersonName(inner) {
  let t = String(inner || '')
    .replace(/[（(].+?[）)]$/g, '')
    .replace(/[`*_#]/g, '')
    .trim();
  if (!t || t.length < 2 || t.length > 24) return false;
  if (/^\d{1,3}$/.test(t)) return false;
  if (/https?:/i.test(t) || /]\(/.test(t)) return false;
  if (/[。！？\n;；]/.test(t)) return false;
  if (/[，,、]/.test(t)) return false; // 列表、多对象排除
  if (findCelebrityKeyByDisplayName(t)) return true;
  if (/^[\u4e00-\u9fa5·•]{2,10}$/.test(t)) {
    if (/^(各位|我们|如果|因为|所以|可以|这个|问题|这里|但是|其实|现在|可能|需要|就是|一个|没有|什么|时候)$/.test(t)) return false;
    return true;
  }
  if (/^[A-Za-z][A-Za-z\s·.'-]*[A-Za-z·]$|^[A-Za-z]{2,15}$/.test(t) && t.length <= 32) return true;
  return false;
}

/** 会前推荐：将「」、［］、以及「可判定为人名」的半角 [ ] 归一成【】，提高解析命中率并控制误报 */
function normalizeRecommendationTextForExtract(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/「([^」]{1,20})」/g, '【$1】');
  s = s.replace(/［/g, '【').replace(/］/g, '】');
  s = s.replace(/\[([^\]\n]+?)\](?![\(:])/g, (match, inner) => {
    const t = String(inner || '').trim();
    if (isLikelyBracketedPersonName(t)) {
      return `【${t}】`;
    }
    return match;
  });
  return s;
}

function isGenericPlaceholderName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return true;

  // 常见泛称/占位称呼：李教授、王女士、张律师、某专家 等
  if (/^(某|一位|某位)/.test(name)) return true;
  if (/^(专家|学者|教授|老师|先生|女士|律师|博士|主任|总监|老板|同学)/.test(name)) return true;
  if (/(教授|老师|先生|女士|律师|博士|主任|总监|老板|同学|专家|学者)$/.test(name)) return true;
  if (/^[\u4e00-\u9fa5]{1,3}(教授|老师|先生|女士|律师|博士|主任)$/.test(name)) return true;
  if (/^(李|王|张|刘|陈|杨|黄|赵|周|吴|徐|孙|胡|朱|高|林|何|郭|马)[\u4e00-\u9fa5]?(教授|老师|女士|先生|律师)$/.test(name)) return true;

  return false;
}

function extractRecommendationKeys(content) {
  const source = normalizeRecommendationTextForExtract(content);
  const keys = [];
  const seen = new Set();
  const rejected = [];

  // 第一轮：从【名字】标记提取
  const regex = /【([^】]{1,20})】/g;
  let m;
  while ((m = regex.exec(source)) !== null) {
    const name = m[1].trim();
    if (!name || name === '风玲') continue;
    let key = findCelebrityKeyByDisplayName(name);
    if (!key && state.allowExternalCelebrities) {
      if (isGenericPlaceholderName(name)) {
        rejected.push(name);
      } else {
        key = ensureCelebrityEntry(name);
      }
    }
    if (!key || seen.has(key) || state.removedCelebrities.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  // 第二轮回退：如果【】提取不足2个，扫描文本中的已知名人库 displayName
  if (keys.length < 2) {
    const sortedCelebs = Object.keys(CELEBRITIES)
      .map(k => ({ key: k, name: CELEBRITIES[k].displayName }))
      .filter(c => c.name && c.name !== '风玲')
      .sort((a, b) => b.name.length - a.name.length);
    for (const { key, name } of sortedCelebs) {
      if (seen.has(key) || state.removedCelebrities.has(key)) continue;
      if (source.includes(name)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  // 第三回退：**加粗** 片段（仅库内命中 或 库外+像真人名，避免小标题/强调句误当嘉宾）
  if (keys.length < 2) {
    const bold = /\*\*([^*]+?)\*\*/g;
    let bm;
    while ((bm = bold.exec(source)) !== null) {
      const name = String(bm[1] || '')
        .replace(/[（(].+?[）)]$/g, '')
        .replace(/[`*#]/g, '')
        .trim();
      if (!name || name.length < 2 || name.length > 22) continue;
      if (/^(第|以下|第一|第二|注意|说明|建议|推荐人|推荐如下)/.test(name)) continue;
      if (/[，,。！？\n;；]/.test(name)) continue;
      let key = findCelebrityKeyByDisplayName(name);
      if (!key) {
        if (!isLikelyBracketedPersonName(name)) continue;
        if (state.allowExternalCelebrities) {
          if (isGenericPlaceholderName(name)) {
            rejected.push(name);
            continue;
          }
          key = ensureCelebrityEntry(name);
        } else {
          continue;
        }
      }
      if (!key || seen.has(key) || state.removedCelebrities.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }

  state.lastRejectedExternalNames = rejected;
  return keys;
}

/**
 * 会前用户意图检测——精确识别用户在推荐阶段的各类操作意图
 * @returns {{ type: string, names?: string[], oldName?: string, newName?: string, systemMsg?: string }}
 */
function detectPreMeetingIntent(userText) {
  const raw = String(userText || '').trim();
  const text = normalizeText(raw);
  if (!text) return { type: 'conversation' };

  // 1. 重新推荐（优先级最高，避免被"换"匹配到替换）
  if (/(重新推荐|换一批|换一组|全部换|重新来|再推荐一批|再推荐一组|换一波|全换了|都换掉|不满意.*推荐|重新选)/.test(text)) {
    return {
      type: 're-recommend',
      systemMsg: '[系统通知] 用户对当前推荐不满意，要求重新推荐。请根据原始话题重新匹配一组完全不同的嘉宾。不要复用上一次推荐的名单。'
    };
  }

  // 2. 替换嘉宾（把X换成Y / 用Y替代X / 把X换掉换成Y）
  const replacePatterns = [
    /把(.{1,10}?)换成(.{1,10})/,
    /用(.{1,10}?)替[代换](.{1,10})/,
    /(.{1,10}?)换成(.{1,10})/,
    /(.{1,10}?)不[要太]合?适?.{0,6}换成(.{1,10})/,
    /把(.{1,10}?)替换[成为](.{1,10})/,
  ];
  for (const p of replacePatterns) {
    const m = raw.match(p);
    if (m) {
      const oldName = m[1].replace(/[【】]/g, '').trim();
      const newName = m[2].replace(/[【】，,。.！!？?、]/g, '').trim();
      if (oldName && newName && oldName !== newName) {
        const oldKey = findCelebrityKeyByDisplayName(oldName);
        if (oldKey && state.selectedCelebrities.includes(oldKey)) {
          state.selectedCelebrities = state.selectedCelebrities.filter(k => k !== oldKey);
          state.removedCelebrities.add(oldKey);
          updateGuestBar();
        }
        const newKey = findCelebrityKeyByDisplayName(newName);
        if (newKey && !state.selectedCelebrities.includes(newKey)) {
          state.removedCelebrities.delete(newKey);
          state.selectedCelebrities.push(newKey);
          updateGuestBar();
        }
        return {
          type: 'replace',
          oldName, newName,
          systemMsg: `[系统通知] 用户要求把「${oldName}」替换为「${newName}」。请在推荐名单中做此替换，输出更新后的完整嘉宾名单（含头衔和推荐理由），并询问用户是否满意。`
        };
      }
    }
  }

  // 3. 删除嘉宾
  const removePatterns = [
    /(?:去掉|删除|移除|去除|排除|不要|不需要|换掉)\s*(.{1,10})/,
    /把(.{1,10}?)(?:去掉|删掉|移除|去除|排除)/,
    /(.{1,10}?)不太?合?适/,
  ];
  for (const p of removePatterns) {
    const m = raw.match(p);
    if (m) {
      const name = m[1].replace(/[【】，,。.！!？?、]/g, '').trim();
      if (name && name.length <= 10) {
        const key = findCelebrityKeyByDisplayName(name);
        if (key && state.selectedCelebrities.includes(key)) {
          state.selectedCelebrities = state.selectedCelebrities.filter(k => k !== key);
          state.removedCelebrities.add(key);
          updateGuestBar();
          const remaining = state.selectedCelebrities.map(k => CELEBRITIES[k]?.displayName).filter(Boolean);
          headerSubtitle.textContent = remaining.length > 0
            ? `主持人推荐 ${remaining.length} 位嘉宾，确认后开始会议`
            : '等待推荐嘉宾';
          return {
            type: 'remove',
            names: [name],
            systemMsg: `[系统通知] 用户要求移除「${name}」。当前剩余嘉宾：${remaining.join('、') || '无'}。请输出更新后的完整嘉宾名单并询问用户是否满意。如果嘉宾不足2位，可建议补充新嘉宾。`
          };
        }
      }
    }
  }

  // 4. 添加嘉宾
  const addPatterns = [
    /(?:加上|添加|增加|邀请|也要|还要|再加|加入|请来|叫上|也请|还想邀请|能不能加个?)\s*(.{1,10})/,
    /(?:把|让)\s*(.{1,10}?)\s*(?:也加进来|也加上|也请来|加进来)/,
    /我想(?:邀请|请)\s*(.{1,10})/,
  ];
  for (const p of addPatterns) {
    const m = raw.match(p);
    if (m) {
      const name = m[1].replace(/[【】，,。.！!？?、也吧呢啊了的]/g, '').trim();
      if (name && name.length >= 2 && name.length <= 10 && !isGenericPlaceholderName(name)) {
        const key = findCelebrityKeyByDisplayName(name);
        if (key) {
          state.removedCelebrities.delete(key);
          if (!state.selectedCelebrities.includes(key)) {
            state.selectedCelebrities.push(key);
            updateGuestBar();
          }
          return {
            type: 'add',
            names: [name],
            systemMsg: `[系统通知] 用户要求添加「${name}」到推荐名单（名人库内已有此名人）。请将其加入名单，输出更新后的完整嘉宾名单（含头衔和推荐理由），并询问用户是否满意。`
          };
        } else {
          state.allowExternalCelebrities = true;
          return {
            type: 'add-external',
            names: [name],
            systemMsg: `[系统通知] 用户要求添加「${name}」（名人库内没有此人）。用户直接指定了名人库外的名人，这是允许的。请将其加入推荐名单（使用真实名人信息），输出更新后的完整嘉宾名单，并询问用户是否满意。`
          };
        }
      }
    }
  }

  // 5. 方向调整
  if (/(偏重|侧重|更关注|更想从|从.*角度|多找些|多推荐.*领域|换个角度|换个方向)/.test(text)) {
    return {
      type: 'adjust-direction',
      systemMsg: '[系统通知] 用户希望调整讨论方向。请根据用户指定的新方向重新匹配并推荐嘉宾，输出完整名单。'
    };
  }

  // 6. 同意/拒绝库外推荐（保留兼容）
  if (state.pendingExternalApproval) {
    if (isExternalAllowReply(raw)) return { type: 'approve-external' };
    if (isExternalRejectReply(raw)) return { type: 'reject-external' };
  }

  // 7. 确认开始（放在调整检测之后）
  const wantsStart = includesAny(text, START_MEETING_KEYWORDS);
  const hasAdjustHint = /(不满意|调整|重新|换|加|删|去掉|移除|不要|替换|偏重|侧重)/.test(text);
  const hasNegative = /(先不|暂不|不开始|等等|稍后|先聊聊|再看看|再想想)/.test(text);
  if (wantsStart && !hasAdjustHint && !hasNegative && state.selectedCelebrities.length > 0) {
    return { type: 'start' };
  }

  return { type: 'conversation' };
}

function shouldStartHostedMeeting(userText) {
  if (state.selectionMode !== 'auto' || state.meetingStarted || state.selectedCelebrities.length === 0) {
    return false;
  }
  if (state.pendingExternalApproval) return false;
  const intent = detectPreMeetingIntent(userText);
  return intent.type === 'start';
}

function markHostedMeetingStarted() {
  state.meetingStarted = true;
  state.meetingEnded = false;
  state.pendingExternalApproval = false;
  state.hostedRound = 0;
  state.awaitingEndConfirmation = false;
  state.summaryReady = false;
  state.autoContinueRetries = 0;
  state.s3BridgeFromGuestInFlight = false;
  hostFlowResetLock();
  // 主持人模式：用户确认开始后才展示参会名人清单
  updateGuestBar();
  headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾已确认，会议进行中`;
  state.messages.push({
    role: 'system',
    content: '[系统通知] 用户已确认当前嘉宾名单，主持人模式会议正式开始。请从三阶段中的【阶段一·首轮分析】开始。'
  });
}

/** 从 LLM 消息正文中解 JSON 对象，兼容 ```json 围栏 */
function parseJsonFromLlmMessage(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let j = s;
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) j = f[1].trim();
  try {
    return JSON.parse(j);
  } catch {
    return null;
  }
}

/** 流程图第三段：D=结束 A=点名 B=有问无点名 C=只续谈 U=不明 */
function parseFlowchartBranchFromLlm(raw) {
  const o = parseJsonFromLlmMessage(raw);
  if (!o) return 'U';
  const b = String(o.branch || o.Branch || '').toUpperCase();
  if (b === 'D' || b === 'END' || b === 'SUMMARY') return 'D';
  if (b === 'A') return 'A';
  if (b === 'B') return 'B';
  if (b === 'C') return 'C';
  return 'U';
}

/**
 * 第三段每条用户输入：大模型判 A/B/C/D/U（不依赖关键词表；无密钥时 U）
 * @returns {'D'|'A'|'B'|'C'|'U'}
 */
async function classifyFlowchartStage3UserIntent(userText) {
  const t = String(userText || '').trim();
  if (!t) return 'U';
  if (!CONFIG.apiKey) {
    console.warn('[流程图] 未配置 API 密钥，第三段用户分支为 U，由主模型自判');
    return 'U';
  }
  const namesLine = state.selectedCelebrities
    .filter(k => !state.removedCelebrities.has(k))
    .map(k => CELEBRITIES[k]?.displayName)
    .filter(Boolean)
    .join('、') || '无';
  const pre = state.awaitingEndConfirmation
    ? '【语境】风玲**刚刚**在问：能否**结束**本场/是否**作会议总结。请优先区分：用户是**明确同意**结束+总结(选D)；还是要**再讨论**(选A或B或C，勿选D)。\n\n'
    : '';
  const system =
    pre +
    '你是圆桌**第三阶段**用户意图判型员。在场可点名嘉宾为：' +
    namesLine +
    '。\n\n' +
    '**只输出**一行纯JSON，无markdown：{"branch":"D"或"A"或"B"或"C"或"U"}\n' +
    'D=用户同意结束/作会议总结/可以收尾。A=用户点名上列某几位嘉宾回答。B=有具体问题/观点但没说谁答。C=主要想再聊/继续/先别收束/让嘉宾再聊，无独立新问。U=不能归入上四项。' +
    ' 理解口语、不抠个别词。';

  const response = await fetch(CONFIG.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + CONFIG.apiKey,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: '用户原话：\n' + t },
      ],
      temperature: 0.12,
      max_tokens: 100,
      stream: false,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('flowchart user intent ' + response.status + ' ' + errText.slice(0, 200));
  }
  const data = await response.json();
  return parseFlowchartBranchFromLlm(data.choices?.[0]?.message?.content);
}

/** 风玲输出是否在**征求**用户**是否**可**结束/作总结**（仅语义；有密钥时走 LLM） */
async function classifyHostAskingUserToEnd(hostFullText) {
  const text = String(hostFullText || '');
  if (!text.trim() || !CONFIG.apiKey) return null;
  const system =
    'You classify whether a Chinese host "风玲" is asking the **only user in the room** to decide: whether this **session/theme can end now**, or **whether a wrap-up "会议总结" can start now**, or a **二选一: continue free discussion vs go to final summary**.\n' +
    'Return only JSON: {"asking_end":true} or {"asking_end":false}.\n' +
    'true: clear endgame question to the user (can we end / shall I summarize / 继续聊还是我们总结).\n' +
    'false: only guiding guests, asking user for opinion on content, general transition, or inviting user to comment without the end/summary choice.';

  const response = await fetch(CONFIG.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + CONFIG.apiKey,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: '主持人发言全文：\n' + text },
      ],
      temperature: 0.1,
      max_tokens: 64,
      stream: false,
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const o = parseJsonFromLlmMessage(data.choices?.[0]?.message?.content);
  if (o && typeof o.asking_end === 'boolean') return o.asking_end;
  if (o && typeof o.askingEnd === 'boolean') return o.askingEnd;
  return null;
}

/** 仅第三段主流程：若风玲在征求收束/总结，则置 awaiting + 等用户。 */
async function tryMarkHostAskedUserForEnd(assistantText) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted || state.meetingEnded) return;
  if ((state.hostedRound || 0) < 2) return;
  const text = String(assistantText || '');
  if (!text.trim()) return;
  let asked = false;
  if (CONFIG.apiKey) {
    const sem = await classifyHostAskingUserToEnd(text);
    if (sem === true) asked = true;
    else if (sem === false) asked = false;
    else asked = detectHostEndConfirmationPrompt(text);
  } else {
    asked = detectHostEndConfirmationPrompt(text);
  }
  if (asked) {
    state.awaitingEndConfirmation = true;
    state.summaryReady = false;
    hostFlowRequireUserTurn();
  }
}

function detectHostEndConfirmationPrompt(content) {
  const text = String(content || '');
  return /是否可以结束|要不要结束|是否结束|可以结束会议吗|要我做总结|继续深入讨论，还是我来做个总结/.test(text);
}

function isExternalAllowReply(text) {
  const t = normalizeText(text);
  if (!t) return false;
  const allowWords = /(可以|允许|同意|行|好|没问题|都可以|可)/.test(t);
  const externalWords = /(库外|名人库外|外部|额外|另外找|另外推荐)/.test(t);
  const specifyWords = /(我指定|我想邀请|请邀请|按我指定|由我指定)/.test(t);
  return (allowWords && externalWords) || specifyWords;
}

function isExternalRejectReply(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /(不要|不允许|不需要|先不用|仅库内|只库内|只在库内|库内就好)/.test(t);
}

function detectMeetingSummary(content) {
  return /(总结|报告)/.test(content) && /核心观点/.test(content) && /(共识|分歧)/.test(content);
}

function isHostDirectiveText(text) {
  const t = (text || '').trim();
  if (!t) return false;
  const hasCallVerb = /请.{0,24}(谈谈|发言|回应|补充|分享|先说|先回应|继续)|你怎么看|谁先说/.test(t);
  const hasGuestMention = /【[^】]+】/.test(t);
  const startsLikeContinuation = /^[，,、]/.test(t);
  return (hasCallVerb && hasGuestMention) || (startsLikeContinuation && hasCallVerb);
}

function extractMentionedSelectedCelebrities(text) {
  const raw = String(text || '');
  const mentions = [];
  const seen = new Set();

  const withPos = state.selectedCelebrities
    .map(key => ({ key, name: CELEBRITIES[key]?.displayName || '', idx: raw.indexOf(CELEBRITIES[key]?.displayName || '') }))
    .filter(x => x.name && x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  for (const item of withPos) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    mentions.push(item.key);
  }

  // 补充匹配【名字】形式
  const bracketNames = [...raw.matchAll(/【([^】]+)】/g)].map(m => (m[1] || '').trim());
  for (const name of bracketNames) {
    const key = findCelebrityKeyByDisplayName(name);
    if (!key || seen.has(key) || !state.selectedCelebrities.includes(key)) continue;
    seen.add(key);
    mentions.push(key);
  }

  return mentions;
}

function buildManualTargetDirective(userText) {
  if (state.selectionMode !== 'manual' || state.selectedCelebrities.length < 2) return null;

  const text = String(userText || '');
  const mentioned = extractMentionedSelectedCelebrities(text);
  if (mentioned.length === 0) return null;

  const firstKey = mentioned[0];
  const firstName = CELEBRITIES[firstKey]?.displayName || '';
  const secondKey = mentioned[1];
  const secondName = secondKey ? (CELEBRITIES[secondKey]?.displayName || '') : '';

  const hardSingle = /只(让|要)?[^，。！？\n]{0,10}(说|回答|发言)|其他人(先)?不要(说|发言)|仅由/.test(text);
  const asksComment = /(评价|点评|回应|反驳|补充|怎么看|解读|评论|谈谈).{0,10}(他|她|其|上述|前面)/.test(text)
    || /让.{0,12}(对|就).{0,24}(评价|回应|发表见解)/.test(text);

  if (hardSingle) {
    return `[系统通知] 无主持人模式定向发言：本轮优先由【${firstName}】回答，其他嘉宾不发言。`;
  }

  if (asksComment && firstName && secondName) {
    return `[系统通知] 无主持人模式定向发言：本轮由【${firstName}】重点回应【${secondName}】刚才的观点；其他嘉宾可偶发补充，但总占比不要超过30%。`;
  }

  if (firstName) {
    return `[系统通知] 无主持人模式定向发言：用户本轮主要在问【${firstName}】；请以【${firstName}】为主回答，其他嘉宾仅偶发补充（占比不超过30%）。`;
  }

  return null;
}

function hostRequestedGuestFollowUp(text) {
  const t = String(text || '');
  return /请.{0,24}(谈谈|发言|回应|补充|分享|继续|先说)|你怎么看|谁先说|先回应/.test(t) && /【[^】]+】/.test(t);
}

function shouldRequireGuestReplyFromHostByRegex(text) {
  const t = String(text || '');
  if (!t) return false;

  // 主持人把话题抛给用户时，不强制续发嘉宾
  if (/您怎么看|你怎么看|你更倾向|你的看法|请你分享|你来决定|是否继续/.test(t)) {
    return false;
  }

  // 明确点名结构：有“请/想请”+发言动词
  const hasAskVerb = /请.{0,30}(谈谈|发言|回应|补充|分享|继续|先说|深入|展开)|想请.{0,30}(谈谈|回应|补充|分享|深入|展开)|就此.{0,16}(谈谈|回应|深入|展开)|进一步.{0,16}(谈谈|回应|深入|展开)|请各位|请大家/.test(t);
  if (!hasAskVerb) return false;

  // 命中任意一种“嘉宾目标”信号即认为需要嘉宾紧接发言
  const hasBracketMention = /【[^】]+】/.test(t);
  const hasGroupHint = /两位|二位|各位嘉宾|几位嘉宾|各位|大家/.test(t);
  const hasSelectedNameMention = state.selectedCelebrities.some(key => {
    const n = CELEBRITIES[key]?.displayName;
    return !!n && t.includes(n);
  });
  const endsLikeHandoff = /[？?]$/.test(t.trim()) || /请各位|请大家|请继续|请回应|请展开/.test(t);
  return hasBracketMention || hasGroupHint || hasSelectedNameMention || endsLikeHandoff;
}

function truncateForPromptHostIntent(text, maxLen = 500) {
  const t = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '…';
}

/** 本条中全部【风玲】正文，供续写嘉宾时对齐「主持意图」 */
function collectFenglingIntentFromParsed(parsed) {
  if (!Array.isArray(parsed) || !parsed.length) return '';
  const chunks = [];
  for (const seg of parsed) {
    if (seg && seg.key === 'fengling' && String(seg.text || '').trim()) {
      chunks.push(String(seg.text).trim());
    }
  }
  return truncateForPromptHostIntent(chunks.join('\n'), 520);
}

// 兼容旧调用点：仅用于总结阶段识别（总结与用户邀请原本合并在一起）
function isHostSummaryText(text) {
  const t = String(text || '');
  if (!t) return false;
  return /会议总结如下|总结报告如下|核心观点如下|以下是.*总结/.test(t);
}

function beautifyHostContent(content) {
  if (!content) return content;
  let text = content;

  // 去掉模型把系统提示复述到用户界面的内容
  text = text.replace(/（系统提示[^）]*）/g, '');
  text = text.replace(/（系统通知[^）]*）/g, '');

  // 去掉僵硬的括号指令短语
  text = text.replace(/（\s*增[、,，]\s*删[、,，]\s*替换\s*）/g, '');
  text = text.replace(/（\s*增加[、,，]\s*删除[、,，]\s*替换\s*）/g, '');

  // 屏蔽对用户可见的内部轮次表述
  text = text.replace(/第\s*[0-9一二三四五六七八九十]+\s*轮/g, '接下来的讨论');
  text = text.replace(/最后一轮/g, '最后这段讨论');
  text = text.replace(/进入\s*接下来的讨论/g, '进入下一步讨论');

  // 清理多余空白
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  return text;
}

function getLastUserQuestion() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role === 'user' && msg.content && !msg.content.startsWith('[系统通知]')) {
      return msg.content.trim();
    }
  }
  return '';
}

function getRecommendationReason(rawContent, key) {
  const info = CELEBRITIES[key];
  if (!info) return '和这个议题高度相关。';

  const name = info.displayName || '';
  const raw = String(rawContent || '');
  if (name && raw) {
    // 只抓“名字后明确分隔符（：，,）”的理由，避免模糊截断导致病句
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [new RegExp(`【?${escapedName}】?\\s*[：:，,]\\s*([^。！？\\n]{6,80})`)];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m && m[1]) {
        let picked = m[1].replace(/^[-—:：，,。\s]+/, '').trim();
        // 过滤明显残句开头，如“的代表”“，他……”等
        if (/^(的|，|,|。|他|她|它)/.test(picked)) continue;
        // 简单清洗“X学巨匠”这类不通顺搭配
        picked = picked.replace(/^学巨匠/, '思想家');
        if (picked.length >= 6) return picked.replace(/[。！？]+$/, '') + '。';
      }
    }
  }

  // 兜底理由：用结构化资料确保稳定可读
  const domain = info.domain ? `${info.domain}` : '相关领域';
  return `擅长从${domain}角度切入，能给出可操作观点。`;
}

function getRecommendationTitle(rawContent, key) {
  const info = CELEBRITIES[key];
  if (!info) return '';

  const isGenericTitle = t => !t || /^(圆桌嘉宾|特邀|嘉宾)$/.test(String(t).trim());

  // 1) 优先用库内 title（且不是泛化头衔）
  if (!isGenericTitle(info.title)) return String(info.title).trim();

  // 2) 尝试从模型原文提取“【名字】（头衔）”
  const name = info.displayName || '';
  const raw = String(rawContent || '');
  if (name && raw) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = raw.match(new RegExp(`【?${escapedName}】?\\s*[（(]([^）)]{2,24})[）)]`));
    if (m && m[1] && !isGenericTitle(m[1])) return m[1].trim();
  }

  return '';
}

/** 会前用户话是否像闲聊/测问，而非讨论主题或组局 */
function isPreMeetingChitChat(topic) {
  const t = String(topic || '').trim();
  if (!t) return false;
  // 命题式、议题式提问 → 非闲聊，应进入「直出嘉宾推荐」提示
  if (
    /(什么是|為什麼|为什么|为何|怎么|如何|怎看|怎樣|谈谈|谈一谈|论一论|分析|看待|理解|探讨|辨析|意义|本质|观点|评价|比较|利弊|是否|该不该|能不能(?!讲|说故事)|请讲|说说).{0,80}/.test(t)
    || /^(论|谈|析|评)/.test(t)
  ) {
    return false;
  }
  if (t.length > 100) return false;
  if (/(讨论|分析|圆桌|会议|嘉宾|推荐|名单|换一批|经济|公司|市场|战略|管理|投资|创业|政策|行业|如何|怎么|是否|该不该|能不能帮|话题)/.test(t)) {
    return false;
  }
  if (/(讲(个)?故事|讲(个)?笑话|讲一段|会讲|会说|会唱|会画|聊天|唠嗑|测你|考你|逗我|哄我)/.test(t)) return true;
  if (t.length < 40 && /(吗|么|呢|吧|呀)[？?！!。.…\s]*$/.test(t)) {
    if (/(你|我|能|会|在吗|好|谁|什)/.test(t) && t.length < 30) return true;
  }
  if (/^(你好|嗨|哈喽|在吗|早|晚好|谢)/.test(t) && t.length < 20) return true;
  if (/^(随便|聊聊|陪我|好无聊|唠)/.test(t) && t.length < 24) return true;
  return false;
}

function buildHostOpeningForTopic(topic) {
  const t = String(topic || '').trim();
  if (isPreMeetingChitChat(t)) {
    if (/讲(个)?故事|故事/.test(t)) {
      return '能啊。你要听**偏轻**一点的，还是带一点**观点/隐喻**的小段？给我一个字或一个主题词，我就像朋友聊天那样讲。';
    }
    if (/讲(个)?笑话|笑话|逗我/.test(t)) {
      return '行，我用口语说个短的。你要是接下来想**正经开一场讨论**，再丢我一个题目，我帮你从名人里组局。';
    }
    if (/在吗|你好|嗨|早|晚好/.test(t)) {
      return '在呢。我这边是圆桌主持风玲，你既可以跟我随便聊两句，也可以直接说想讨论的话题，我来帮你选嘉宾。';
    }
    return '我接着聊就好，语气会像面对面说话一样。\n你要是接下来有想深聊的**题目**，告诉我就行，我再按题目从名人里给你组桌。';
  }
  if (!t) {
    return '这是个值得慢慢展开的问题。\n我们不急着给结论，先把不同立场摆到同一张桌面上，再看答案会落向哪里。';
  }

  if (/自由/.test(t)) {
    return `“${t}”像一面镜子，照见的不只是选择本身，也照见我们如何理解自我与世界。\n这题很适合开一场跨视角圆桌：先把分歧讲透，再把共识沉淀出来。`;
  }

  const openings = [
    `“${t}”不是一句话能说完的题，它背后往往站着不同的价值坐标。\n不妨让几种有分量的声音先并肩出现，再看答案会向哪里沉淀。`,
    `这个问题问得很准，“${t}”本身就值得多学科交叉拆解。\n我为你请来几位最贴题的名人，让观点在同一张桌上彼此照亮。`,
    `“${t}”看似直白，真正难的是把直觉、经验与方法论放到同一张图里。\n我们先把视角铺开，再把结论慢慢收拢到可落地的方向上。`
  ];
  return openings[Math.floor(Math.random() * openings.length)];
}

function buildPreMeetingClosing() {
  const closings = [
    '如果这份名单与你的关注点契合，我们就从这里启程；若你愿意，我也可以再细调到更贴近你的期待。',
    '你先看看这组嘉宾是否对味；若你有偏好的讨论方向，我很乐意据此再做一版更精确的安排。',
    '若这套阵容让你满意，我们就直接开场；若你希望某个视角更突出，我可以继续打磨这份名单。',
    '这是一版兼顾思想深度与现实关切的组合；如果你想强调其中某条线索，我可以为你温和地再调整。',
    '你可以先感受这份名单的气质；若你想让讨论更聚焦某个问题，我会在尊重每位嘉宾特点的前提下再优化。'
  ];
  return closings[Math.floor(Math.random() * closings.length)];
}

function buildPreMeetingHostMessage(rawContent) {
  const rawText = String(rawContent || '').trim();
  const recommended = extractRecommendationKeys(rawContent).slice(0, 10);
  if (recommended.length >= 2) {
    state.selectedCelebrities = recommended;
    state.pendingExternalApproval = false;
    updateGuestBar();
    headerSubtitle.textContent = `主持人推荐 ${recommended.length} 位嘉宾，确认后开始会议`;
  }

  const names = state.selectedCelebrities
    .map(k => CELEBRITIES[k]?.displayName)
    .filter(Boolean)
    .slice(0, 10);

  const topic = getLastUserQuestion();
  const topicLine = buildHostOpeningForTopic(topic);

  // 已解析到 ≥2 人：有收束/开场 CTA，或长文(≥40字)时保留模型自然输出，避免长模板强盖
  if (rawText) {
    const hasStartPrompt = /开始会议|是否开始|要不要开始|是否满意|增删|替换/.test(rawText);
    const cleaned = beautifyHostContent(rawText);
    const useNaturalWithGuests =
      names.length >= 2 && (rawText.trim().length >= 40 || hasStartPrompt);
    // 尚未解析到 ≥2 个【】时：若模型已生成成段有效正文，**直接**展示，避免用「3～5 人」模板盖住闲聊/短答
    const compact = cleaned.replace(/\s/g, '');
    const useNaturalSolo = names.length < 2 && compact.length >= 10;
    if (useNaturalWithGuests || useNaturalSolo) {
      return cleaned;
    }
  }

  if (names.length >= 2) {
    const detailLines = state.selectedCelebrities
      .slice(0, 10)
      .map((k, i) => {
        const n = CELEBRITIES[k]?.displayName || `嘉宾${i + 1}`;
        const title = getRecommendationTitle(rawContent, k);
        const reason = getRecommendationReason(rawContent, k);
        return `${i + 1}. 【${n}】${title ? `（${title}）` : ''}：${reason}`;
      })
      .join('\n');

    const closingLine = buildPreMeetingClosing();
    return `${topicLine}\n\n我先给你推荐 ${names.length} 位嘉宾：\n${detailLines}\n\n${closingLine}`;
  }

  if (state.allowExternalCelebrities && state.lastRejectedExternalNames.length > 0) {
    return `${topicLine}\n\n我这边先说明一下：库外人选只接受真实名人姓名，像“李教授 / 王女士 / 张律师”这类泛称我不会纳入。\n你可以直接给我具体人名（例如“某某某”），我再按真实人物为你重组名单。`;
  }

  // 不再自动进入「等待用户同意库外」流程；初始推荐仅在名人库内，库外由用户主动点名（见 detectPreMeetingIntent add-external）
  return `${topicLine}\n\n请从名人库中按与话题的匹配度**从高到低**选出 **3～5 位**（人数可随机），用【名字】输出完整名单。\n若你希望增加名人库以外的人，请**直接告诉我**对方**真实姓名**，我会按规则纳入。`;
}

function formatMessageTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatInlineText(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function autoParagraphizeContent(content) {
  let text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return text;

  // 清理模型常见分隔线残留，避免在消息中出现孤立的 --- / ***
  text = text
    .split('\n')
    .filter(line => !/^\s*([-*])\1{2,}\s*$/.test(line))
    .join('\n')
    .trim();
  if (!text) return '';

  // 已有结构化内容时，不做自动重排
  const hasStructuredBlocks = /\n\s*\n/.test(text)
    || /(^|\n)\s*(#{1,4}\s+|[-*•]\s+|\d+[\.\)]\s+)/.test(text);
  if (hasStructuredBlocks) return text;

  // 无明显结构时，按句号级标点每2句自动分段，提升移动端可读性
  const parts = text.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 4) return text;

  const grouped = [];
  let buffer = [];
  for (const p of parts) {
    buffer.push(p);
    if (buffer.length >= 2) {
      grouped.push(buffer.join(''));
      buffer = [];
    }
  }
  if (buffer.length > 0) grouped.push(buffer.join(''));

  return grouped.join('\n\n');
}

function formatMessageContent(content) {
  const normalized = autoParagraphizeContent(content);
  const lines = normalized.split('\n');
  const blocks = [];
  let listIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      blocks.push('<div class="rt-gap"></div>');
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const cls = level >= 3 ? 'rt-h3' : 'rt-h2';
      blocks.push(`<div class="${cls}">${formatInlineText(heading[2])}</div>`);
      listIndex = 0;
      continue;
    }

    const numbered = line.match(/^(\d+)[\.\)]\s+(.+)$/);
    if (numbered) {
      blocks.push(`<div class="rt-li"><span class="rt-num">${numbered[1]}.</span><span>${formatInlineText(numbered[2])}</span></div>`);
      listIndex = Number(numbered[1]);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      listIndex = listIndex ? listIndex + 1 : 0;
      blocks.push(`<div class="rt-li"><span class="rt-dot">•</span><span>${formatInlineText(bullet[1])}</span></div>`);
      continue;
    }

    blocks.push(`<div class="rt-p">${formatInlineText(line)}</div>`);
    listIndex = 0;
  }

  return blocks.join('');
}

// ========== DOM元素 ==========
const chatArea = document.getElementById('chatArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const shareModal = document.getElementById('shareModal');
const shareLink = document.getElementById('shareLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyTip = document.getElementById('copyTip');
const closeModal = document.getElementById('closeModal');
const selectCelebrityBtn = document.getElementById('selectCelebrityBtn');
const celebrityPanel = document.getElementById('celebrityPanel');
const panelOverlay = document.getElementById('panelOverlay');
const panelCloseBtn = document.getElementById('panelCloseBtn');
const panelConfirmBtn = document.getElementById('panelConfirmBtn');
const panelBody = document.getElementById('panelBody');
const searchInput = document.getElementById('searchInput');
const selectedCount = document.getElementById('selectedCount');
const guestBar = document.getElementById('guestBar');
const guestScroll = document.getElementById('guestScroll');
const headerSubtitle = document.getElementById('headerSubtitle');
// 更多菜单
const moreBtn = document.getElementById('moreBtn');
const moreMenu = document.getElementById('moreMenu');
const menuPauseBtn = document.getElementById('menuPauseBtn');
const menuPauseText = document.getElementById('menuPauseText');
const menuRestartBtn = document.getElementById('menuRestartBtn');
const menuHistoryBtn = document.getElementById('menuHistoryBtn');
const menuNewMeetingBtn = document.getElementById('menuNewMeetingBtn');
const menuShareBtn = document.getElementById('menuShareBtn');
// 暂停横幅
const pauseBanner = document.getElementById('pauseBanner');
const resumeLink = document.getElementById('resumeLink');
// 输入区域
const inputArea = document.querySelector('.input-area');
// 历史
const historyPanel = document.getElementById('historyPanel');
const historyCloseBtn = document.getElementById('historyCloseBtn');
const historyList = document.getElementById('historyList');
const historyDetail = document.getElementById('historyDetail');
const historyBackBtn = document.getElementById('historyBackBtn');
const historyDetailTitle = document.getElementById('historyDetailTitle');
const historyDetailTime = document.getElementById('historyDetailTime');
const historyDetailGuests = document.getElementById('historyDetailGuests');
const historyDetailBody = document.getElementById('historyDetailBody');
// 确认对话框
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMsg = document.getElementById('confirmMsg');
const confirmCancel = document.getElementById('confirmCancel');
const confirmOk = document.getElementById('confirmOk');
// 停止按钮
const stopBtn = document.getElementById('stopBtn');
// 语音按钮
const voiceToggleBtn = document.getElementById('voiceToggleBtn');

// ========== 初始化 ==========
function init() {
  // 确保 sessionStorage 中的 sessionId 与 state 同步
  sessionStorage.setItem('roundtable_session_id', state.sessionId);
  
  // 初始化语音模块
  if (typeof initVoice === 'function') {
    initVoice();
  }
  
  // 合并 slogan 和欢迎语为一条消息
  const randomSlogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
  const combinedMessage = randomSlogan + '\n\n' + WELCOME_MESSAGE;
  addSpeakerMessage('风玲', combinedMessage, 'fengling');
  state.hostIntroShown = true;
  
  buildCelebrityPanel();
  bindEvents();
  messageInput.focus();

  if (typeof logVisit === 'function') logVisit();
}

// ========== 事件绑定 ==========
function bindEvents() {
  sendBtn.addEventListener('click', handleSend);

  messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    sendBtn.disabled = !messageInput.value.trim() || state.isGenerating || state.isPaused;
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (messageInput.value.trim() && !state.isGenerating && !state.isPaused) handleSend();
    }
  });

  // 参会人员选择面板
  selectCelebrityBtn.addEventListener('click', openPanel);
  panelOverlay.addEventListener('click', closePanel);
  panelCloseBtn.addEventListener('click', closePanel);
  panelConfirmBtn.addEventListener('click', confirmSelection);
  searchInput.addEventListener('input', filterCelebrities);

  // 更多菜单
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('active');
  });
  document.addEventListener('click', () => moreMenu.classList.remove('active'));
  moreMenu.addEventListener('click', (e) => e.stopPropagation());

  // 菜单项
  menuPauseBtn.addEventListener('click', togglePause);
  menuRestartBtn.addEventListener('click', handleRestart);
  menuHistoryBtn.addEventListener('click', openHistoryPanel);
  menuNewMeetingBtn.addEventListener('click', handleNewMeeting);
  menuShareBtn.addEventListener('click', () => { moreMenu.classList.remove('active'); openShareModal(); });

  // 暂停横幅
  resumeLink.addEventListener('click', () => { if (state.isPaused) togglePause(); });

  // 分享
  closeModal.addEventListener('click', closeShareModal);
  copyLinkBtn.addEventListener('click', copyLink);
  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) closeShareModal();
  });

  // 历史
  historyCloseBtn.addEventListener('click', closeHistoryPanel);
  panelOverlay.addEventListener('click', closeHistoryPanel);
  historyBackBtn.addEventListener('click', closeHistoryDetail);

  // 确认框
  confirmCancel.addEventListener('click', closeConfirm);
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirm();
  });

  // 停止按钮
  stopBtn.addEventListener('click', handleInterrupt);
  
}

// ========== 自动调整输入框高度 ==========
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
}

// ========== 打断发言 ==========
function handleInterrupt() {
  // 停止AI生成
  if (state.isGenerating && state.abortController) {
    state.abortController.abort();
  }
  
  // 停止语音播放
  if (typeof stopSpeaking === 'function') {
    stopSpeaking();
  }
}

/** 会议已结束后，用户想「另开一场 / 新会议」——与菜单「新建会议」同语义，可自然语言表达 */
function isWantsNewMeetingAfterEnd(text) {
  const t = String(text || '').trim();
  return /(换一[组批波]|重新推荐|再推荐|换.*嘉宾|换.*名人|新.*话题|换个话题|重新开始|新的讨论|再开一场|开个新.*会|讨论.*新.*问题|聊.*别的|新会议|新的会议|另开|新开|重开|另起|再来一场|重新开会|新一场|新开会|想开.*新|开始.*新.*会|新建会议|再组.*局|开.*新会)/.test(t);
}

/**
 * 会后 → 新会议：归档、换 session、清空聊天上下文，只保留系统说明 + 本条用户话，再进入**会前名人推荐**。
 */
async function beginNewMeetingFromEndedSession(text) {
  saveCurrentToHistory();
  if (state.isGenerating && state.abortController) {
    state.abortController.abort();
  }
  if (typeof stopSpeaking === 'function') {
    stopSpeaking();
  }

  state.sessionId = Date.now().toString(36);
  try {
    sessionStorage.setItem('roundtable_session_id', state.sessionId);
  } catch (_) {}

  state.meetingStarted = false;
  state.meetingEnded = false;
  state.selectedCelebrities = [];
  state.pendingSelection = [];
  state.removedCelebrities.clear();
  state.allowExternalCelebrities = false;
  state.pendingExternalApproval = false;
  state.lastRejectedExternalNames = [];
  state.hostedRound = 0;
  state.awaitingEndConfirmation = false;
  state.summaryReady = false;
  state.autoContinueRetries = 0;
  state.autoContinueDepth = 0;
  state.consecutiveUserInvitePending = 0;
  state.s3BridgeFromGuestInFlight = false;
  hostFlowResetLock();
  state.recentHostUtterances = [];
  state.isGenerating = false;
  state.abortController = null;
  state.isPaused = false;
  state.hostIntroShown = false;

  state.messages = [
    {
      role: 'system',
      content:
        '[系统通知] 上一场会议已结束并**已归档到历史**。当前为**一场全新会议**的会前阶段：请**只根据本条用户消息**中的新话题或意图，从名人库推荐 3～5 位嘉宾，使用【名字】完整格式（含头衔、推荐理由）并问用户是否满意。**禁止**延续上一场名单、转述上场总结、或把旧结论带入推荐。',
    },
    { role: 'user', content: text },
  ];

  chatArea.innerHTML = '';
  clearStreamMessages();
  addSystemNotice('上一场已保存到历史，已开启新会议');
  addUserMessage(text);

  guestBar.style.display = 'none';
  guestScroll.innerHTML = '';
  updateGuestBar();
  headerSubtitle.textContent = '等待主持人推荐嘉宾';
  if (typeof buildCelebrityPanel === 'function') {
    buildCelebrityPanel();
  }

  await processUserTurnAfterCommit(text);
}

/** 用户消息已写入 `state.messages` 之后：会前意图、第三段流程图、联网补全、再生成 */
async function processUserTurnAfterCommit(text) {
  // 主持人模式会前：意图感知处理（添加/删除/替换/重新推荐/开始等）
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    const preMeetingIntent = detectPreMeetingIntent(text);

    if (preMeetingIntent.type === 'approve-external') {
      state.allowExternalCelebrities = true;
      state.pendingExternalApproval = false;
      state.messages.push({
        role: 'system',
        content: '[系统通知] 用户已同意可推荐名人库之外人员。请在已有基础上从库外补充真实名人至3位，输出完整名单。'
      });
      addSystemNotice('已收到，你允许推荐库外嘉宾');
    } else if (preMeetingIntent.type === 'reject-external') {
      state.allowExternalCelebrities = false;
      state.pendingExternalApproval = false;
      state.messages.push({
        role: 'system',
        content: '[系统通知] 用户仅接受名人库内人员。请仅从名人库中重新推荐，或引导用户指定希望邀请的库内嘉宾。'
      });
      addSystemNotice('好的，将仅在名人库内推荐');
    } else if (preMeetingIntent.type === 'start') {
      markHostedMeetingStarted();
      addSystemNotice('已确认嘉宾名单，会议正式开始');
    } else if (preMeetingIntent.type === 're-recommend') {
      state.selectedCelebrities = [];
      state.removedCelebrities.clear();
      updateGuestBar();
      headerSubtitle.textContent = '等待重新推荐嘉宾';
      if (preMeetingIntent.systemMsg) {
        state.messages.push({ role: 'system', content: preMeetingIntent.systemMsg });
      }
    } else if (preMeetingIntent.type === 'add-external') {
      state.pendingExternalApproval = false;
      if (preMeetingIntent.systemMsg) {
        state.messages.push({ role: 'system', content: preMeetingIntent.systemMsg });
      }
      if (preMeetingIntent.names && preMeetingIntent.names[0]) {
        addSystemNotice(`正在添加 ${preMeetingIntent.names[0]} 到推荐名单`);
      }
    } else if (preMeetingIntent.systemMsg) {
      state.messages.push({ role: 'system', content: preMeetingIntent.systemMsg });
      if (preMeetingIntent.type === 'remove' && preMeetingIntent.names) {
        addSystemNotice(`${preMeetingIntent.names[0]} 已从推荐名单移除`);
      } else if (preMeetingIntent.type === 'add' && preMeetingIntent.names) {
        addSystemNotice(`${preMeetingIntent.names[0]} 已加入推荐名单`);
      }
    }
  }

  // 流程图：第三段（hostedRound>=2）每条用户话经大模型判 D/A/B/C/U 并硬注入（与流程图分支一致）
  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded && (state.hostedRound || 0) >= 2) {
    let br = 'U';
    try {
      br = await classifyFlowchartStage3UserIntent(text);
    } catch (e) {
      console.warn('[流程图] 第三段用户分支', e);
      br = 'U';
    }
    if (br === 'D') {
      state.awaitingEndConfirmation = false;
      state.summaryReady = true;
      state.messages.push({ role: 'system', content: FLOWCHART_MSG.D });
    } else {
      if (br !== 'U') {
        state.awaitingEndConfirmation = false;
        state.summaryReady = false;
      }
      if (br === 'A') state.messages.push({ role: 'system', content: FLOWCHART_MSG.A });
      else if (br === 'B') state.messages.push({ role: 'system', content: FLOWCHART_MSG.B });
      else if (br === 'C') state.messages.push({ role: 'system', content: FLOWCHART_MSG.C });
      else state.messages.push({ role: 'system', content: FLOWCHART_MSG.U });
    }
  }

  // 兜底：如果上面意图检测未触发开始会议，再尝试一次
  if (state.selectionMode === 'auto' && !state.meetingStarted && shouldStartHostedMeeting(text)) {
    markHostedMeetingStarted();
    addSystemNotice('已确认嘉宾名单，会议正式开始');
  }

  // 无主持人模式：识别用户点名对象，给模型明确发言约束
  const manualDirective = buildManualTargetDirective(text);
  if (manualDirective) {
    state.messages.push({ role: 'user', content: manualDirective });
  }

  // 获取当前选择的参会人员显示名称
  const currentCelebrities = state.selectedCelebrities
    .filter(key => !state.removedCelebrities.has(key))
    .map(key => CELEBRITIES[key]?.displayName)
    .filter(name => name);
  
  if (typeof logMessage === 'function') logMessage('user', 'user', text, currentCelebrities);

  // 检测是否需要搜索最新信息（通用 + 嘉宾时效补充）
  const contextPromises = [];
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ]);

  if (typeof generateTimeContext === 'function') {
    contextPromises.push(withTimeout(generateTimeContext(text), 900));
  }
  if (
    typeof generateCelebrityTimeContext === 'function'
    && state.selectedCelebrities.length > 0
    && (state.meetingStarted || state.selectionMode === 'manual')
    && typeof needsRecentInfo === 'function'
    && needsRecentInfo(text)
  ) {
    contextPromises.push(withTimeout(generateCelebrityTimeContext(state.selectedCelebrities, text), 1200));
  }
  if (contextPromises.length > 0) {
    const contextResults = await Promise.allSettled(contextPromises);
    for (const r of contextResults) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      state.messages.push({
        role: 'system',
        content: r.value
      });
      console.log('🔍 已补充最新信息到对话上下文');
    }
  }

  await generateResponse();
}

// ========== 发送消息 ==========
async function handleSend() {
  const text = messageInput.value.trim();
  if (!text || state.isGenerating || state.isPaused) return;

  messageInput.value = '';
  autoResizeTextarea();
  sendBtn.disabled = true;

  // 会后且用户要「新会议 / 另开一场」：先归档上一场、换 session、清空对话，再单独走会前推荐
  if (state.selectionMode === 'auto' && state.meetingEnded && isWantsNewMeetingAfterEnd(text)) {
    await beginNewMeetingFromEndedSession(text);
    return;
  }

  addUserMessage(text);
  state.messages.push({ role: 'user', content: text });
  state.autoContinueRetries = 0;
  state.autoContinueDepth = 0;
  state.consecutiveUserInvitePending = 0;
  state.s3BridgeFromGuestInFlight = false;
  hostFlowResetLock();
  state.recentHostUtterances = [];

  await processUserTurnAfterCommit(text);
}

// ========== 添加用户消息 ==========
function addUserMessage(content) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message user';
  msgDiv.innerHTML = `
    <div class="message-content">
      <div class="message-bubble">${formatMessageContent(content)}</div>
    </div>
  `;
  chatArea.appendChild(msgDiv);
  scrollToBottom(true); // 用户主动发送消息，强制滚到底部
}

// ========== 系统通知（嘉宾变动等） ==========
function addSystemNotice(text) {
  const div = document.createElement('div');
  div.className = 'system-notice';
  div.textContent = text;
  chatArea.appendChild(div);
  scrollToBottom();
}

// ========== 风玲头像常量 ==========
const FENGLING_AVATAR = '<img src="fengling-avatar.png" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';

// ========== 添加说话人消息（参会人员/风玲） ==========
function addSpeakerMessage(speakerName, content, celebrityKey) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';

  const info = getCelebrityInfo(speakerName, celebrityKey);
  const isFengling = (speakerName === '风玲' || celebrityKey === 'fengling');
  const avatarContent = isFengling ? FENGLING_AVATAR : speakerName.charAt(0);

  msgDiv.innerHTML = `
    <div class="message-avatar" style="background:${isFengling ? 'transparent' : info.color}">${avatarContent}</div>
    <div class="message-content">
      <div class="message-name" style="color:${info.color}">${speakerName}</div>
      <div class="message-bubble">${formatMessageContent(content)}</div>
      <div class="message-actions">
        <span class="message-time">${formatMessageTime()}</span>
        <button class="msg-action-btn msg-voice-btn" data-speaker="${speakerName}" data-content="${escapeHtml(content)}" title="朗读">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        </button>
        <button class="msg-action-btn msg-copy-btn" data-content="${escapeHtml(content)}" title="复制">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  chatArea.appendChild(msgDiv);
  scrollToBottom();
  
  // 立即显示按钮（因为这是完整消息）
  const actionsDiv = msgDiv.querySelector('.message-actions');
  if (actionsDiv) {
    actionsDiv.classList.add('show');
  }
  
  // 绑定语音按钮事件
  const voiceBtn = msgDiv.querySelector('.msg-voice-btn');
  voiceBtn.addEventListener('click', () => {
    const btn = voiceBtn;
    const isPlaying = btn.classList.contains('playing');
    
    if (isPlaying) {
      // 停止播放
      console.log('⏹️ 停止播放');
      if (typeof stopSpeaking === 'function') stopSpeaking();
    } else {
      // 开始自动连续播放（从当前消息开始）
      console.log('▶️ 开始自动连续播放:', speakerName);
      
      // 确保语音已启用
      if (typeof voiceState !== 'undefined') {
        voiceState.enabled = true;
      }
      
      // 调用autoPlayAll函数，从当前消息开始连续播放
      if (typeof autoPlayAll === 'function') {
        autoPlayAll(msgDiv);
      } else {
        console.error('❌ autoPlayAll 函数不存在');
      }
    }
  });
  
  // 绑定复制按钮事件
  const copyBtn = msgDiv.querySelector('.msg-copy-btn');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content);
      // 显示豆包风格的toast提示
      showToast('已复制');
    } catch (err) {
      console.error('复制失败:', err);
    }
  });
  
  return msgDiv;
}

// ========== 创建空的说话人消息（用于流式填充） ==========
// insertAfterEl：若提供，则插在该节点之后，避免仅 append 导致顺序错乱或整段重建闪屏
function createStreamMessage(speakerName, celebrityKey, insertAfterEl = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';

  const info = getCelebrityInfo(speakerName, celebrityKey);
  const isFengling = (speakerName === '风玲' || celebrityKey === 'fengling');
  const avatarContent = isFengling ? FENGLING_AVATAR : speakerName.charAt(0);

  msgDiv.innerHTML = `
    <div class="message-avatar" style="background:${isFengling ? 'transparent' : info.color}">${avatarContent}</div>
    <div class="message-content">
      <div class="message-name" style="color:${info.color}">${speakerName}</div>
      <div class="message-bubble"></div>
      <div class="message-actions">
        <span class="message-time">${formatMessageTime()}</span>
        <button class="msg-action-btn msg-voice-btn" data-speaker="${speakerName}" title="朗读">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        </button>
        <button class="msg-action-btn msg-copy-btn" title="复制">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  if (insertAfterEl && insertAfterEl.parentNode === chatArea) {
    if (insertAfterEl.nextSibling) {
      chatArea.insertBefore(msgDiv, insertAfterEl.nextSibling);
    } else {
      chatArea.appendChild(msgDiv);
    }
  } else {
    chatArea.appendChild(msgDiv);
  }
  scrollToBottom();
  
  // 绑定语音按钮事件（初始为禁用状态，等待内容填充后启用）
  const voiceBtn = msgDiv.querySelector('.msg-voice-btn');
  voiceBtn.addEventListener('click', () => {
    const btn = voiceBtn;
    const bubble = msgDiv.querySelector('.message-bubble');
    const content = bubble ? bubble.textContent.trim() : '';
    
    if (!content) {
      console.log('⚠️ 消息内容为空，无法播放');
      return;
    }
    
    const isPlaying = btn.classList.contains('playing');
    
    if (isPlaying) {
      console.log('⏹️ 停止播放');
      if (typeof stopSpeaking === 'function') stopSpeaking();
    } else {
      console.log('▶️ 开始自动连续播放:', speakerName);
      
      // 确保语音已启用
      if (typeof voiceState !== 'undefined') {
        voiceState.enabled = true;
      }
      
      // 调用autoPlayAll函数，从当前消息开始连续播放
      if (typeof autoPlayAll === 'function') {
        autoPlayAll(msgDiv);
      } else {
        console.error('❌ autoPlayAll 函数不存在');
      }
    }
  });
  
  // 绑定复制按钮事件
  const copyBtn = msgDiv.querySelector('.msg-copy-btn');
  copyBtn.addEventListener('click', async () => {
    const bubble = msgDiv.querySelector('.message-bubble');
    const content = bubble ? bubble.textContent.trim() : '';
    
    if (!content) {
      console.log('⚠️ 消息内容为空，无法复制');
      return;
    }
    
    try {
      await navigator.clipboard.writeText(content);
      showToast('已复制');
    } catch (err) {
      console.error('复制失败:', err);
    }
  });
  
  return msgDiv;
}

// ========== 获取参会人员信息（颜色等） ==========
function getCelebrityInfo(displayName, key) {
  // 风玲特殊处理
  if (displayName === '风玲' || key === 'fengling') {
    return { color: '#5B4A3F' };
  }
  // 通过 key 查找
  if (key && CELEBRITIES[key]) {
    return { color: CELEBRITIES[key].color };
  }
  // 通过 displayName 查找
  for (const k in CELEBRITIES) {
    if (CELEBRITIES[k].displayName === displayName) {
      return { color: CELEBRITIES[k].color };
    }
  }
  // 默认颜色
  return { color: '#8B7A6B' };
}

// ========== 添加打字指示器 ==========
function addTypingIndicator() {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';
  msgDiv.id = 'typingMsg';
  const isManualMode = state.selectionMode === 'manual';

  if (isManualMode) {
    msgDiv.innerHTML = `
      <div class="message-content" style="margin-left:40px;">
        <div class="message-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
  } else {
    msgDiv.innerHTML = `
      <div class="message-avatar" style="background:transparent">${FENGLING_AVATAR}</div>
      <div class="message-content">
        <div class="message-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
  }
  chatArea.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
}

// ========== 调用API生成回复 ==========
async function generateResponse() {
  state.isGenerating = true;
  state.abortController = new AbortController();
  const wasSummaryTurn = state.summaryReady === true;
  sendBtn.style.display = 'none';
  stopBtn.style.display = '';

  let typingMsg = null;

  try {
    // 新一次生成前清空流式 DOM，避免上一条的 streamMsgElements 在「自动续写」下一条里被
    // reconcile 误当成首段：会把首条从【风玲】morph 成下一位【嘉宾】，出现「风玲说一句话就消失」。
    clearStreamMessages();
    streamTypingMsg = null;

    typingMsg = addTypingIndicator();

    const lastUserQ = (typeof getLastUserQuestion === 'function' && getLastUserQuestion()) || '';
    const preMeetingDirectTopic =
      state.selectionMode === 'auto' &&
      !state.meetingStarted &&
      lastUserQ.trim().length > 0 &&
      !isPreMeetingChitChat(lastUserQ);

    const systemPrompt = buildSystemPrompt(state.selectedCelebrities, {
      selectionMode: state.selectionMode,
      meetingStarted: state.meetingStarted,
      meetingEnded: state.meetingEnded,
      allowExternalCelebrities: state.allowExternalCelebrities,
      pendingExternalApproval: state.pendingExternalApproval,
      hostedRound: state.hostedRound,
      awaitingEndConfirmation: state.awaitingEndConfirmation,
      summaryReady: state.summaryReady,
      preMeetingDirectTopic,
    });
    
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...getRecentMessages(),
    ];

    const response = await fetch(CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: apiMessages,
        temperature: CONFIG.temperature,
        stream: true,
      }),
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API错误 (${response.status}): ${errText}`);
    }

    // 移除打字指示器的时机改为：由 renderStreamContent 首次渲染时移除
    // typingMsg 保留引用，传给流式渲染逻辑
    streamTypingMsg = typingMsg;

    // 流式读取并解析多角色消息
    let fullContent = '';
    streamFullContent = ''; // 重置
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 流式消息渲染状态
    let currentSpeaker = null;
    let currentMsgEl = null;
    let currentBubble = null;
    let currentText = '';
    let segments = []; // { speaker, text }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            streamFullContent = fullContent; // 同步到全局，供打断时使用
            // 实时渲染多角色消息
            renderStreamContent(fullContent);
          }
        } catch (e) {
          // 跳过解析错误
        }
      }
    }

      // 最终完整渲染
      if (fullContent) {
        // 确保打字指示器已移除
        removeStreamTyping();

        // 与流式用同一套「展示用」清洗后再落盘，避免流式/终稿 parse 条数不一致 → tryReuse 失败 → 清空 DOM 后风玲不渲染
        const messageIndex = state.messages.filter(m => m.role === 'assistant').length;
        const rawForFinalize = String(fullContent || '');
        const displayText = beautifyHostContent(filterFenglingSelfIntro(rawForFinalize, messageIndex));

        if (!tryReuseStreamAsFinal(displayText) && !tryReuseStreamAsFinal(rawForFinalize)) {
          clearStreamMessages();
          renderFinalContent(displayText);
        }

        const contentForHistory = cleanAssistantContentForHistory(stripNonHostForSummary(displayText));
        // 若清洗后为空（整段都是复读/伪造用户回复），不写历史，避免污染下一轮上下文
        if (contentForHistory && contentForHistory.trim()) {
          state.messages.push({ role: 'assistant', content: contentForHistory });
        } else {
          console.log('[历史] 整段被识别为复读/伪造用户回复，跳过写入历史');
        }
        if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
          await tryMarkHostAskedUserForEnd(displayText);
        }
        const chainContinued = (await checkAndContinueGeneration(displayText)) === true;
        if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
          if (!chainContinued) {
            state.hostedRound = Math.min(3, state.hostedRound + 1);
          }
          if (wasSummaryTurn) {
            state.meetingEnded = true;
            state.awaitingEndConfirmation = false;
            state.summaryReady = false;
          }
        }
      // 上报
      // 获取当前选择的参会人员显示名称
      const currentCelebrities = state.selectedCelebrities
        .filter(key => !state.removedCelebrities.has(key))
        .map(key => CELEBRITIES[key]?.displayName)
        .filter(name => name);
      
      if (typeof logMessage === 'function') logMessage('assistant', 'assistant', displayText, currentCelebrities);

      // 检查AI推荐参会人员并自动添加
      checkAndApplyRecommendations(displayText);
    }

  } catch (error) {
    removeStreamTyping();
    if (error.name === 'AbortError') {
      // 用户打断：保留已渲染的流式内容作为最终内容
      if (streamFullContent) {
        const messageIndex = state.messages.filter(m => m.role === 'assistant').length;
        const displaySnap = beautifyHostContent(filterFenglingSelfIntro(streamFullContent, messageIndex));

        if (!tryReuseStreamAsFinal(displaySnap)) {
          clearStreamMessages();
          renderFinalContent(displaySnap);
        }

        const streamContentForHistory = cleanAssistantContentForHistory(stripNonHostForSummary(displaySnap));
        if (streamContentForHistory && streamContentForHistory.trim()) {
          state.messages.push({ role: 'assistant', content: streamContentForHistory });
        } else {
          console.log('[历史] 中断快照被识别为复读/伪造用户回复，跳过写入历史');
        }
        if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
          await tryMarkHostAskedUserForEnd(displaySnap);
        }
        const chainContinued = (await checkAndContinueGeneration(displaySnap)) === true;
        if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
          if (!chainContinued) {
            state.hostedRound = Math.min(3, state.hostedRound + 1);
          }
          if (wasSummaryTurn) {
            state.meetingEnded = true;
            state.awaitingEndConfirmation = false;
            state.summaryReady = false;
          }
        }
        checkAndApplyRecommendations(displaySnap);
      } else {
        // 有时打断发生在流式早期，streamFullContent 还没写入；此时从可见流式DOM回收文本，避免“内容消失”
        const snapshotContent = collectVisibleStreamAssistantContent();
        if (snapshotContent) {
          const lastMsg = streamMsgElements[streamMsgElements.length - 1];
          const actionsDiv = lastMsg?.querySelector('.message-actions');
          if (actionsDiv) actionsDiv.classList.add('show');
          state.messages.push({ role: 'assistant', content: snapshotContent });
          checkAndApplyRecommendations(snapshotContent);
        } else {
          if (typingMsg) typingMsg.remove();
          clearStreamMessages();
        }
      }
    } else {
      if (typingMsg) typingMsg.remove();
      clearStreamMessages();
      const errContent = `抱歉，我暂时无法回应。请检查网络连接后重试。\n(${error.message})`;
      if (state.selectionMode === 'manual') {
        addSystemNotice('当前暂时无法生成回复，请检查网络后重试');
      } else {
        addSpeakerMessage('风玲', errContent, 'fengling');
      }
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    stopBtn.style.display = 'none';
    sendBtn.style.display = '';
    sendBtn.disabled = !messageInput.value.trim();
    clearGuestSpeaking();
    streamFullContent = '';
  }
}

// ========== 流式渲染跟踪 ==========
let streamMsgElements = [];
let streamParsedMode = false;
let streamTypingMsg = null; // 打字指示器引用，首次渲染时移除
let streamFullContent = ''; // 流式累积的完整内容，打断时保留

function removeStreamTyping() {
  if (streamTypingMsg) {
    streamTypingMsg.remove();
    streamTypingMsg = null;
  }
}

function clearStreamMessages() {
  streamMsgElements.forEach(el => el.remove());
  streamMsgElements = [];
  streamParsedMode = false;
  removeStreamTyping();
}

function collectVisibleStreamAssistantContent() {
  if (!streamMsgElements || streamMsgElements.length === 0) return '';
  const blocks = [];

  for (const el of streamMsgElements) {
    const name = (el.querySelector('.message-name')?.textContent || '').trim();
    const text = (el.querySelector('.message-bubble')?.textContent || '').trim();
    if (!text) continue;
    if (name) {
      blocks.push(`【${name}】${text}`);
    } else {
      blocks.push(text);
    }
  }

  return blocks.join('\n\n').trim();
}

// 会中助手回复的解析与过滤（流式/最终需保持一致，避免断流后重绘闪烁）
function buildHostedParsedSegments(content, isOneOnOne) {
  const raw = parseMultiSpeaker(content, isOneOnOne)
    .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text));
  const firstFengIdx0 = raw.findIndex(s => s && s.key === 'fengling');
  const afterEcho = raw.filter((seg, idx) => {
    if (state.selectionMode !== 'auto' || !state.meetingStarted) return true;
    if (seg.key !== 'fengling') return true;
    if (firstFengIdx0 >= 0 && idx === firstFengIdx0) return true; // 本条首段风玲不剥，防与流式条数不一 → tryReuse 失败 → 风玲行 morph 成嘉宾/消失
    if (looksLikeFakeUserReplyEcho(seg.text)) {
      console.log('[拦截] 风玲段疑似自答用户回复，丢弃：', seg.text.slice(0, 30));
      return false;
    }
    return true;
  });
  const authorized = filterAuthorizedSpeakers(afterEcho, content);
  const firstFengIdx1 = authorized.findIndex(s => s && s.key === 'fengling');
  const noFakeRecap = filterFakeGuestRecap(authorized, firstFengIdx1);
  const noRepeating = filterRepeatingHostSegments(noFakeRecap);
  return dedupeSpeakerSegments(noRepeating);
}

// 同一段 DOM 在流式中说话人 key 因解析修正而变化时，原地更新抬头/头像，避免删节点闪屏
function morphStreamMessageElement(msgDiv, seg) {
  const name = seg.speaker;
  const key = seg.key;
  msgDiv.dataset.speakerKey = key;
  const info = getCelebrityInfo(name, key);
  const isFengling = key === 'fengling';
  const avatarEl = msgDiv.querySelector('.message-avatar');
  const nameEl = msgDiv.querySelector('.message-name');
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.style.color = info.color;
  }
  if (avatarEl) {
    avatarEl.style.background = isFengling ? 'transparent' : info.color;
    avatarEl.innerHTML = isFengling ? FENGLING_AVATAR : name.charAt(0);
  }
  const voiceBtn = msgDiv.querySelector('.msg-voice-btn');
  if (voiceBtn) {
    voiceBtn.setAttribute('data-speaker', name);
  }
}

function reconcileStreamDom(parsed) {
  for (let i = 0; i < parsed.length; i++) {
    const seg = parsed[i];
    if (i < streamMsgElements.length) {
      const el = streamMsgElements[i];
      if (!el) continue;
      if ((el.dataset.speakerKey || '') !== seg.key) {
        morphStreamMessageElement(el, seg);
      }
    } else {
      const insertAfter = streamMsgElements[i - 1] || null;
      const el = createStreamMessage(seg.speaker, seg.key, insertAfter);
      if (el && el.dataset) el.dataset.speakerKey = seg.key;
      streamMsgElements.push(el);
    }
  }
  while (streamMsgElements.length > parsed.length) {
    const rem = streamMsgElements.pop();
    if (rem) rem.remove();
  }
}

// 流式结束若 DOM 行数/说话人 key 与最终解析一致，仅更新气泡，避免 clear 再 add 的闪断
function tryReuseStreamAsFinal(fullContent) {
  if (streamMsgElements.length === 0) return false;
  const isOneOnOne = state.selectedCelebrities.length === 1;
  if (state.selectionMode === 'auto' && !state.meetingStarted) return false;
  const parsed = buildHostedParsedSegments(fullContent, isOneOnOne);
  if (parsed.length === 0 || parsed.length !== streamMsgElements.length) return false;
  for (let i = 0; i < parsed.length; i++) {
    if ((streamMsgElements[i].dataset.speakerKey || '') !== parsed[i].key) return false;
  }
  for (let i = 0; i < parsed.length; i++) {
    const bubble = streamMsgElements[i].querySelector('.message-bubble');
    if (bubble) {
      bubble.innerHTML = formatMessageContent(parsed[i].text.trim());
    }
    const actionsDiv = streamMsgElements[i].querySelector('.message-actions');
    if (actionsDiv) actionsDiv.classList.add('show');
  }
  recordHostUtterances(parsed);
  streamMsgElements = [];
  streamParsedMode = false;
  removeStreamTyping();
  return true;
}

function renderStreamContent(fullContent) {
  // 主持人模式会前：不拆多角色，但用单条【风玲】流式气泡展示，避免只转圈/空白像「出 bug」
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    const text = String(fullContent || '').replace(/【[^】]*$/, '');
    removeStreamTyping();
    if (streamMsgElements.length === 0) {
      const el = createStreamMessage('风玲', 'fengling', null);
      if (el && el.dataset) el.dataset.speakerKey = 'fengling';
      streamMsgElements = [el];
    }
    const bubble = streamMsgElements[0]?.querySelector?.('.message-bubble');
    if (bubble) {
      bubble.innerHTML = text.trim() ? formatMessageContent(text) : '';
    }
    const actions = streamMsgElements[0]?.querySelector?.('.message-actions');
    if (actions) actions.classList.remove('show');
    scrollToBottom();
    return;
  }

  // 如果只有1位参会人员，跳过第一个标记之前的所有内容（风玲的引导语）
  const isOneOnOne = state.selectedCelebrities.length === 1;
  
  // 去掉末尾尚未闭合的 【xxx 片段，避免显示原始标记
  const cleanContent = fullContent.replace(/【[^】]*$/, '');

  const parsed = buildHostedParsedSegments(cleanContent, isOneOnOne);

  if (parsed.length === 0) {
    return;
  }

  // 首次有内容要渲染时，移除打字指示器
  removeStreamTyping();

  // 首次进入多角色解析模式
  if (!streamParsedMode) {
    streamMsgElements.forEach(el => el.remove());
    streamMsgElements = [];
    streamParsedMode = true;
    // 会议正式开始：一次性把所有参会人员加入嘉宾栏
    addAllParticipantsAtOnce(fullContent);
  }

  // 对旧元素（没有 speakerKey）先补齐
  streamMsgElements.forEach((el, i) => {
    const seg = parsed[i];
    if (el && el.dataset && !el.dataset.speakerKey && seg) {
      el.dataset.speakerKey = seg.key;
    }
  });
  // 与「全删重建」不同：从首个错位处起原地 morph / 在末尾补节点 / 从末尾删多余，避免风玲行整段消失
  reconcileStreamDom(parsed);

  // 更新每个段的文本
  for (let i = 0; i < parsed.length; i++) {
    const bubble = streamMsgElements[i].querySelector('.message-bubble');
    if (bubble) bubble.innerHTML = formatMessageContent(parsed[i].text.trim());
    
    // 只有已完成的段（不是最后一个）才显示按钮
    const actionsDiv = streamMsgElements[i].querySelector('.message-actions');
    if (actionsDiv && i < parsed.length - 1) {
      // 已完成的段，显示按钮
      actionsDiv.classList.add('show');
    }
  }

  // 更新话筒状态：最后一个有内容的段就是当前说话人
  const lastSeg = parsed[parsed.length - 1];
  if (lastSeg && lastSeg.key) {
    setGuestSpeaking(lastSeg.key);
  }

  // 实时检测新发言人并加入嘉宾栏
  autoAddSpeakersFromParsed(parsed);

  scrollToBottom();
}

// 过滤风玲的重复自我介绍（仅保留开场白中的第一次）
function filterFenglingSelfIntro(content, messageIndex) {
  // 仅在真正的首次欢迎阶段允许自我介绍；进入用户问答后一律过滤
  const canKeepIntro = !state.hostIntroShown && messageIndex === 0;
  if (canKeepIntro) return content;
  
  // 匹配并移除各种自我介绍模式
  const patterns = [
    /^【风玲】\s*/g,
    /欢迎来到光年之约圆桌会[，,。！!.]?/g,
    /欢迎来到光年圆桌会[，,。！!.]?/g,
    /你好！?我是风玲[，,。！!.]?/g,
    /我是风玲[，,。！!.]?/g,
    /我是主持人风玲[，,。！!.]?/g,
    /大家好！?我是风玲[，,。！!.]?/g,
  ];
  
  let filtered = content;
  for (const pattern of patterns) {
    filtered = filtered.replace(pattern, '');
  }
  
  // 保留段落换行，只压缩“行内”多余空格
  filtered = filtered
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
  
  return filtered;
}

// 一对一模式下过滤风玲的所有发言
function filterFenglingInOneOnOne(content) {
  // 使用正则表达式移除所有【风玲】开头的内容块
  // 匹配：【风玲】...直到下一个【某人】或结尾
  const fenglingPattern = /\u3010\u98ce\u73b2\u3011[^\u3010]*/g;
  
  let filtered = content.replace(fenglingPattern, '');
  
  // 清理多余的空行（3个或更多换行符替换为2个）
  filtered = filtered.replace(/\n\s*\n\s*\n/g, '\n\n');
  filtered = filtered.trim();
  
  return filtered;
}

// ========== 是否处于/看起来是总结输出阶段 ==========
// 只要处在主持人模式的正式会议阶段，并且：
//   1) 用户已确认结束（summaryReady），或
//   2) 整段内容被识别为总结结构（含 总结/报告 + 核心观点 + 共识/分歧），或
//   3) 流式/局部出现**强**总结语（如「会议总结报告」「本场新组合洞见」等）
// 就认为当前回复属于总结，需要强制只保留风玲段落。
// 注意：不得单独用「核心观点」「共识与分歧」等**讨论中高频词**作判断——
// 否则会把首轮长回复误判为总结，`stripNonHostForSummary` 会剥掉所有嘉宾、写入历史的上下文丢失，界面经 `filterAuthorizedSpeakers` 也会只剩风玲，表现为「大家说完后信息没了」。
function isSummaryPhaseContent(rawContent) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return false;
  if (state.summaryReady) return true;
  if (typeof rawContent !== 'string' || !rawContent) return false;
  if (detectMeetingSummary(rawContent)) return true;
  // 只保留在真实总结里常见、在首轮/自由讨论中极少单独出现的强信号
  const earlySummaryPatterns = [
    /会议总结报告/,
    // 删「风玲+总结」行内匹配：阶段一/二风玲说「我简单总结一句」会误判，filterAuthorized 只留风玲会剥掉同条全部嘉宾，或引发终稿/流式条数与 DOM 首行 morph
    /本场新?组合洞见/,
    /本次会议[的]?新见解/,
  ];
  return earlySummaryPatterns.some(re => re.test(rawContent));
}

// ========== 总结阶段：强制剥离嘉宾段落，仅保留风玲 ==========
function stripNonHostForSummary(rawContent) {
  if (!isSummaryPhaseContent(rawContent)) return rawContent;
  const isOneOnOne = state.selectedCelebrities.length === 1;
  const parsed = parseMultiSpeaker(rawContent, isOneOnOne);
  const fenglingSegs = parsed.filter(seg => seg.key === 'fengling');
  if (fenglingSegs.length === 0) {
    // 没有风玲段落：剥掉所有【嘉宾名】标记，整体作为风玲总结
    const cleaned = rawContent.replace(/【[^】]+】/g, '').trim();
    return `【风玲】${cleaned}`;
  }
  return fenglingSegs.map(seg => `【风玲】${seg.text.trim()}`).join('\n\n');
}

// ========== 清洗将要写入历史的助手内容：去掉重复段落 ==========
// 避免 LLM 看到自己上一轮有"同一段话说两遍"的模式，继续在后续回复里复述
function cleanAssistantContentForHistory(rawContent) {
  if (!rawContent) return rawContent;
  const isOneOnOne = state.selectedCelebrities.length === 1;
  let parsed = parseMultiSpeaker(rawContent, isOneOnOne);
  if (parsed.length === 0) return rawContent;

  // 主持人模式下：清掉"自答用户/自答嘉宾/复读上轮主持人发言"的段（本条**首段**【风玲】一律保留，防 morph/丢历史）
  if (state.selectionMode === 'auto' && state.meetingStarted) {
    const firstFeng0 = parsed.findIndex(s => s && s.key === 'fengling');
    parsed = filterFakeGuestRecap(parsed, firstFeng0);
    parsed = parsed.filter((seg, idx) => {
      if (seg.key !== 'fengling') return true;
      if (firstFeng0 >= 0 && idx === firstFeng0) return true;
      if (looksLikeFakeUserReplyEcho(seg.text)) return false;
      const norm = normalizeSegText(seg.text);
      if (isTextRepeatingRecentHost(norm)) return false;
      return true;
    });
  }

  const deduped = dedupeSpeakerSegments(parsed);
  if (deduped.length === 0) return ''; // 全部被清掉，返回空字符串，外层不写历史
  return deduped.map(seg => `【${seg.speaker}】${seg.text.trim()}`).join('\n\n');
}

// ========== 主持人模式嘉宾准入过滤 ==========
// rawContentForCheck: 可选，用于基于内容识别是否进入总结阶段
function filterAuthorizedSpeakers(parsed, rawContentForCheck) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return parsed;
  // 总结阶段：强制只保留风玲发言（基于 state 或基于内容识别）
  const contentForCheck = rawContentForCheck ?? parsed.map(p => `【${p.speaker}】${p.text}`).join('\n');
  if (isSummaryPhaseContent(contentForCheck)) {
    return parsed.filter(seg => seg.key === 'fengling');
  }
  const allowed = new Set(state.selectedCelebrities);
  allowed.add('fengling');
  return parsed.filter(seg => allowed.has(seg.key));
}

// ========== 段落去重：LLM 在续写时可能复述前面风玲/嘉宾的话，导致同一段被渲染两次 ==========
// 策略：规范化文本（去空白/标点差异），若后一段与同角色前段的规范化文本高度一致（前缀相同或完全相同）则丢弃后一段
function normalizeSegText(text) {
  return String(text || '')
    .replace(/\s+/g, '')          // 去所有空白
    .replace(/[，,。.！!？?；;：:、""''""]/g, '') // 去常见标点
    .trim();
}

function dedupeSpeakerSegments(parsed) {
  if (!Array.isArray(parsed) || parsed.length <= 1) return parsed;
  const result = [];
  const seenByKey = new Map(); // key -> 已保留段的 normalized 文本数组

  for (const seg of parsed) {
    const norm = normalizeSegText(seg.text);
    if (norm.length === 0) {
      result.push(seg);
      continue;
    }
    const seenList = seenByKey.get(seg.key) || [];
    const isDup = seenList.some(prev => {
      if (prev === norm) return true;
      if (norm.length >= 20 && prev.length >= 20) {
        if (prev.startsWith(norm) || norm.startsWith(prev)) return true;
        if (prev.includes(norm) || norm.includes(prev)) return true;
      }
      return false;
    });
    if (isDup) {
      console.log(`[去重] 丢弃重复段落 [${seg.speaker}]: ${seg.text.slice(0, 30)}...`);
      continue;
    }
    seenList.push(norm);
    seenByKey.set(seg.key, seenList);
    result.push(seg);
  }
  return result;
}

// ========== 跨条主持人发言去重：与最近 N 条主持人发言比较 ==========
const HOST_HISTORY_MAX = 6;

function isTextRepeatingRecentHost(textNorm) {
  if (!textNorm || textNorm.length < 12) return false;
  const list = state.recentHostUtterances || [];
  return list.some(prev => {
    if (prev === textNorm) return true;
    if (prev.length >= 20 && textNorm.length >= 20) {
      if (prev.startsWith(textNorm) || textNorm.startsWith(prev)) return true;
      if (prev.includes(textNorm) || textNorm.includes(prev)) return true;
    }
    return false;
  });
}

function recordHostUtterances(parsed) {
  if (!Array.isArray(parsed)) return;
  for (const seg of parsed) {
    if (seg.key !== 'fengling') continue;
    const norm = normalizeSegText(seg.text);
    if (!norm || norm.length < 8) continue;
    state.recentHostUtterances = state.recentHostUtterances || [];
    if (!state.recentHostUtterances.includes(norm)) {
      state.recentHostUtterances.push(norm);
      if (state.recentHostUtterances.length > HOST_HISTORY_MAX) {
        state.recentHostUtterances.shift();
      }
    }
  }
}

// 主持人模式下：拦截"自答嘉宾发言"的风玲段
// 触发条件：当前段是风玲；且这段话以"刚才/几位/各位..."开头承接嘉宾；且历史+本次实际都没有嘉宾发言；
// 或者：当前 parsed 里有连续多段风玲没有嘉宾夹隔，后续风玲段是基于"前面嘉宾说过"的承接假设
// 可传入**本条**在 filterAuthorized 之后的第一段风玲下标，用于与「首条风玲永不剥」规则对齐；缺省时仍按 `parsed` 自算
function filterFakeGuestRecap(parsed, firstFengInParsed = -1) {
  if (!Array.isArray(parsed) || parsed.length === 0) return parsed;
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return parsed;
  if (getHostNextSegment() === 3) return parsed;

  const firstF = firstFengInParsed >= 0
    ? firstFengInParsed
    : parsed.findIndex(s => s && s.key === 'fengling');

  const result = [];
  let hasGuestSoFar = hasAnyGuestSpokenRecently(null);

  for (let i = 0; i < parsed.length; i++) {
    const seg = parsed[i];
    if (seg.key !== 'fengling') {
      result.push(seg);
      hasGuestSoFar = true;
      continue;
    }
    if (i === firstF) {
      result.push(seg);
      continue;
    }
    if (looksLikeHostFakingGuestSpeeches(seg.text) && !hasGuestSoFar) {
      console.log('[拦截] 风玲段疑似自答"嘉宾发言"（嘉宾实际尚未开口），丢弃：', seg.text.slice(0, 30));
      continue;
    }
    result.push(seg);
  }
  return result;
}

// 在主持人模式下：丢弃"与最近主持人发言"重复的风玲段（跨条去重）
// 注意：本助手回复中**出现的第一段【风玲】**不得丢弃，否则落盘与流式 DOM 条数不一致，会出现「主持人说完就消失」
function filterRepeatingHostSegments(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return parsed;
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return parsed;
  const firstFengIdx = parsed.findIndex(seg => seg && seg.key === 'fengling');
  const result = [];
  for (let i = 0; i < parsed.length; i++) {
    const seg = parsed[i];
    if (seg.key === 'fengling') {
      const norm = normalizeSegText(seg.text);
      if (i !== firstFengIdx && isTextRepeatingRecentHost(norm)) {
        console.log(`[跨条去重] 丢弃复读的主持人段：${seg.text.slice(0, 30)}...`);
        continue;
      }
    }
    result.push(seg);
  }
  return result;
}

// 检测整段输出是否在"自答用户"——LLM 假装用户已回复
// 特征：一段以承接式开头但本会话用户其实没真正发言
const FAKE_USER_REPLY_PATTERNS = [
  /^(您说得对|您说的对|你说得对|你说的对|好的|嗯[，,。.]|是的[，,]|没错[，,]|的确|确实如此|我明白了|我懂了|明白了|了解了|您说得在理|您说得没错)/,
  /^(谢谢[您你]的(回应|回复|分享|发言))/,
];

function looksLikeFakeUserReplyEcho(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return FAKE_USER_REPLY_PATTERNS.some(re => re.test(t));
}

// 检测风玲段是否在"自答嘉宾发言"——LLM 假装嘉宾们已经发过言并综合他们观点
// 典型特征：以"刚才/方才/听完/综合/前面几位/几位先生/诸位/各位..."开头并紧随"发言/观点/讨论/勾勒/讲到/分享"等
const FAKE_GUEST_RECAP_REGEX =
  /^\s*(刚才|方才|听完|听了|听过|综合|总结|回顾|前面|前几位|几位|诸位|各位|诸君)[^。！？!?\n]{0,20}(发言|观点|看法|说法|分享|讲到|谈到|提及|提到|论述|所说|所言|所述|勾勒|讨论|探讨|阐述|角度|维度|见解|思考)/;

function looksLikeHostFakingGuestSpeeches(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return FAKE_GUEST_RECAP_REGEX.test(t);
}

// 判断"历史消息 + 本次已解析段落"中是否真的出现过任何嘉宾发言（非风玲段）
function hasAnyGuestSpokenRecently(parsedCurrent) {
  if (Array.isArray(parsedCurrent)) {
    if (parsedCurrent.some(seg => seg.key && seg.key !== 'fengling')) return true;
  }
  const msgs = state.messages || [];
  // 只扫 10 条在「系统 user 连发/长会话」时易漏检：有嘉宾的助手条若不在窗内，会误把下一条风玲当「自答」剥掉，首段被解析成嘉宾 → DOM 把首行 morph 成嘉宾，表现为风玲「闪一下没了」
  for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 40; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'assistant' || !m.content) continue;
    // 解析出非"风玲"的发言标记即视为嘉宾已发言
    const markerRe = /【([^】]+)】/g;
    let mm;
    while ((mm = markerRe.exec(m.content)) !== null) {
      const name = (mm[1] || '').trim();
      if (name && name !== '风玲') return true;
    }
  }
  return false;
}

// ========== 最终完整渲染 ==========
function renderFinalContent(fullContent) {
  // 主持人模式会前推荐阶段：按主持人单条消息展示，不拆多角色
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    const safeHostMessage = buildPreMeetingHostMessage(fullContent);
    addSpeakerMessage('风玲', safeHostMessage, 'fengling');
    return;
  }

  // 如果只有1位参会人员，跳过第一个标记之前的所有内容（风玲的引导语）
  const isOneOnOne = state.selectedCelebrities.length === 1;
  
  const parsed = buildHostedParsedSegments(fullContent, isOneOnOne);
  recordHostUtterances(parsed);

  if (parsed.length === 0) {
    // 总结阶段兜底：LLM 完全没输出风玲段落，把嘉宾标记剥掉，整体作为风玲总结展示
    if (isSummaryPhaseContent(fullContent)) {
      const cleaned = fullContent.replace(/【[^】]+】/g, '').trim();
      addSpeakerMessage('风玲', cleaned || fullContent.trim(), 'fengling');
      return;
    }
    if (state.selectionMode === 'manual' && state.selectedCelebrities.length > 0) {
      const fallbackKey = state.selectedCelebrities[0];
      const fallbackName = CELEBRITIES[fallbackKey]?.displayName || '嘉宾';
      addSpeakerMessage(fallbackName, fullContent.trim(), fallbackKey);
    } else {
      addSpeakerMessage('风玲', fullContent.trim(), 'fengling');
    }
    return;
  }
  for (const seg of parsed) {
    if (seg.text.trim()) {
      addSpeakerMessage(seg.speaker, seg.text.trim(), seg.key);
    }
  }
  
  // 确保流式消息的最后一个段也显示按钮
  if (streamMsgElements.length > 0) {
    const lastMsg = streamMsgElements[streamMsgElements.length - 1];
    const actionsDiv = lastMsg.querySelector('.message-actions');
    if (actionsDiv) {
      actionsDiv.classList.add('show');
    }
  }
}

// ========== 动态名人：为不在数据库中的名人创建临时条目 ==========
const DYNAMIC_COLORS = ['#7B6B5D','#5B7A5B','#5D6B7B','#7B5B6B','#6B7B5B','#5B6B7B','#7B6B5B','#6B5B7B'];
let dynamicColorIdx = 0;

function ensureCelebrityEntry(speakerName) {
  if (speakerName === '风玲') return 'fengling';

  const cleanName = speakerName.replace(/[（(].+?[）)]$/g, '').trim();

  // 精确匹配
  for (const k in CELEBRITIES) {
    if (CELEBRITIES[k].displayName === speakerName || CELEBRITIES[k].displayName === cleanName) return k;
  }

  // 模糊匹配：名字互相包含（如 "庄子" 包含在 "庄子先生" 中）
  for (const k in CELEBRITIES) {
    const dn = CELEBRITIES[k].displayName;
    if (cleanName.includes(dn) || dn.includes(cleanName)) return k;
  }

  // 主持人模式会议已开始：禁止创建不在库中的动态条目，返回 null
  if (state.selectionMode === 'auto' && state.meetingStarted) {
    return null;
  }

  // 非主持人模式或会前阶段：允许创建动态条目
  const displayName = cleanName || speakerName;
  const dynamicKey = 'dynamic-' + displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-').toLowerCase();
  if (!CELEBRITIES[dynamicKey]) {
    CELEBRITIES[dynamicKey] = {
      name: displayName,
      displayName: displayName,
      title: '圆桌嘉宾',
      domain: '特邀',
      color: DYNAMIC_COLORS[dynamicColorIdx++ % DYNAMIC_COLORS.length],
      description: displayName,
      skill: null,
    };
  }
  return dynamicKey;
}

function parseLineStartSpeakerMarkers(content) {
  // 允许两类发言标记边界：
  // 1) 段首/换行后；2) 句末标点后（例如“...定义。 【庄子】...”）
  // 这样既支持模型偶发的“同段多发言”，也尽量避免把句中提及【某人】误判为新发言。
  // 同时兼容 markdown 包裹写法，例如 **【庄子】**、### 【庄子】
  const markerRegex = /(^|[\n。！？；;:：]\s*)(?:\*\*|__|#{1,4}\s+|>\s+|-+\s+)?【([^】]{1,20})】(?:\*\*|__)?/g;
  const markers = [];
  let m;
  while ((m = markerRegex.exec(content)) !== null) {
    const markerText = `【${m[2]}】`;
    const markerIdxInMatch = m[0].indexOf(markerText);
    if (markerIdxInMatch < 0) continue;
    const index = m.index + markerIdxInMatch;
    markers.push({
      speaker: m[2].trim(),
      index,
      end: index + markerText.length,
    });
  }

  // 过滤“伪发言标记”：主持人句内点名不应被当作嘉宾发言块
  // **禁止**在过滤时丢弃**全文中的第一个**【风玲】，否则流式到后半段时首段会由风玲被重解析成下一位【嘉宾】→ reconcile 把首行 morph 成嘉宾，出现「主持头像闪一下变名人」
  const filtered = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    if (i === 0 && cur.speaker === '风玲') {
      filtered.push(cur);
      continue;
    }
    const next = markers[i + 1];
    const nextIndex = next ? next.index : content.length;
    const preview = content.slice(cur.end, Math.min(nextIndex, cur.end + 48)).trimStart();

    if (/^[，,、]/.test(preview) && /请.{0,20}(谈谈|发言|回应|补充|分享|继续|先说)/.test(preview)) {
      continue;
    }
    if (/^【[^】]+】/.test(preview) && /请.{0,20}(谈谈|发言|回应|补充|分享|继续|谁先)/.test(preview)) {
      continue;
    }

    filtered.push(cur);
  }

  return filtered;
}

function parseLooseSpeakerMarkers(content) {
  const markers = [];
  const regex = /【([^】]{1,20})】/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const speaker = (m[1] || '').trim();
    if (!speaker) continue;
    if (speaker === '风玲') {
      markers.push({ speaker, index: m.index, end: m.index + m[0].length });
      continue;
    }
    // 仅接受可识别嘉宾，避免把句中任意【词】误识别成发言人
    const key = findCelebrityKeyByDisplayName(speaker);
    if (!key) continue;
    markers.push({ speaker, index: m.index, end: m.index + m[0].length });
  }
  return markers;
}

// ========== 解析多角色消息 ==========
function parseMultiSpeaker(content, skipPreText = false) {
  // 只把“行首/段首的【名字】”视作发言人标记，避免把句中【名字】误识别成发言段
  let markers = parseLineStartSpeakerMarkers(content);

  // 兜底：若严格解析失败，但文本里有多个可识别发言人标记，则启用宽松拆分
  if (markers.length === 0) {
    const looseMarkers = parseLooseSpeakerMarkers(content);
    if (looseMarkers.length >= 2) {
      markers = looseMarkers;
    } else {
      return [];
    }
  }

  const segments = [];

  // 第一遍：按标记切分，每段文本从标记结尾到下一个标记开头
  for (let i = 0; i < markers.length; i++) {
    const speaker = markers[i].speaker;
    
    // 如果 skipPreText=true（一对一模式），跳过所有风玲的标记
    if (skipPreText && speaker === '风玲') {
      continue;
    }
    
    const textStart = markers[i].end;
    const textEnd = (i + 1 < markers.length) ? markers[i + 1].index : content.length;
    const text = content.slice(textStart, textEnd);

    // 自动查找或创建名人条目，确保每个发言人都有 key
    const key = ensureCelebrityEntry(speaker);
    segments.push({ speaker, key, text });
  }
  
  // 只有在非一对一模式下，才添加第一个标记之前的文字给风玲
  if (!skipPreText && markers.length > 0 && markers[0].index > 0) {
    const preText = content.slice(0, markers[0].index).trim();
    if (preText) {
      segments.unshift({ speaker: '风玲', key: 'fengling', text: preText });
    }
  }

  return segments;
}

// ========== 从发言段落中自动识别并添加嘉宾 ==========
function autoAddSpeakersFromParsed(parsed) {
  // 主持人模式会议中：嘉宾名单已锁定，禁止自动添加任何新嘉宾
  if (state.selectionMode === 'auto' && state.meetingStarted) return;

  let changed = false;
  for (const seg of parsed) {
    if (!seg.key || seg.key === 'fengling') continue;
    if (state.removedCelebrities.has(seg.key)) continue;
    
    if (!state.selectedCelebrities.includes(seg.key)) {
      state.selectedCelebrities.push(seg.key);
      changed = true;
    }
  }
  if (changed) {
    updateGuestBar();
    headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾就座`;
  }
}

// ========== 会议开始时一次性添加所有参会名人 ==========
// ========== 会议开始时一次性添加所有参会名人 ==========
function addAllParticipantsAtOnce(currentStreamContent) {
  // 主持人模式：嘉宾名单在会前已由用户确认锁定，此处不做任何添加
  if (state.selectionMode === 'auto') return;

  // 非主持人模式：从流式内容和历史消息中识别发言人并加入嘉宾栏
  const found = new Set(state.selectedCelebrities);

  const markerRegex = /(^|\n)\s*【([^】]+)】/gm;
  let m;
  while ((m = markerRegex.exec(currentStreamContent)) !== null) {
    const speaker = m[2].trim();
    if (!speaker || speaker === '风玲') continue;
    const key = ensureCelebrityEntry(speaker);
    if (key && !state.removedCelebrities.has(key)) {
      found.add(key);
    }
  }

  for (const msg of state.messages) {
    if (msg.role !== 'assistant') continue;
    const text = msg.content;

    for (const k in CELEBRITIES) {
      if (found.has(k) || state.removedCelebrities.has(k)) continue;
      if (text.includes(CELEBRITIES[k].displayName)) {
        found.add(k);
      }
    }

    const bracketRegex2 = /(^|\n)\s*【([^】]+)】/gm;
    while ((m = bracketRegex2.exec(text)) !== null) {
      const name = m[2].trim();
      if (!name || name === '风玲') continue;
      const key = ensureCelebrityEntry(name);
      if (key && !state.removedCelebrities.has(key)) {
        found.add(key);
      }
    }
  }

  const newKeys = [...found].filter(k => !state.selectedCelebrities.includes(k));
  if (newKeys.length > 0) {
    state.selectedCelebrities.push(...newKeys);
    updateGuestBar();
    headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾就座`;
  }
}

// ========== 检查并应用AI推荐的名人（最终内容检查） ==========
function checkAndApplyRecommendations(content) {
  // 主持人模式 + 会前阶段：只做推荐名单提取，不进入嘉宾发言解析
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    const recommended = extractRecommendationKeys(content).slice(0, 10);
    if (recommended.length >= 2) {
      state.selectedCelebrities = recommended;
      updateGuestBar();
      headerSubtitle.textContent = `主持人推荐 ${recommended.length} 位嘉宾，确认后开始会议`;
    }
    return;
  }

  // 会议进行中：从最终内容中解析发言人，自动加入嘉宾栏
  const parsed = parseMultiSpeaker(content)
    .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text));
  if (parsed.length > 0) {
    // 过滤掉已删除的名人
    const filteredParsed = parsed.filter(seg => !state.removedCelebrities.has(seg.key));
    autoAddSpeakersFromParsed(filteredParsed);
  }
}

/**
 * 会中在场嘉宾的 key 列表（不含风玲、不含用户已移出嘉宾）
 */
function getActiveGuestKeys() {
  return (state.selectedCelebrities || []).filter(
    k => k && k !== 'fengling' && !state.removedCelebrities.has(k)
  );
}

function getMissingGuestKeysFromParsed(parsed) {
  const guestKeys = getActiveGuestKeys();
  if (guestKeys.length === 0) return [];
  const spoken = new Set(
    (parsed || []).filter(s => s && s.key && s.key !== 'fengling').map(s => s.key)
  );
  return guestKeys.filter(k => !spoken.has(k));
}

/**
 * 第1/2/3段：同一条里缺嘉宾时，只续嘉宾、不续风玲「衔接」
 * @param {string} [hostIntentHint] 本条中已有【风玲】的引导摘要，续写时嘉宾须对准该意图
 */
function buildMissingGuestsContinuePrompt(missingKeys, nextSeg, hostIntentHint) {
  const names = missingKeys.map(k => CELEBRITIES[k]?.displayName).filter(Boolean);
  if (names.length === 0) {
    return '[系统提示] 请为尚未用【】标记完整发言的嘉宾补全发言段落，不要输出【风玲】。';
  }
  const stageLabel = nextSeg === 1 ? '一·首轮分析' : nextSeg === 2 ? '二·补充与深化' : '三·共识与分歧';
  const intentBlock =
    hostIntentHint && hostIntentHint.trim()
      ? `\n**本条中【风玲】已交代的讨论任务与方向如下**（未出场嘉宾须**紧扣**其提问、角度、人物关系与顺序，勿泛泛独白）：\n「${hostIntentHint}」\n`
      : '\n**须**按同条中【风玲】对发言顺序、回应对象的布置来落稿，禁止脱离主持刚设定的角度。\n';
  return (
    `[系统提示] 当前是主持人模式**第${nextSeg}段/阶段${stageLabel}**。${intentBlock}` +
    '本段为「风玲**仅在**全条**最前**出现**一次**作引导，其后**只**有各位**嘉宾**段落；在**第1、2 段**要求**每位嘉宾在本阶段仅一段【】发言（每人一次）**；在**前两个阶段**的每一次输出中，**禁止**在两位嘉宾的段落**之间**再插入【风玲】。' +
    '本轮续写是补全**尚未发言/未以【】完整落地**的嘉宾。请**只输出**以下嘉宾的段落，按顺序' +
    (nextSeg <= 2 ? '、**每人本阶段仅一段**' : '、每人至少一段') +
    '，**不要**输出【风玲】：' +
    names.map(n => '【' + n + '】').join('、') +
    (nextSeg <= 2
      ? '\n**第1/2 段**不得让已出场同一人本阶段内再开第二长段；**句内轻量接话**可，多轮对辩**留到第三段**。\n' +
        '**须**承接段首【风玲】的交锋点/提问/顺序，勿泛泛独白。严禁整段复述上文已说过的原句。'
      : '\n嘉宾之间可自然接话、多轮辩驳，但**须承接主持给出的交锋点/提问**。严禁整段复述上文已说过的原句。')
  );
}

/**
 * 阶段一或阶段二在「单条最前风玲+本段全部嘉宾」已齐后，拉取下一段的续写系统提示
 * @param {1|2} finishedStage 刚完整结束的是第几段（1=阶段一，2=阶段二）
 */
function buildAdvanceToNextHostedStagePrompt(finishedStage) {
  if (finishedStage === 1) {
    return (
      '[系统提示] 上一条已**完整完成阶段一**（最前【风玲】+本段全体【嘉宾】各一段）。\n' +
      '请在本对话中**立即**输出**阶段二·补充与深化**对应的一条（一次回复内）：' +
      '全条**最前**为**唯一**【风玲】，点明本段要「补充、拓展、深化或温和修正」阶段一观点；' +
      '之后**只**有各位【嘉宾】在本阶段的发言段落；**阶段二仍须每位嘉宾只写一段**；**不要**在嘉宾之间插入【风玲】，**不要**在段末单独增加风玲收束/小结。'
    );
  }
  return (
    '[系统提示] 上一条已**完整完成阶段二**（最前风玲+本段全体【嘉宾】各一段）。\n' +
    '请在本对话中**立即**输出**阶段三·共识、分歧与交锋**对应的一条（**与上一条阶段二有本质不同**——上一条是「每人**只**一段、**不要**在嘉宾间插风玲、**不要**多轮对辩」；**本条起**才允许**自由讨论**与风玲**穿插**衔接）：' +
    '全条**最前**先用**唯一一段**【风玲】、用**自然口语**点明**「从这里开始是自由讨论」**（**勿**用「第几段」等机器话），可简要承接前两轮、再**转入**可交锋/可追问的氛围；' +
    '随后嘉宾可**多轮**回应与辩难，风玲在**需衔接、邀用户、征求结束**时**可多次**以【风玲】出场。' +
    '**不要**在无人明确同意时输出成稿式会议总结。'
  );
}

/**
 * 阶段一/二在一条内已产齐时，推入下一段的续写（完成一条链式 generateResponse；调用方 return true）
 * @param {number} finishedStage 即当前主任务为「第 n 段」的 n（1=刚完成阶段一、2=刚完成阶段二），与下一条的 hostedRound 计数对齐
 * @param {string} safetyGuards SAFETY 拼接段
 */
async function pushAndContinueHostedNextStage(finishedStage, safetyGuards) {
  const stage = Math.min(2, Math.max(1, finishedStage));
  state.hostedRound = stage;
  state.autoContinueRetries = 0;
  state.consecutiveUserInvitePending = 0;
  state.s3BridgeFromGuestInFlight = false;
  hostFlowResetLock();
  const advance = buildAdvanceToNextHostedStagePrompt(stage) + (safetyGuards || '');
  state.messages.push({ role: 'user', content: advance });
  await generateResponse();
  return true;
}
// 如果风玲引导了嘉宾发言，但AI没有生成嘉宾的回复，自动继续请求
// **编排原则**：三阶段与 `hostFlowLock`+`hostedRound` 强控。第三段**用户**每句经 `classifyFlowchartStage3UserIntent` 判**流程图** D/A/B/C/U；**风玲**收束问经 `classifyHostAskingUserToEnd`（无密钥时正则 `detectHostEndConfirmationPrompt` 兜底）。其余编排不靠关键词、不另调「风玲要停」LLM。
// 返回 true 表示本层调用了 `generateResponse` 以链式续写；主流程据此决定是否递增 hostedRound
// **编排**：三阶段只依据 `hostedRound` / `getHostNextSegment`、多说话人**解析结构**（末段、缺谁）、系统**硬注入**的 user 与 `hostFlowLock`；不用语义关键词、不调用 LLM 判「风玲要停」。
async function checkAndContinueGeneration(content) {
  if (state.selectionMode === 'auto' && (!state.meetingStarted || state.meetingEnded)) {
    return false;
  }
  if (state.summaryReady) {
    return false;
  }

  const inHost = state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded;
  if (inHost && state.hostFlowLock === HostFlow.USER) {
    console.log('[HostFlow] 强控：须等用户发话，跳过自动续写');
    return false;
  }
  if (inHost && state.hostFlowLock === HostFlow.ONE_SHOT) {
    state.hostFlowLock = HostFlow.OPEN;
    console.log('[HostFlow] 强控：编排单停已消费，不续链');
    return false;
  }

  if ((state.consecutiveUserInvitePending || 0) >= 2) {
    console.warn('[自动续写] 主持人已连续多次邀请用户但用户尚未回复，停止续写');
    return false;
  }

  state.autoContinueDepth = (state.autoContinueDepth || 0) + 1;
  if (state.autoContinueDepth > 8) {
    console.warn('[自动续写] 达到绝对深度上限，停止续写');
    state.autoContinueDepth = Math.max(0, state.autoContinueDepth - 1);
    return false;
  }

  try {
    // 只用于续写调度：可解析的【】+ 人员锁定；不在此函数内做风玲/嘉宾「复述」等文案启发式
    const isOneOnOne = state.selectedCelebrities.length === 1;
    let parsed = parseMultiSpeaker(content, isOneOnOne)
      .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text));
    if (state.selectionMode === 'auto' && state.meetingStarted) {
      parsed = filterAuthorizedSpeakers(parsed, content);
    }

    if (parsed.length > 0) {
      state.autoContinueRetries = 0;
    }
    if (state.autoContinueRetries >= 5) {
      return false;
    }

    const isHostedMeeting = state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded;
    const last = parsed[parsed.length - 1];
    const hasHost = parsed.some(seg => seg.key === 'fengling');
    const nextSeg = getHostNextSegment();
    const missing = getMissingGuestKeysFromParsed(parsed);
    const hasGuestInThis =
      (parsed || []).some(seg => seg && seg.key && seg.key !== 'fengling') === true;

    const SAFETY_GUARDS = [
      '严禁复述、改写、引用之前已经说过的任何文字（哪怕一句也不能重复）。',
      '严禁假装用户已经发言或回复——用户实际尚未输入任何内容；本轮回复中不得出现"您说得对/好的/嗯/我明白了/谢谢您的回应"等承接用户回复的开场白。',
      '严禁假装嘉宾已经发过言——在嘉宾尚未以【】完整出场前，风玲就不得使用"刚才几位/前面几位/听了各位/综合诸位"等假承接语。',
      '第1、2段**不要**在两位嘉宾的段落**之间**再插入风玲的过渡，除非当前已是第3段。'
    ].join('');

    // 第1/2段：一条内最前风玲+本段全部嘉宾 已齐（由解析+名单得出）则进入下一段
    if (isHostedMeeting && hasHost && nextSeg <= 2 && missing.length === 0) {
      const hr = state.hostedRound || 0;
      if (hr < 2) {
        if (last && last.key !== 'fengling') {
          console.log(`[自动续写] 第${nextSeg}段本阶段嘉宾已齐(末为嘉宾)，自动续写进入阶段${nextSeg + 1}`);
          await pushAndContinueHostedNextStage(nextSeg, SAFETY_GUARDS);
          return true;
        }
        if (last && last.key === 'fengling' && hasGuestInThis) {
          console.log(`[自动续写] 第${nextSeg}段在嘉宾后仍有风玲尾段/末段为风玲，仍推进到阶段${nextSeg + 1}`);
          await pushAndContinueHostedNextStage(nextSeg, SAFETY_GUARDS);
          return true;
        }
      }
    }

    if (parsed.length === 0) {
      if (isHostedMeeting) {
        const hint1 =
          nextSeg <= 2
            ? '请用**全条最前**唯一【风玲】+**之后**只接各【嘉宾】；前两个阶段的同一条中**不要**在嘉宾之间插风玲。'
            : '请用【风玲】与【嘉宾名】正确标记多说话人回复。';
        state.autoContinueRetries += 1;
        state.messages.push({
          role: 'user',
          content: `[系统提示] 上轮未按【名字】格式输出发言。${hint1}${SAFETY_GUARDS}`
        });
        await generateResponse();
        return true;
      }
      return false;
    }

    if (isHostedMeeting && last && last.key !== 'fengling' && missing.length > 0) {
      const hostIntent = collectFenglingIntentFromParsed(parsed);
      const continuePrompt = buildMissingGuestsContinuePrompt(missing, nextSeg, hostIntent) + SAFETY_GUARDS;
      state.messages.push({ role: 'user', content: continuePrompt });
      await generateResponse();
      return true;
    }

    // 阶段三：最后为嘉宾、人齐 → 系统强注入【风玲】一拍，随后等用户（不判话术关键词/LLM）
    if (isHostedMeeting && last && last.key !== 'fengling' && nextSeg === 3 && missing.length === 0) {
      if (state.s3BridgeFromGuestInFlight) {
        console.log('[自动续写] 已在同链中做过「S3 嘉宾末→补风玲」，不重复强注入，等用户');
        hostFlowRequireUserTurn();
        return false;
      }
      console.log('[自动续写] 第3段末为嘉宾(人齐)，先补风玲：衔接+问继续/可否收束/总结前确认');
      state.s3BridgeFromGuestInFlight = true;
      try {
        state.messages.push({
          role: 'user',
          content:
            '[系统提示] 当前为**阶段三**，上一条在本条**最后**为**嘉宾**发言。请**只输出**一段【风玲】：自然承接**用户**（若上文中用户已插话/提问，必须点题回应）与嘉宾的交锋，' +
            '并用口语**明确问用户**：还有无补充/追问，或**是否可以结束本场主题、进入收束**（征求意见，勿无人同意就下长篇总结）。1～6 句。**不要**输出任何嘉宾段落，勿直接输出成稿式总结。' +
            SAFETY_GUARDS
        });
        await generateResponse();
      } finally {
        state.s3BridgeFromGuestInFlight = false;
      }
      hostFlowRequireUserTurn();
      state.consecutiveUserInvitePending = (state.consecutiveUserInvitePending || 0) + 1;
      return true;
    }

    if (isHostedMeeting && !hasHost) {
      const hint = nextSeg <= 2
        ? '请用**最前**唯一【风玲】+**仅随后**各【嘉宾】；第1/2段勿在嘉宾之间再插风玲。'
        : '请用【风玲】开场或收束。';
      state.messages.push({
        role: 'user',
        content: `[系统提示] 本轮未出现【风玲】段落。${hint}（1-3 句）${SAFETY_GUARDS}`
      });
      await generateResponse();
      return true;
    }

    if (last && last.key === 'fengling') {
      if (nextSeg <= 2 && missing.length > 0) {
        state.autoContinueRetries = 0;
        const hostIntentM = collectFenglingIntentFromParsed(parsed);
        const continuePrompt = buildMissingGuestsContinuePrompt(missing, nextSeg, hostIntentM) + SAFETY_GUARDS;
        state.messages.push({ role: 'user', content: continuePrompt });
        await generateResponse();
        return true;
      }
      if (nextSeg === 3) {
        state.autoContinueRetries = 0;
        hostFlowRequireUserTurn();
        console.log('[自动续写] 阶段三末为风玲，结束链式续写，等待用户');
        return false;
      }
      if (nextSeg <= 2 && missing.length === 0) {
        const hr = state.hostedRound || 0;
        if (hr < 2 && hasGuestInThis && hasHost) {
          console.log(`[自动续写] 第${nextSeg}段末为风玲、人齐(兜底) → 推进阶段${nextSeg + 1}`);
          await pushAndContinueHostedNextStage(nextSeg, SAFETY_GUARDS);
          return true;
        }
        state.autoContinueRetries = 0;
        console.log('[自动续写] 第1/2段风玲为末、不可推进，结束续写链');
        return false;
      }
    }

    state.autoContinueRetries = 0;
    return false;
  } finally {
    state.autoContinueDepth = Math.max(0, (state.autoContinueDepth || 0) - 1);
  }
}

// ========== 获取最近消息 ==========
function getRecentMessages() {
  const maxRounds = CONFIG.maxHistoryRounds;
  const maxMessages = maxRounds * 2;
  
  // 获取最近的消息
  let messages = state.messages.length <= maxMessages 
    ? state.messages 
    : state.messages.slice(-maxMessages);
  
  // 只过滤掉被用户手动删除的名人发言
  // 保留所有其他消息（包括当前在座的、风玲的、用户的）
  if (state.removedCelebrities.size === 0) {
    // 没有删除任何名人，直接返回
    return messages;
  }
  
  const result = [];
  
  for (const msg of messages) {
    // 用户消息始终保留
    if (msg.role === 'user') {
      result.push(msg);
      continue;
    }
    
    // 系统通知消息保留
    if (msg.content.startsWith('[系统通知]')) {
      result.push(msg);
      continue;
    }
    
    // 助理消息：需要检查是否包含被删除名人的发言
    if (msg.role === 'assistant') {
      const parsed = parseMultiSpeaker(msg.content);
      if (parsed.length === 0) {
        // 没有标记的消息（风玲的发言），保留
        result.push(msg);
        continue;
      }
      
      // 过滤掉被删除名人的发言段落
      const filteredSegments = parsed.filter(seg => !state.removedCelebrities.has(seg.key));
      
      if (filteredSegments.length === 0) {
        // 如果过滤后没有内容了，这条消息就不要了
        continue;
      }
      
      // 如果有段落被过滤，需要重建消息内容（创建新对象，不修改原消息）
      if (filteredSegments.length !== parsed.length) {
        // 重建消息：只保留未被删除的发言人
        let newContent = '';
        for (const seg of filteredSegments) {
          newContent += `【${seg.speaker}】${seg.text}\n\n`;
        }
        result.push({ role: 'assistant', content: newContent.trim() });
      } else {
        // 没有被过滤，直接保留原消息
        result.push(msg);
      }
    }
  }
  
  return result;
}

// ========== 名人选择面板 ==========
function buildCelebrityPanel() {
  let html = '';
  for (const domain of DOMAINS) {
    html += `<div class="domain-section" data-domain="${domain.name}">`;
    html += `<div class="domain-title">${domain.name}</div>`;
    html += '<div class="celebrity-grid">';
    for (const key of domain.members) {
      const c = CELEBRITIES[key];
      if (!c) continue;
      const initial = c.displayName.charAt(0);
      const isSelected = state.selectedCelebrities.includes(key);
      html += `
        <div class="celebrity-card ${isSelected ? 'selected' : ''}" data-key="${key}">
          <div class="card-avatar" style="background:${c.color}">${initial}</div>
          <div class="card-info">
            <span class="card-name">${c.displayName}</span>
            <span class="card-title">${c.title}</span>
          </div>
          <div class="card-check"></div>
        </div>
      `;
    }
    html += '</div></div>';
  }
  panelBody.innerHTML = html;

  // 绑定卡片点击
  panelBody.querySelectorAll('.celebrity-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.key;
      card.classList.toggle('selected');
      updatePendingSelection();
    });
  });
}

function updatePendingSelection() {
  const selected = panelBody.querySelectorAll('.celebrity-card.selected');
  const count = selected.length;
  selectedCount.textContent = `已选 ${count} 位嘉宾`;
}

function openPanel() {
  // 同步当前选中状态到面板
  panelBody.querySelectorAll('.celebrity-card').forEach(card => {
    const key = card.dataset.key;
    if (state.selectedCelebrities.includes(key)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
  updatePendingSelection();
  searchInput.value = '';
  filterCelebrities();

  celebrityPanel.classList.add('active');
  panelOverlay.classList.add('active');
}

function closePanel() {
  celebrityPanel.classList.remove('active');
  panelOverlay.classList.remove('active');
}

function confirmSelection() {
  const previousSelected = [...state.selectedCelebrities];
  const selected = [];
  panelBody.querySelectorAll('.celebrity-card.selected').forEach(card => {
    selected.push(card.dataset.key);
  });

  // 更新选中列表
  state.selectedCelebrities = selected;
  state.selectionMode = selected.length > 0 ? 'manual' : 'auto';
  state.meetingStarted = selected.length > 0;
  state.meetingEnded = false;
  state.allowExternalCelebrities = false;
  state.pendingExternalApproval = false;
  state.lastRejectedExternalNames = [];
  state.hostedRound = 0;
  state.awaitingEndConfirmation = false;
  state.summaryReady = false;
  state.autoContinueRetries = 0;
  hostFlowResetLock();
  
  // 从删除黑名单中移除当前选中的名人（用户重新邀请了）
  for (const key of selected) {
    state.removedCelebrities.delete(key);
  }
  
  updateGuestBar();
  closePanel();

  // 如果是首次选人，提示用户
  if (selected.length > 0) {
    const names = selected.map(k => CELEBRITIES[k]?.displayName).filter(Boolean).join('、');
    const previousSet = new Set(previousSelected);
    const newlyJoined = selected
      .filter(k => !previousSet.has(k))
      .map(k => CELEBRITIES[k]?.displayName)
      .filter(Boolean);

    if (newlyJoined.length > 0) {
      const joinText = newlyJoined.length === 1
        ? `${newlyJoined[0]} 已进入圆桌`
        : `${newlyJoined.join('、')} 已进入圆桌`;
      addSystemNotice(joinText);
    }

    headerSubtitle.textContent = `${selected.length} 位嘉宾就座（无主持人模式）`;
    
    // 保存嘉宾选择到数据库，供后台显示
    if (typeof logMessage === 'function') {
      logMessage('system', 'system', `邀请嘉宾：${names}`, selected.map(k => CELEBRITIES[k]?.displayName).filter(Boolean));
    }
  } else {
    headerSubtitle.textContent = '点击右侧 + 邀请嘉宾';
  }
}

function filterCelebrities() {
  const keyword = searchInput.value.trim().toLowerCase();
  panelBody.querySelectorAll('.domain-section').forEach(section => {
    let hasVisible = false;
    section.querySelectorAll('.celebrity-card').forEach(card => {
      const key = card.dataset.key;
      const c = CELEBRITIES[key];
      if (!c) { card.style.display = 'none'; return; }
      const match = !keyword ||
        c.displayName.toLowerCase().includes(keyword) ||
        c.title.toLowerCase().includes(keyword) ||
        c.name.toLowerCase().includes(keyword);
      card.style.display = match ? '' : 'none';
      if (match) hasVisible = true;
    });
    section.style.display = hasVisible ? '' : 'none';
  });
}

// ========== 嘉宾栏更新 ==========
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
const REMOVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function updateGuestBar() {
  // 主持人模式会前阶段：推荐名单未被用户确认前，不展示参会名人清单
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    guestBar.style.display = 'none';
    guestScroll.innerHTML = '';
    return;
  }

  if (state.selectedCelebrities.length === 0) {
    guestBar.style.display = 'none';
    return;
  }

  guestBar.style.display = '';
  let html = '';
  for (const key of state.selectedCelebrities) {
    const c = CELEBRITIES[key];
    if (!c) continue;
    const initial = c.displayName.charAt(0);
    html += `
      <div class="guest-chip" data-key="${key}" title="${c.displayName}">
        <div class="guest-avatar-wrap">
          <div class="guest-avatar" style="background:${c.color}">${initial}</div>
          <div class="guest-mic">${MIC_SVG}</div>
        </div>
        <span>${c.displayName}</span>
        <div class="guest-remove" data-remove="${key}">${REMOVE_SVG}</div>
      </div>
    `;
  }
  guestScroll.innerHTML = html;

  // 点击删除按钮移除嘉宾
  guestScroll.querySelectorAll('.guest-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.remove;
      const removedName = CELEBRITIES[key]?.displayName || key;
      state.selectedCelebrities = state.selectedCelebrities.filter(k => k !== key);
      
      // 加入删除黑名单，防止AI重新添加
      state.removedCelebrities.add(key);
      
      updateGuestBar();

      // 通知 AI：嘉宾变动
      const remaining = state.selectedCelebrities
        .map(k => CELEBRITIES[k]?.displayName).filter(Boolean);
      const notice = remaining.length > 0
        ? (state.selectionMode === 'manual'
          ? `[系统通知] 用户移除了嘉宾「${removedName}」。当前与会嘉宾：${remaining.join('、')}。请仅由嘉宾继续对话，不要出现主持人。`
          : `[系统通知] 用户移除了嘉宾「${removedName}」。当前与会嘉宾：${remaining.join('、')}。请风玲根据剩余嘉宾继续引导讨论，后续发言不要再包含${removedName}。`)
        : `[系统通知] 用户移除了嘉宾「${removedName}」，当前没有嘉宾。请等待用户选择新嘉宾或提出新话题。`;
      state.messages.push({ role: 'user', content: notice });

      // 聊天区显示简短提示
      addSystemNotice(`${removedName} 已离开圆桌`);

      if (state.selectedCelebrities.length === 0) {
        state.meetingStarted = false;
        state.meetingEnded = false;
        state.allowExternalCelebrities = false;
        state.pendingExternalApproval = false;
        state.lastRejectedExternalNames = [];
        state.hostedRound = 0;
        state.awaitingEndConfirmation = false;
        state.summaryReady = false;
        hostFlowResetLock();
        state.selectionMode = 'auto';
        headerSubtitle.textContent = '点击右侧 + 邀请嘉宾';
      } else {
        headerSubtitle.textContent = state.selectionMode === 'manual'
          ? `${state.selectedCelebrities.length} 位嘉宾就座（无主持人模式）`
          : `${state.selectedCelebrities.length} 位嘉宾就座`;
      }
    });
  });
}

// ========== 话筒状态更新 ==========
function setGuestSpeaking(speakerKey) {
  // 清除所有 speaking 状态
  guestScroll.querySelectorAll('.guest-chip').forEach(chip => {
    chip.classList.remove('speaking');
  });
  // 设置当前说话人
  if (speakerKey) {
    const chip = guestScroll.querySelector(`.guest-chip[data-key="${speakerKey}"]`);
    if (chip) chip.classList.add('speaking');
  }
}

function clearGuestSpeaking() {
  guestScroll.querySelectorAll('.guest-chip').forEach(chip => {
    chip.classList.remove('speaking');
  });
}

// ========== 滚动到底部（智能滚动） ==========
// 阈值：距离底部多少像素内视为"贴近底部"
const SCROLL_BOTTOM_THRESHOLD = 80;

// 用户是否主动向上滚离底部（true = 正在查看上文，不要打扰）
let userScrolledUp = false;

function isChatNearBottom() {
  if (!chatArea) return true;
  const distance = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
  return distance <= SCROLL_BOTTOM_THRESHOLD;
}

// force=true 时强制滚到底部（如用户发送消息、主动点回到底部按钮）
// force=false 时仅在用户未向上滚动时才自动滚到底部
function scrollToBottom(force) {
  const doForce = force === true;
  requestAnimationFrame(() => {
    if (!chatArea) return;
    if (doForce || !userScrolledUp) {
      chatArea.scrollTop = chatArea.scrollHeight;
      if (doForce) {
        userScrolledUp = false;
        hideScrollToBottomBtn();
      }
    } else {
      // 用户正在往上看，不打扰。若有新内容，点亮提示小红点
      markHasNewContent();
    }
  });
}

function showScrollToBottomBtn() {
  const btn = document.getElementById('scrollToBottomBtn');
  if (btn && !btn.classList.contains('show')) btn.classList.add('show');
}

function hideScrollToBottomBtn() {
  const btn = document.getElementById('scrollToBottomBtn');
  if (!btn) return;
  btn.classList.remove('show');
  btn.classList.remove('has-new');
}

function markHasNewContent() {
  const btn = document.getElementById('scrollToBottomBtn');
  if (!btn) return;
  if (!btn.classList.contains('show')) btn.classList.add('show');
  btn.classList.add('has-new');
}

// 回到顶部按钮：离顶部超过阈值就显示
const SCROLL_TOP_THRESHOLD = 200;

function showScrollToTopBtn() {
  const btn = document.getElementById('scrollToTopBtn');
  if (btn && !btn.classList.contains('show')) btn.classList.add('show');
}
function hideScrollToTopBtn() {
  const btn = document.getElementById('scrollToTopBtn');
  if (btn) btn.classList.remove('show');
}

// 初始化滚动监听（由 DOMContentLoaded 调用）
function setupChatScrollTracking() {
  if (!chatArea) return;
  let scrollTicking = false;
  chatArea.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const near = isChatNearBottom();
      userScrolledUp = !near;
      if (near) {
        hideScrollToBottomBtn();
      } else {
        showScrollToBottomBtn();
      }
      // 已向下滚离顶部一定距离时显示"回到顶部"按钮
      if (chatArea.scrollTop > SCROLL_TOP_THRESHOLD) {
        showScrollToTopBtn();
      } else {
        hideScrollToTopBtn();
      }
      scrollTicking = false;
    });
  }, { passive: true });

  // 上滑/滚轮向上：尽快标记为「在看上文」，避免流式下一帧抢滚到底
  chatArea.addEventListener('wheel', (e) => {
    if (e.deltaY < 0) userScrolledUp = true;
  }, { passive: true });

  let touchStartY = 0;
  chatArea.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t) touchStartY = t.clientY;
  }, { passive: true });
  chatArea.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!t) return;
    if (t.clientY - touchStartY > 10) userScrolledUp = true;
  }, { passive: true });

  const bottomBtn = document.getElementById('scrollToBottomBtn');
  if (bottomBtn) {
    bottomBtn.addEventListener('click', () => {
      userScrolledUp = false;
      hideScrollToBottomBtn();
      chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
    });
  }

  const topBtn = document.getElementById('scrollToTopBtn');
  if (topBtn) {
    topBtn.addEventListener('click', () => {
      hideScrollToTopBtn();
      // 用户主动点回到顶部 → 视为在查看上文，暂停自动跟随
      userScrolledUp = true;
      chatArea.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ========== 显示Toast提示 ==========
function showToast(message) {
  // 移除已存在的toast
  const existingToast = document.querySelector('.copy-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // 创建新toast
  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // 2秒后自动消失
  setTimeout(() => {
    toast.remove();
  }, 2000);
}

// ========== HTML转义 ==========
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 分享功能 ==========
function openShareModal() {
  shareLink.value = window.location.href;
  shareModal.classList.add('active');
  copyTip.classList.remove('show');
}

function closeShareModal() {
  shareModal.classList.remove('active');
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    copyTip.classList.add('show');
    setTimeout(() => copyTip.classList.remove('show'), 2000);
  } catch (e) {
    shareLink.select();
    document.execCommand('copy');
    copyTip.classList.add('show');
    setTimeout(() => copyTip.classList.remove('show'), 2000);
  }
}

// ========== 暂停/恢复 ==========
function togglePause() {
  moreMenu.classList.remove('active');
  state.isPaused = !state.isPaused;

  if (state.isPaused) {
    // 暂停：如果正在生成，中止
    if (state.isGenerating && state.abortController) {
      state.abortController.abort();
    }
    pauseBanner.classList.add('active');
    inputArea.classList.add('paused');
    menuPauseText.textContent = '恢复会议';
    // 更新暂停按钮图标为播放
    menuPauseBtn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21"/>';
    headerSubtitle.textContent = '会议已暂停';
  } else {
    pauseBanner.classList.remove('active');
    inputArea.classList.remove('paused');
    menuPauseText.textContent = '暂停会议';
    menuPauseBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    if (state.selectedCelebrities.length > 0) {
      headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾就座`;
    } else {
      headerSubtitle.textContent = '点击右侧 + 邀请嘉宾';
    }
    sendBtn.disabled = !messageInput.value.trim();
  }
}

// ========== 重新开始 ==========
function handleRestart() {
  moreMenu.classList.remove('active');

  // 没有对话内容就直接重置
  if (state.messages.length === 0) {
    doRestart();
    return;
  }

  showConfirm('重新开始', '当前对话将保存到历史记录，并开始新的会议。确定吗？', () => {
    doRestart();
  });
}

function doRestart() {
  // 保存当前会话到历史
  saveCurrentToHistory();

  // 中止生成
  if (state.isGenerating && state.abortController) {
    state.abortController.abort();
  }
  
  // 停止语音播放
  if (typeof stopSpeaking === 'function') {
    stopSpeaking();
  }

  // 重置状态
  state.messages = [];
  state.isGenerating = false;
  state.abortController = null;
  state.isPaused = false;
  state.selectionMode = 'auto';
  state.meetingStarted = false;
  state.meetingEnded = false;
  state.allowExternalCelebrities = false;
  state.pendingExternalApproval = false;
  state.lastRejectedExternalNames = [];
  state.hostedRound = 0;
  state.awaitingEndConfirmation = false;
  state.summaryReady = false;
  state.autoContinueRetries = 0;
  hostFlowResetLock();
  state.hostIntroShown = false;
  state.sessionId = Date.now().toString(36);
  state.removedCelebrities.clear(); // 清空删除黑名单
  
  // 同步更新 sessionStorage，确保新会议使用新的 sessionId
  sessionStorage.setItem('roundtable_session_id', state.sessionId);
  console.log('✅ 新建会议，新 session_id:', state.sessionId);

  // 重置UI
  pauseBanner.classList.remove('active');
  inputArea.classList.remove('paused');
  menuPauseText.textContent = '暂停会议';
  menuPauseBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

  // 清空聊天区
  chatArea.innerHTML = '';
  clearStreamMessages();

  // 清空嘉宾选择，完全从头开始
  state.selectedCelebrities = [];
  state.pendingSelection = [];
  guestBar.style.display = 'none';
  guestScroll.innerHTML = '';
  headerSubtitle.textContent = '点击 + 邀请嘉宾';
  
  // 重置嘉宾面板的勾选状态
  buildCelebrityPanel();

  // 重新显示 slogan 和欢迎语
  const randomSlogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
  addSpeakerMessage('风玲', randomSlogan, 'fengling');
  
  setTimeout(() => {
    addSpeakerMessage('风玲', WELCOME_MESSAGE, 'fengling');
    state.hostIntroShown = true;
  }, 800);

  if (state.selectedCelebrities.length > 0) {
    headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾就座`;
  } else {
    headerSubtitle.textContent = '点击右侧 + 邀请嘉宾';
  }

  messageInput.value = '';
  sendBtn.disabled = true;
  messageInput.focus();
}

// ========== 历史会议存储 ==========
const HISTORY_KEY = 'roundtable_history';
const MAX_HISTORY = 50;

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch (e) {
    // localStorage 满了，清理最旧的
    list.splice(MAX_HISTORY / 2);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
  }
}

function saveCurrentToHistory() {
  // 过滤掉系统通知，只保留真正的对话消息
  const conversationMessages = state.messages.filter(msg => {
    // 保留用户消息
    if (msg.role === 'user' && !msg.content.startsWith('[系统通知]')) {
      return true;
    }
    // 保留AI回复
    if (msg.role === 'assistant') {
      return true;
    }
    return false;
  });
  
  // 如果没有真正的对话内容，不保存
  if (conversationMessages.length === 0) return;
  
  // 至少要有一轮完整的对话（用户+AI）才保存
  const hasUserMessage = conversationMessages.some(m => m.role === 'user');
  const hasAIMessage = conversationMessages.some(m => m.role === 'assistant');
  if (!hasUserMessage || !hasAIMessage) return;

  const firstUserMsg = conversationMessages.find(m => m.role === 'user');
  const topic = firstUserMsg ? firstUserMsg.content.slice(0, 80) : '未命名会议';

  const session = {
    id: state.sessionId,
    timestamp: Date.now(),
    topic,
    celebrities: [...state.selectedCelebrities],
    messages: conversationMessages.map(m => ({ role: m.role, content: m.content })),
  };

  const list = getHistory();
  // 去重：如果相同sessionId已存在就覆盖
  const idx = list.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    list[idx] = session;
  } else {
    list.unshift(session);
  }
  saveHistory(list);
}

// ========== 历史面板 ==========
function openHistoryPanel() {
  moreMenu.classList.remove('active');

  // 先保存当前会话（如果有内容）
  if (state.messages.length > 0) {
    saveCurrentToHistory();
  }

  renderHistoryList();
  historyPanel.classList.add('active');
  panelOverlay.classList.add('active');
}

function closeHistoryPanel() {
  historyPanel.classList.remove('active');
  panelOverlay.classList.remove('active');
}

function handleNewMeeting() {
  moreMenu.classList.remove('active');
  closeHistoryPanel();
  
  // 没有对话内容就直接重置
  if (state.messages.length === 0) {
    doRestart();
    return;
  }
  
  showConfirm('新建会议', '当前对话将保存到历史记录，并开始新的会议。确定吗？', () => {
    doRestart();
  });
}

function renderHistoryList() {
  const list = getHistory();

  if (list.length === 0) {
    historyList.innerHTML = `
      <div class="history-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>暂无历史会议记录</span>
      </div>`;
    return;
  }

  let html = '';
  for (const session of list) {
    const date = formatTime(session.timestamp);
    const guestCount = session.celebrities?.length || 0;
    const msgCount = session.messages?.length || 0;
    html += `
      <div class="history-item" data-id="${session.id}">
        <div class="history-item-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="history-item-body">
          <div class="history-item-topic">${escapeHtml(session.topic)}</div>
          <div class="history-item-meta">
            <span>${date}</span>
            <span>${guestCount} 位嘉宾</span>
            <span>${msgCount} 条消息</span>
          </div>
        </div>
        <div class="history-item-actions">
          <button class="history-delete-btn" data-id="${session.id}" title="删除">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
          <div class="history-item-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </div>`;
  }
  historyList.innerHTML = html;

  // 绑定点击查看详情
  historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // 如果点击的是删除按钮，不打开详情
      if (e.target.closest('.history-delete-btn')) return;
      
      const session = list.find(s => s.id === item.dataset.id);
      if (session) openHistoryDetail(session);
    });
  });
  
  // 绑定删除按钮
  historyList.querySelectorAll('.history-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.id;
      deleteHistorySession(sessionId, list);
    });
  });
}

// ========== 删除历史会议 ==========
function deleteHistorySession(sessionId, list) {
  showConfirm('删除会议记录', '确定要删除这条会议记录吗？此操作不可恢复。', () => {
    const newList = list.filter(s => s.id !== sessionId);
    saveHistory(newList);
    renderHistoryList();
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const pad = n => String(n).padStart(2, '0');
  if (isToday) {
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ========== 历史详情 ==========
function openHistoryDetail(session) {
  closeHistoryPanel();

  historyDetailTitle.textContent = session.topic;
  historyDetailTime.textContent = formatTime(session.timestamp);

  // 嘉宾标签
  let guestHtml = '';
  for (const key of (session.celebrities || [])) {
    const c = CELEBRITIES[key];
    if (!c) continue;
    guestHtml += `
      <div class="history-guest-tag">
        <div class="mini-avatar" style="background:${c.color}">${c.displayName.charAt(0)}</div>
        <span>${c.displayName}</span>
      </div>`;
  }
  historyDetailGuests.innerHTML = guestHtml;
  historyDetailGuests.style.display = guestHtml ? '' : 'none';

  // 消息列表（复用消息渲染）
  historyDetailBody.innerHTML = '';
  for (const msg of (session.messages || [])) {
    if (msg.role === 'user') {
      const div = document.createElement('div');
      div.className = 'message user';
      div.innerHTML = `<div class="message-content"><div class="message-bubble">${escapeHtml(msg.content)}</div></div>`;
      historyDetailBody.appendChild(div);
    } else {
      // 解析多角色
      const parsed = parseMultiSpeaker(msg.content);
      if (parsed.length === 0) {
        appendHistoryMsg('风玲', msg.content.trim(), 'fengling');
      } else {
        for (const seg of parsed) {
          if (seg.text.trim()) {
            appendHistoryMsg(seg.speaker, seg.text.trim(), seg.key);
          }
        }
      }
    }
  }

  historyDetail.classList.add('active');
}

function appendHistoryMsg(speakerName, content, celebrityKey) {
  const info = getCelebrityInfo(speakerName, celebrityKey);
  const isFengling = (speakerName === '风玲' || celebrityKey === 'fengling');
  const avatarContent = isFengling ? FENGLING_AVATAR : speakerName.charAt(0);
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="message-avatar" style="background:${isFengling ? 'transparent' : info.color}">${avatarContent}</div>
    <div class="message-content">
      <div class="message-name" style="color:${info.color}">${speakerName}</div>
      <div class="message-bubble">${formatMessageContent(content)}</div>
    </div>`;
  historyDetailBody.appendChild(div);
}

function closeHistoryDetail() {
  historyDetail.classList.remove('active');
}

// ========== 确认对话框 ==========
let confirmCallback = null;

function showConfirm(title, msg, onOk) {
  confirmTitle.textContent = title;
  confirmMsg.textContent = msg;
  confirmCallback = onOk;
  confirmOverlay.classList.add('active');
}

function closeConfirm() {
  confirmOverlay.classList.remove('active');
  confirmCallback = null;
}

// confirmOk 点击在 init 之后的事件中绑定
function handleConfirmOk() {
  if (confirmCallback) confirmCallback();
  closeConfirm();
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', () => {
  init();
  confirmOk.addEventListener('click', handleConfirmOk);
  setupChatScrollTracking();
});
