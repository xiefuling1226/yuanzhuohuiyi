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

// ========== 应用状态 ==========
const state = {
  messages: [],              // { role: 'user'|'assistant', content: string }
  selectedCelebrities: [],   // 已选参会人员 key 列表
  pendingSelection: [],      // 面板中临时勾选的参会人员
  selectionMode: 'auto',     // auto=主持人模式, manual=无主持人模式
  meetingFlowMode: CONFIG.meetingFlowMode || CONFIG.defaultMeetingFlowMode || 'three-round', // 主持型会议流程模式
  meetingStarted: false,     // 主持人模式下是否已确认开始
  meetingEnded: false,       // 主持人模式下是否已结束并总结
  allowExternalCelebrities: false, // 是否允许推荐名人库之外人员（需用户确认）
  pendingExternalApproval: false,  // 是否正在等待用户确认“库外推荐”授权
  lastRejectedExternalNames: [],   // 最近一轮被拦截的“非真实名人名”候选
  hostedRound: 0,            // 主持人模式已完成轮次（正式会议阶段）
  hostedStage: 'round1',     // 主持型三轮模式当前阶段：round1/round2/round3/user-interaction/ended
  round1CompletedKeys: [],   // 第一轮已完成发言的嘉宾
  round2CompletedKeys: [],   // 第二轮已完成深化发言的嘉宾
  awaitingEndConfirmation: false, // 主持人已发起收尾确认，等待用户确认是否结束
  awaitingUserPerspective: false, // 第三轮后主持人已邀请用户参与，等待用户回复
  summaryReady: false,       // 用户已确认结束，下一轮应输出会议总结
  userParticipationCount: 0, // 用户在第三轮后的互动次数
  autoContinueRetries: 0,    // 自动续写重试次数，防止死循环
  recentHostUtterances: [],  // 最近若干条主持人发言（normalized 文本），用于跨条复读检测
  consecutiveUserInvitePending: 0, // 主持人连续邀请用户但用户未回复的次数
  hostIntroShown: false,     // 风玲开场自我介绍是否已展示
  isGenerating: false,
  abortController: null,
  isPaused: false,           // 会议是否暂停
  sessionId: Date.now().toString(36), // 当前会话ID
  removedCelebrities: new Set(), // 用户手动删除的参会人员 key 集合（防止重新添加）
};

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

function persistAppSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('设置持久化失败:', key, error);
  }
}

function getFreeModelOption(value = CONFIG.model) {
  return (CONFIG.freeModelOptions || []).find(item => item.value === value) || null;
}

function getHostedMeetingModeOption(value = state.meetingFlowMode) {
  return (CONFIG.hostedMeetingModeOptions || []).find(item => item.value === value) || null;
}

function getModelDisplayName(value = CONFIG.model) {
  return getFreeModelOption(value)?.label || value || '';
}

function getHostedMeetingModeLabel(value = state.meetingFlowMode) {
  return getHostedMeetingModeOption(value)?.label || '三轮会谈模式';
}

function getHostedRoundLimit(mode = state.meetingFlowMode) {
  return mode === 'host-relay' ? 5 : 3;
}

function getDefaultHostedStage() {
  return 'round1';
}

function resetHostedMeetingProgress(options = {}) {
  const { ended = false } = options;
  state.hostedRound = 0;
  state.hostedStage = ended ? 'ended' : getDefaultHostedStage();
  state.round1CompletedKeys = [];
  state.round2CompletedKeys = [];
  state.awaitingEndConfirmation = false;
  state.awaitingUserPerspective = false;
  state.summaryReady = false;
  state.userParticipationCount = 0;
}

function restartHostedConversationContext(latestUserText) {
  state.messages = latestUserText
    ? [{ role: 'user', content: latestUserText }]
    : [];
  state.recentHostUtterances = [];
  state.consecutiveUserInvitePending = 0;
}

function markHostedMeetingEnded() {
  state.meetingEnded = true;
  state.hostedStage = 'ended';
  state.awaitingEndConfirmation = false;
  state.awaitingUserPerspective = false;
  state.summaryReady = false;
}

function mergeUniqueKeys(existing, incoming) {
  const merged = Array.isArray(existing) ? [...existing] : [];
  for (const key of incoming || []) {
    if (!key || merged.includes(key)) continue;
    merged.push(key);
  }
  return merged;
}

function getRemainingHostedGuestKeys(completedKeys = []) {
  const completed = new Set(completedKeys);
  return state.selectedCelebrities.filter(key => !completed.has(key));
}

function setActiveModel(model, options = {}) {
  const { persist = true } = options;
  if (!(CONFIG.freeModelOptions || []).some(item => item.value === model)) return;
  CONFIG.model = model;
  if (persist) {
    persistAppSetting(CONFIG.storageKeys.model, model);
  }
  syncSettingsSummaryLabels();
}

function setActiveMeetingFlowMode(mode, options = {}) {
  const { persist = true } = options;
  if (!(CONFIG.hostedMeetingModeOptions || []).some(item => item.value === mode)) return;
  state.meetingFlowMode = mode;
  CONFIG.meetingFlowMode = mode;
  if (persist) {
    persistAppSetting(CONFIG.storageKeys.meetingFlowMode, mode);
  }
  syncSettingsSummaryLabels();
}

function syncSettingsSummaryLabels() {
  const modelLabel = document.getElementById('currentModelText');
  const modeLabel = document.getElementById('currentMeetingModeText');
  if (modelLabel) modelLabel.textContent = getModelDisplayName();
  if (modeLabel) modeLabel.textContent = getHostedMeetingModeLabel();
}

function buildSettingsOptionHtml(name, option, currentValue) {
  const checked = option.value === currentValue ? 'checked' : '';
  return `
    <label class="settings-option">
      <input type="radio" name="${name}" value="${option.value}" ${checked}>
      <div class="settings-option-body">
        <div class="settings-option-title">${option.label}</div>
        <div class="settings-option-desc">${option.description}</div>
      </div>
    </label>
  `;
}

function renderSettingsOptions() {
  if (!settingsModelList || !settingsModeList) return;
  settingsModelList.innerHTML = (CONFIG.freeModelOptions || [])
    .map(option => buildSettingsOptionHtml('modelOption', option, CONFIG.model))
    .join('');
  settingsModeList.innerHTML = (CONFIG.hostedMeetingModeOptions || [])
    .map(option => buildSettingsOptionHtml('meetingModeOption', option, state.meetingFlowMode))
    .join('');
  const modeScopeHint = document.getElementById('modeScopeHint');
  if (modeScopeHint) {
    modeScopeHint.textContent = state.selectionMode === 'manual'
      ? '你当前处于手动点选嘉宾模式，这里的会议模式会在下一次主持人主导会议时生效。'
      : '该设置在主持人主导会议时生效；手动点选嘉宾的一对一/自由对话模式保持原有行为。';
  }
  syncSettingsSummaryLabels();
}

function openSettingsModal() {
  moreMenu.classList.remove('active');
  renderSettingsOptions();
  settingsModal.classList.add('active');
}

function closeSettingsModal() {
  settingsModal.classList.remove('active');
}

function applySettings() {
  const selectedModel = settingsModelList?.querySelector('input[name="modelOption"]:checked')?.value || CONFIG.model;
  const selectedMeetingMode = settingsModeList?.querySelector('input[name="meetingModeOption"]:checked')?.value || state.meetingFlowMode;
  const modelChanged = selectedModel !== CONFIG.model;
  const modeChanged = selectedMeetingMode !== state.meetingFlowMode;

  setActiveModel(selectedModel);
  setActiveMeetingFlowMode(selectedMeetingMode);
  closeSettingsModal();

  if (!modelChanged && !modeChanged) return;

  const changeNotes = [];
  if (modelChanged) {
    changeNotes.push(`模型已切换为 ${getModelDisplayName(selectedModel)}`);
  }
  if (modeChanged) {
    changeNotes.push(`会议模式已切换为 ${getHostedMeetingModeLabel(selectedMeetingMode)}`);
    if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
      state.messages.push({
        role: 'system',
        content: `[系统通知] 用户刚刚将主持型会议模式切换为「${getHostedMeetingModeLabel(selectedMeetingMode)}」。请从下一次回复开始按新模式推进，保持本场嘉宾名单不变。`
      });
    }
  }
  addSystemNotice(changeNotes.join('，'));
}

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
  const keys = [];
  const seen = new Set();
  const rejected = [];

  // 第一轮：从【名字】标记提取
  const regex = /【([^】]{1,20})】/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
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
      if (content.includes(name)) {
        seen.add(key);
        keys.push(key);
      }
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
  resetHostedMeetingProgress();
  state.autoContinueRetries = 0;
  // 主持人模式：用户确认开始后才展示参会名人清单
  updateGuestBar();
  headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾已确认，${getHostedMeetingModeLabel()}进行中`;
  state.messages.push({
    role: 'system',
    content: `[系统通知] 用户已确认当前嘉宾名单，主持型会议正式开始。本场采用「${getHostedMeetingModeLabel()}」。请按该模式进入首轮讨论。`
  });
}

function isAffirmativeEndReply(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /(可以结束|结束吧|就到这|到这吧|可以总结|总结吧|收尾吧|确认结束|结束会议|好，结束|同意结束|可以收尾|行，结束|可以了)/.test(t);
}

function isNegativeEndReply(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /(继续|继续聊|继续讨论|不要结束|先别结束|不结束|再聊|再深入|还没结束)/.test(t);
}

function detectHostEndConfirmationPrompt(content) {
  const text = String(content || '');
  return /是否可以结束|要不要结束|是否结束|可以结束会议吗|要我做总结|继续深入讨论，还是我来做个总结|是否先告一段落|是否就此结束|如果可以的话我来总结|这场会谈是否可以结束/.test(text);
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

function detectHostUserPerspectivePrompt(content) {
  const text = String(content || '');
  if (!text || detectHostEndConfirmationPrompt(text)) return false;
  return /你怎么看|你的看法|你更倾向|你最认同|你会怎么选|你最想追问谁|你想先听谁展开|你愿意先谈谈|你想从哪一点继续|你最在意哪一点/.test(text);
}

function extractSpokenSelectedGuestKeysFromContent(content) {
  const parsed = parseMultiSpeaker(String(content || ''), false);
  return [...new Set(
    parsed
      .map(seg => seg.key)
      .filter(key => key && key !== 'fengling' && state.selectedCelebrities.includes(key))
  )];
}

function canSummarizeCurrentHostedMeeting() {
  if (state.selectionMode !== 'auto' || !state.meetingStarted || state.meetingEnded) return false;
  if (state.meetingFlowMode !== 'three-round') {
    return state.hostedRound >= 3 || state.awaitingEndConfirmation || state.userParticipationCount > 0;
  }
  return state.hostedStage === 'user-interaction'
    || state.awaitingEndConfirmation
    || state.userParticipationCount > 0;
}

function recordHostedAssistantTurn(content) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted || state.meetingEnded) return;

  if (detectMeetingSummary(content) && state.summaryReady) {
    markHostedMeetingEnded();
    return;
  }

  if (state.meetingFlowMode !== 'three-round') {
    state.hostedRound = Math.min(getHostedRoundLimit(), state.hostedRound + 1);
    if (detectHostEndConfirmationPrompt(content)) {
      state.awaitingEndConfirmation = true;
      state.awaitingUserPerspective = false;
      state.summaryReady = false;
    }
    return;
  }

  const spokenGuestKeys = extractSpokenSelectedGuestKeysFromContent(content);
  const askedUserPerspective = detectHostUserPerspectivePrompt(content);
  const askedEndConfirmation = detectHostEndConfirmationPrompt(content);
  const stageBefore = state.hostedStage;
  const canOpenUserInteraction = stageBefore === 'round3' || stageBefore === 'user-interaction' || state.hostedRound >= 3;

  if (stageBefore === 'round1') {
    state.round1CompletedKeys = mergeUniqueKeys(state.round1CompletedKeys, spokenGuestKeys);
    if (state.selectedCelebrities.length > 0 && getRemainingHostedGuestKeys(state.round1CompletedKeys).length === 0) {
      state.hostedStage = 'round2';
      state.hostedRound = Math.max(state.hostedRound, 1);
    }
  } else if (stageBefore === 'round2') {
    state.round2CompletedKeys = mergeUniqueKeys(state.round2CompletedKeys, spokenGuestKeys);
    if (state.selectedCelebrities.length > 0 && getRemainingHostedGuestKeys(state.round2CompletedKeys).length === 0) {
      state.hostedStage = 'round3';
      state.hostedRound = Math.max(state.hostedRound, 2);
    }
  } else if (stageBefore === 'round3' || stageBefore === 'user-interaction') {
    state.hostedRound = Math.max(state.hostedRound, 3);
  }

  if (askedUserPerspective && canOpenUserInteraction) {
    state.hostedStage = 'user-interaction';
    state.awaitingUserPerspective = true;
    state.awaitingEndConfirmation = false;
  }

  if (askedEndConfirmation && canOpenUserInteraction) {
    state.hostedStage = 'user-interaction';
    state.awaitingEndConfirmation = true;
    state.awaitingUserPerspective = false;
    state.summaryReady = false;
  }
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

function isLikelyNewMeetingRequest(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /(换一[组批波]|重新推荐|再推荐|换.*嘉宾|换.*名人|新.*话题|换个话题|重新开始|新的讨论|再开一场|开个新.*会|讨论.*新.*问题|聊.*别的|另一个问题|再问一个问题|再聊个问题|换个议题)/.test(t);
}

function detectHostedUserIntent(text) {
  const raw = String(text || '').trim();
  const mentioned = extractMentionedSelectedCelebrities(raw);

  if (isLikelyNewMeetingRequest(raw)) {
    return { type: 'new-topic', mentioned };
  }

  if (isAffirmativeEndReply(raw) || /(总结一下|总结吧|收个尾|做个总结|结束讨论|到这里吧)/.test(raw)) {
    return { type: 'end', mentioned };
  }

  if (mentioned.length > 0 && (/[？?]/.test(raw) || /(怎么看|怎么想|评价|点评|回应|反驳|补充|展开|谈谈|说说|分析|聊聊|解释|继续|具体|比较|分歧)/.test(raw))) {
    return { type: 'targeted-guests', mentioned };
  }

  if (/(继续|深入|细化|展开|具体|案例|落地|怎么做|怎么办|进一步|延展|详细|说透|多讲讲|再谈谈|再展开)/.test(raw)) {
    return { type: 'deepen', mentioned };
  }

  if (/(我觉得|我认为|我更倾向|我更认同|听下来|总结一下|我的看法|我比较赞同|我倾向于|在我看来)/.test(raw)) {
    return { type: 'user-opinion', mentioned };
  }

  return { type: 'general', mentioned };
}

function buildHostedUserIntentDirective(userText) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted || state.meetingEnded) return null;
  const intent = detectHostedUserIntent(userText);
  const mentionedNames = (intent.mentioned || [])
    .map(key => CELEBRITIES[key]?.displayName)
    .filter(Boolean);

  if (intent.type === 'targeted-guests' && mentionedNames.length > 0) {
    return `[系统通知] 主持型会议用户互动阶段：用户刚刚重点点名了${mentionedNames.map(name => `【${name}】`).join('、')}。请优先由这些嘉宾直接回应用户；若有必要，可由【风玲】用1-2句做自然串场，其他嘉宾只做简短补充。`;
  }

  if (intent.type === 'deepen') {
    if (mentionedNames.length > 0) {
      return `[系统通知] 主持型会议用户互动阶段：用户希望继续细化刚才的话题。请由【风玲】先提炼用户追问的焦点，再优先邀请${mentionedNames.map(name => `【${name}】`).join('、')}继续展开；必要时可补充1位最相关嘉宾，但不要直接总结。`;
    }
    return '[系统通知] 主持型会议用户互动阶段：用户希望继续细化当前议题。请由【风玲】先概括用户真正关心的焦点，再邀请2-3位最相关嘉宾围绕该焦点继续展开，不要直接总结。';
  }

  if (intent.type === 'user-opinion') {
    return '[系统通知] 主持型会议用户互动阶段：用户刚刚表达了自己的判断或倾向。请让1-2位最相关嘉宾直接回应用户观点，可支持、补充或提出张力点；随后由【风玲】做简短收束，并根据讨论充分度决定是否继续追问。';
  }

  if (intent.type === 'general') {
    return '[系统通知] 主持型会议用户互动阶段：用户已经参与了讨论。请先回应用户刚才的观点或问题，再由【风玲】自然衔接到最相关的嘉宾发言，不要跳过用户。';
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

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1]); } catch (_) {}
  }

  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj && obj[0]) {
    try { return JSON.parse(obj[0]); } catch (_) {}
  }
  return null;
}

const hostIntentCache = new Map();
const HOST_INTENT_CACHE_MAX = 60;
const HOST_INTENT_TIMEOUT_MS = 2200;

async function classifyHostIntentByLLM(hostText) {
  const participants = state.selectedCelebrities
    .map(k => CELEBRITIES[k]?.displayName)
    .filter(Boolean);
  if (!hostText || participants.length === 0) return null;

  const cacheKey = `${participants.join('|')}::${String(hostText).trim()}`;
  if (hostIntentCache.has(cacheKey)) {
    return hostIntentCache.get(cacheKey);
  }

  try {
    const response = await fetch(CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: [
              '你是圆桌会议主持人话术的意图分类器。判断主持人这段话的目标对象。',
              '类别：',
              '1) guest_invite —— 主持人面向某位"在场嘉宾"邀请发言/提问。',
              '   典型特征：句中明确出现某位在场嘉宾的姓名/称呼（如"鲁迅先生"、"老子"、"庄子先生"），并向其抛出问题或请其继续发言。',
              '   注意：当文本里出现嘉宾姓名 + "您/你"时，"您"指的是这位嘉宾本人，不是用户/听众，应判 guest_invite。',
              '2) user_invite —— 主持人面向"用户/听众/观众/朋友们/各位"邀请发言。',
              '   典型特征：没有点任何一位在场嘉宾的姓名，转而问"您怎么看 / 您的观点 / 大家觉得 / 朋友们 / 各位 / 听众"等开放式提问。',
              '   只有不指向任何在场嘉宾时，才可判 user_invite。',
              '3) none —— 主持人只是陈述/铺垫/收束，没有明确把话头交给任何一方。',
              '识别优先级：只要句中包含任一在场嘉宾姓名，并出现求问、求观点、请发言的语气，必须判 guest_invite，不允许判 user_invite。',
              '严禁把"鲁迅先生，您是否..."、"老子先生，您怎么看..."这类句子判为 user_invite。',
              '严禁把"X先生"中的 X 误读成"先生"两字然后忽略嘉宾姓名。',
              '只输出 JSON：{"intent":"guest_invite|user_invite|none","targets":["被邀请的在场嘉宾姓名"],"confidence":0-1}。',
              'targets 只能从给定在场嘉宾里取；user_invite 时 targets 必须为空。'
            ].join('\n')
          },
          {
            role: 'user',
            content: `在场嘉宾：${participants.join('、')}\n主持人文本：${hostText}`
          }
        ]
      }),
      signal: AbortSignal.timeout(HOST_INTENT_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed !== 'object') return null;

    const intent = ['guest_invite', 'user_invite', 'none'].includes(parsed.intent) ? parsed.intent : 'none';
    const targets = Array.isArray(parsed.targets)
      ? parsed.targets.filter(n => participants.includes(String(n)))
      : [];
    const confidence = Number(parsed.confidence);

    const result = {
      intent,
      targets,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    };
    hostIntentCache.set(cacheKey, result);
    if (hostIntentCache.size > HOST_INTENT_CACHE_MAX) {
      const oldest = hostIntentCache.keys().next().value;
      if (oldest) hostIntentCache.delete(oldest);
    }
    return result;
  } catch (_) {
    return null;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 按中英文句末标点切分句子
function splitIntoSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?；;\n])\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 判断某一单句是邀请"嘉宾"还是"用户"，无法识别则返回 'none'
function classifyInviteSentence(sentence) {
  const s = String(sentence || '');
  if (!s) return { kind: 'none' };
  const names = state.selectedCelebrities
    .map(k => CELEBRITIES[k]?.displayName)
    .filter(Boolean);

  const guestsInSentence = names.filter(n => s.includes(n));
  const hasQuestion = /[？?]/.test(s);
  const hasGuestInviteCue = /(请|想请|希望|听听|分享|谈谈|说说|聊聊|继续|补充|回应|回答|怎么看|觉得|的看法|的观点|的想法|展开说说|就此.*说)/.test(s);

  // 句子里出现了在场嘉宾姓名 + 邀请/疑问语气 → 邀请嘉宾
  if (guestsInSentence.length > 0 && (hasQuestion || hasGuestInviteCue)) {
    return { kind: 'guest', guests: guestsInSentence };
  }

  // 邀请用户的强特征（无论有无嘉宾名都优先识别这种明确指向观众/听众的语气）
  const strongUserCue =
    /(在座的您|在座的你|(请问|想请问|我想请问|请教|冒昧|顺便)\s*(在座的)?[您你]|(您|你)\s*来\s*(说说|谈谈|分享|回答)|大家(怎么看|觉得|认为|有.*看法)|各位朋友|朋友们|观众|听众|诸位朋友|各位(听众|朋友|观众))/;
  if (strongUserCue.test(s)) {
    return { kind: 'user' };
  }

  // 句子里没有任何嘉宾名，而带有"您/你"问句 → 邀请用户
  if (guestsInSentence.length === 0 && hasQuestion && /[您你]/.test(s)) {
    // 避免误伤"您是否希望进入总结环节"这类主持人对用户的确认问句——其实也是邀请用户
    return { kind: 'user' };
  }

  return { kind: 'none' };
}

// 启发式综合判定：整段主持人话术的邀请意图
// 原则：**任一句识别为 user_invite → 整段 user_invite**（因为必须停下等用户）
// 否则若任一句识别为 guest_invite → 整段 guest_invite
// 都没有 → null（交给 LLM 或默认 none）
function classifyHostIntentHeuristic(text) {
  const sents = splitIntoSentences(text);
  if (sents.length === 0) return null;
  const results = sents.map(classifyInviteSentence);

  if (results.some(r => r.kind === 'user')) {
    return { intent: 'user_invite', targets: [], confidence: 0.9 };
  }
  const guestsAll = [];
  for (const r of results) {
    if (r.kind === 'guest' && Array.isArray(r.guests)) {
      for (const g of r.guests) if (!guestsAll.includes(g)) guestsAll.push(g);
    }
  }
  if (guestsAll.length > 0) {
    return { intent: 'guest_invite', targets: guestsAll, confidence: 0.9 };
  }
  return null;
}

// 旧 API 保留：仅在会议中启发式兜底时会用到"整段是否点了嘉宾名"
function detectExplicitlyAddressedGuests(hostText) {
  const heur = classifyHostIntentHeuristic(hostText);
  return heur && heur.intent === 'guest_invite' ? heur.targets : [];
}

async function decideHostFollowUpIntent(hostText) {
  // 句子级启发式：user_invite 优先；guest_invite 次之
  const heur = classifyHostIntentHeuristic(hostText);
  if (heur) return heur;

  // 启发式无结果 → 交 LLM
  const llm = await classifyHostIntentByLLM(hostText);
  if (llm && llm.intent !== 'none' && llm.confidence >= 0.5) {
    // LLM 判 user_invite 但 targets 非空，校正为 guest_invite
    if (llm.intent === 'user_invite' && Array.isArray(llm.targets) && llm.targets.length > 0) {
      return { intent: 'guest_invite', targets: llm.targets, confidence: llm.confidence };
    }
    return llm;
  }
  return { intent: 'none', targets: [], confidence: (llm && llm.confidence) || 0 };
}

function buildGuestFollowUpPrompt(hostText, targets = []) {
  const mentionedTargets = (targets && targets.length > 0)
    ? targets
    : extractMentionedSelectedCelebrities(hostText)
        .map(k => CELEBRITIES[k]?.displayName)
        .filter(Boolean);

  const targetText = mentionedTargets.length > 0
    ? `请优先由以下嘉宾依次发言：${mentionedTargets.join('、')}。`
    : '请从在场嘉宾中选择与主持人刚才问题最匹配的2-3位嘉宾依次发言。';

  return `[系统提示] 主持人已将话题交给嘉宾继续讨论。请直接续写嘉宾发言（使用【嘉宾名字】格式）。${targetText} 若观点尚未充分，可再补充1位嘉宾短回应；最后由风玲做简短收束并引导下一轮。`;
}

// ========== 主持人话术意图识别（LLM 优先，关键词仅作超时/失败兜底） ==========
// 判断一段主持人文本是否是"邀请用户发言"
// 完全依赖 LLM：先查缓存（classifyHostIntentByLLM 内置缓存），
// LLM 返回 user_invite 且置信度 >= 0.5 视为邀请用户。
// LLM 不可用时，使用极简兜底（仅防流程彻底卡住）。
async function isHostInvitingUser(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  // 启发式硬否决：只要文本里"明确点名"了在场嘉宾，绝不算邀请用户（"鲁迅先生，您..."这类一律放行）
  if (detectExplicitlyAddressedGuests(t).length > 0) {
    return false;
  }

  try {
    const llm = await classifyHostIntentByLLM(t);
    if (llm && llm.intent === 'user_invite' && llm.confidence >= 0.5) {
      // 即便 LLM 判了 user_invite，targets 非空说明其实点了嘉宾名
      if (Array.isArray(llm.targets) && llm.targets.length > 0) return false;
      return true;
    }
    if (llm) return false;
  } catch (_) {}

  // 极简兜底：LLM 超时/异常时，才使用有限关键词避免流程彻底卡死
  return /[你您](怎么看|觉得|的看法|的观点|的想法)|听听[你您]|请[你您](分享|说说|谈谈)/.test(t);
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

function buildHostOpeningForTopic(topic) {
  const t = String(topic || '').trim();
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

  // 优先保留模型的自然回复，避免会前阶段被强模板化
  if (rawText) {
    const hasStartPrompt = /开始会议|是否开始|要不要开始|是否满意|增删|替换/.test(rawText);
    const hasAtLeastTwoGuests = names.length >= 2;
    if (hasAtLeastTwoGuests && hasStartPrompt) {
      return beautifyHostContent(rawText);
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

  if (!state.allowExternalCelebrities) {
    state.pendingExternalApproval = true;
    return `${topicLine}\n\n我在当前名人库里，暂时还没拼出足够贴题的一组嘉宾。\n你希望我可以补充推荐名人库之外的人选吗？你也可以直接告诉我想邀请谁，我按你的指定来组局。`;
  }

  return `${topicLine}\n\n我正在为你补充筛选更贴题的嘉宾组合。你也可以直接点名希望邀请的人，我会优先纳入推荐。`;
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
const menuSettingsBtn = document.getElementById('menuSettingsBtn');
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
// 设置
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsCancelBtn = document.getElementById('settingsCancelBtn');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const settingsModelList = document.getElementById('settingsModelList');
const settingsModeList = document.getElementById('settingsModeList');
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
  setActiveModel(CONFIG.model, { persist: false });
  setActiveMeetingFlowMode(state.meetingFlowMode, { persist: false });
  
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
  renderSettingsOptions();
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
  menuSettingsBtn.addEventListener('click', openSettingsModal);
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

  // 设置
  closeSettingsBtn.addEventListener('click', closeSettingsModal);
  settingsCancelBtn.addEventListener('click', closeSettingsModal);
  settingsSaveBtn.addEventListener('click', applySettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
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

// ========== 发送消息 ==========
async function handleSend() {
  const text = messageInput.value.trim();
  if (!text || state.isGenerating || state.isPaused) return;

  messageInput.value = '';
  autoResizeTextarea();
  sendBtn.disabled = true;

  addUserMessage(text);
  state.messages.push({ role: 'user', content: text });
  state.autoContinueRetries = 0;
  state.autoContinueDepth = 0;
  // 用户回复了：清掉"邀请用户挂起计数"和"主持人发言历史去重池"
  state.consecutiveUserInvitePending = 0;
  state.recentHostUtterances = [];

  // 主持人模式：会议已结束后，用户要求换话题/换嘉宾/重新开始 → 重置为会前状态
  if (state.selectionMode === 'auto' && state.meetingEnded) {
    const wantsNewMeeting = isLikelyNewMeetingRequest(text);
    const wantsNewGuests = /(重新推荐|再推荐|换.*嘉宾|换.*名人)/.test(text);
    if (wantsNewMeeting) {
      state.meetingEnded = false;
      state.autoContinueRetries = 0;
      if (wantsNewGuests || state.selectedCelebrities.length === 0) {
        restartHostedConversationContext(text);
        state.meetingStarted = false;
        state.selectedCelebrities = [];
        state.removedCelebrities.clear();
        state.allowExternalCelebrities = false;
        state.pendingExternalApproval = false;
        state.lastRejectedExternalNames = [];
        resetHostedMeetingProgress();
        updateGuestBar();
        headerSubtitle.textContent = '等待主持人推荐嘉宾';
        state.messages.push({
          role: 'system',
          content: '[系统通知] 用户要求开始新一场会议。请以主持人【风玲】身份确认用户的新话题，然后根据新话题重新推荐嘉宾（使用【名字】格式），输出完整推荐名单（含头衔和推荐理由），并询问用户是否满意。'
        });
        addSystemNotice('好的，为你开启新一场会议');
      } else {
        restartHostedConversationContext(text);
        state.meetingStarted = true;
        resetHostedMeetingProgress();
        updateGuestBar();
        headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾已确认，${getHostedMeetingModeLabel()}重新开始`;
        state.messages.push({
          role: 'system',
          content: '[系统通知] 用户抛出了新的议题。请由【风玲】先判断当前在场嘉宾是否仍然适合这个新议题：若合适，则沿用当前嘉宾直接重新开启第一轮讨论；若明显不匹配，再自然建议用户调整嘉宾名单。'
        });
        addSystemNotice('新的议题已接入，沿用当前嘉宾继续开场');
      }
    }
  }

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

  // 主持人模式：收尾确认阶段，优先处理用户"结束/继续"决定
  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded && state.awaitingEndConfirmation) {
    if (isAffirmativeEndReply(text)) {
      state.awaitingEndConfirmation = false;
      state.awaitingUserPerspective = false;
      state.summaryReady = true;
      state.messages.push({
        role: 'system',
        content: '[系统通知] 用户已确认可以结束会议。请注意：本次回复必须且只能由【风玲】输出结构化会议总结报告（核心观点/共识分歧/本场新组合洞见）。嘉宾在总结环节不得发言，整个回复只有风玲一个人说话。总结后会议即结束。'
      });
    } else if (isNegativeEndReply(text)) {
      state.awaitingEndConfirmation = false;
      state.awaitingUserPerspective = false;
      state.summaryReady = false;
      state.hostedStage = 'user-interaction';
      state.messages.push({
        role: 'system',
        content: '[系统通知] 用户选择继续讨论。请继续下一轮互动讨论，重点挖掘新见解，避免重复表述。'
      });
    }
  }

  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded && !state.awaitingEndConfirmation) {
    const hostedIntent = detectHostedUserIntent(text);

    if (hostedIntent.type === 'new-topic') {
      restartHostedConversationContext(text);
      resetHostedMeetingProgress();
      state.meetingStarted = true;
      state.meetingEnded = false;
      headerSubtitle.textContent = `${state.selectedCelebrities.length} 位嘉宾已确认，围绕新议题重新开场`;
      state.messages.push({
        role: 'system',
        content: '[系统通知] 用户发起了一个新的议题。请由【风玲】承接这个新议题，并在沿用当前嘉宾的前提下重新开启第一轮讨论；若当前嘉宾与新议题明显不匹配，再自然提醒用户可调整名单。'
      });
    } else if (hostedIntent.type === 'end') {
      if (canSummarizeCurrentHostedMeeting()) {
        state.awaitingEndConfirmation = false;
        state.awaitingUserPerspective = false;
        state.hostedStage = 'user-interaction';
        state.summaryReady = true;
        state.messages.push({
          role: 'system',
          content: '[系统通知] 用户主动要求结束并做总结。请注意：本次回复必须且只能由【风玲】输出结构化会议总结报告（核心观点/共识分歧/本场新组合洞见）。嘉宾在总结环节不得发言，整个回复只有风玲一个人说话。总结后会议即结束。'
        });
      } else {
        state.messages.push({
          role: 'system',
          content: state.meetingFlowMode === 'three-round'
            ? '[系统通知] 用户想尽快总结，但当前三轮会谈尚未完成必要的用户参与环节。请先承接用户的收束意图，再邀请用户或最相关嘉宾完成必要的第三阶段互动，不要直接总结。'
            : '[系统通知] 用户想尽快总结，但当前讨论仍未充分。请先承接用户意图，再补充一轮最有价值的讨论，不要直接输出总结报告。'
        });
      }
    } else if (state.awaitingUserPerspective || state.hostedStage === 'user-interaction' || state.hostedStage === 'round3' || state.userParticipationCount > 0) {
      state.awaitingUserPerspective = false;
      state.hostedStage = 'user-interaction';
      state.userParticipationCount += 1;
      const hostedDirective = buildHostedUserIntentDirective(text);
      if (hostedDirective) {
        state.messages.push({ role: 'system', content: hostedDirective });
      }
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
  // 嘉宾时效补充仅在“会议进行中”触发，会前不阻塞主持人推荐速度
  if (
    typeof generateCelebrityTimeContext === 'function'
    && state.selectedCelebrities.length > 0
    && state.selectionMode === 'auto'
    && state.meetingStarted
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
function createStreamMessage(speakerName, celebrityKey) {
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
  chatArea.appendChild(msgDiv);
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
  sendBtn.style.display = 'none';
  stopBtn.style.display = '';

  let typingMsg = null;

  try {
    typingMsg = addTypingIndicator();

    const systemPrompt = buildSystemPrompt(state.selectedCelebrities, {
      selectionMode: state.selectionMode,
      meetingFlowMode: state.meetingFlowMode,
      meetingStarted: state.meetingStarted,
      meetingEnded: state.meetingEnded,
      allowExternalCelebrities: state.allowExternalCelebrities,
      pendingExternalApproval: state.pendingExternalApproval,
      hostedRound: state.hostedRound,
      hostedStage: state.hostedStage,
      round1CompletedKeys: state.round1CompletedKeys,
      round2CompletedKeys: state.round2CompletedKeys,
      awaitingUserPerspective: state.awaitingUserPerspective,
      awaitingEndConfirmation: state.awaitingEndConfirmation,
      summaryReady: state.summaryReady,
      userParticipationCount: state.userParticipationCount,
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

        // 过滤风玲的重复自我介绍
        const messageIndex = state.messages.filter(m => m.role === 'assistant').length;
        fullContent = filterFenglingSelfIntro(fullContent, messageIndex);
        fullContent = beautifyHostContent(fullContent);

        const isOneOnOne = state.selectedCelebrities.length === 1;
        const parsedForFinal = parseMultiSpeaker(fullContent, isOneOnOne);

        // 保护：若流式阶段已拆出多发言，但最终解析失败，则保留流式展示，避免“内容突然消失/合并”
        const keepStreamRender = parsedForFinal.length === 0 && streamParsedMode && streamMsgElements.length > 0;

        if (!keepStreamRender) {
          // 清除流式渲染的临时消息，重新完整渲染
          clearStreamMessages();
          renderFinalContent(fullContent);
        } else {
          // 保留流式内容，仅确保最后一条也显示操作按钮
          const lastMsg = streamMsgElements[streamMsgElements.length - 1];
          const actionsDiv = lastMsg?.querySelector('.message-actions');
          if (actionsDiv) actionsDiv.classList.add('show');
        }

        const contentForHistory = cleanAssistantContentForHistory(stripNonHostForSummary(fullContent));
        // 若清洗后为空（整段都是复读/伪造用户回复），不写历史，避免污染下一轮上下文
        if (contentForHistory && contentForHistory.trim()) {
          state.messages.push({ role: 'assistant', content: contentForHistory });
        } else {
          console.log('[历史] 整段被识别为复读/伪造用户回复，跳过写入历史');
        }
      recordHostedAssistantTurn(fullContent);

      // 上报
      // 获取当前选择的参会人员显示名称
      const currentCelebrities = state.selectedCelebrities
        .filter(key => !state.removedCelebrities.has(key))
        .map(key => CELEBRITIES[key]?.displayName)
        .filter(name => name);
      
      if (typeof logMessage === 'function') logMessage('assistant', 'assistant', fullContent, currentCelebrities);

      // 检查AI推荐参会人员并自动添加
      checkAndApplyRecommendations(fullContent);
      
      // 检查是否需要继续生成（风玲引导了但没有嘉宾回应）
      await checkAndContinueGeneration(fullContent);
    }

  } catch (error) {
    removeStreamTyping();
    if (error.name === 'AbortError') {
      // 用户打断：保留已渲染的流式内容作为最终内容
      if (streamFullContent) {
        // 过滤风玲的重复自我介绍
        const messageIndex = state.messages.filter(m => m.role === 'assistant').length;
        streamFullContent = filterFenglingSelfIntro(streamFullContent, messageIndex);
        streamFullContent = beautifyHostContent(streamFullContent);

        const isOneOnOne = state.selectedCelebrities.length === 1;
        const parsedForFinal = parseMultiSpeaker(streamFullContent, isOneOnOne);
        const keepStreamRender = parsedForFinal.length === 0 && streamParsedMode && streamMsgElements.length > 0;

        if (!keepStreamRender) {
          clearStreamMessages();
          renderFinalContent(streamFullContent);
        } else {
          const lastMsg = streamMsgElements[streamMsgElements.length - 1];
          const actionsDiv = lastMsg?.querySelector('.message-actions');
          if (actionsDiv) actionsDiv.classList.add('show');
        }

        const streamContentForHistory = cleanAssistantContentForHistory(stripNonHostForSummary(streamFullContent));
        if (streamContentForHistory && streamContentForHistory.trim()) {
          state.messages.push({ role: 'assistant', content: streamContentForHistory });
        } else {
          console.log('[历史] 中断快照被识别为复读/伪造用户回复，跳过写入历史');
        }
        recordHostedAssistantTurn(streamFullContent);
        checkAndApplyRecommendations(streamFullContent);
        await checkAndContinueGeneration(streamFullContent);
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

function renderStreamContent(fullContent) {
  // 主持人模式会前推荐阶段：不做多角色拆分，避免名单推荐被误拆成嘉宾发言
  if (state.selectionMode === 'auto' && !state.meetingStarted) {
    return;
  }

  // 如果只有1位参会人员，跳过第一个标记之前的所有内容（风玲的引导语）
  const isOneOnOne = state.selectedCelebrities.length === 1;
  
  // 去掉末尾尚未闭合的 【xxx 片段，避免显示原始标记
  const cleanContent = fullContent.replace(/【[^】]*$/, '');

  const rawParsed = parseMultiSpeaker(cleanContent, isOneOnOne)
    .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text))
    .filter(seg => {
      if (state.selectionMode !== 'auto' || !state.meetingStarted) return true;
      if (seg.key !== 'fengling') return true;
      if (looksLikeFakeUserReplyEcho(seg.text)) {
        return false;
      }
      return true;
    });
  const authorized = filterAuthorizedSpeakers(rawParsed, cleanContent);
  const noFakeRecap = filterFakeGuestRecap(authorized);
  const noRepeating = filterRepeatingHostSegments(noFakeRecap);
  const parsed = dedupeSpeakerSegments(noRepeating);

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

  // 检查 DOM 元素与过滤后段落的 key 是否对齐：如果不对齐（如从"含嘉宾"切换到"仅风玲"），全部重建
  // 对旧元素（没有 speakerKey）先补齐，避免误判
  streamMsgElements.forEach((el, i) => {
    const seg = parsed[i];
    if (el && el.dataset && !el.dataset.speakerKey && seg) {
      el.dataset.speakerKey = seg.key;
    }
  });
  const needRebuild = streamMsgElements.some((el, i) => {
    const seg = parsed[i];
    if (!seg) return false;
    return el.dataset && el.dataset.speakerKey && el.dataset.speakerKey !== seg.key;
  });
  if (needRebuild) {
    streamMsgElements.forEach(el => el.remove());
    streamMsgElements = [];
  }

  // 确保 DOM 元素数量与段数一致（可能因过滤变严格而需要收缩）
  while (streamMsgElements.length > parsed.length) {
    const extra = streamMsgElements.pop();
    if (extra && extra.remove) extra.remove();
  }
  while (streamMsgElements.length < parsed.length) {
    const seg = parsed[streamMsgElements.length];
    const el = createStreamMessage(seg.speaker, seg.key);
    if (el && el.dataset) el.dataset.speakerKey = seg.key;
    streamMsgElements.push(el);
  }

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
//   3) 流式早期即出现明显总结关键词（如"会议总结/总结报告/核心观点/本场洞见/共识分歧"等）
// 就认为当前回复属于总结，需要强制只保留风玲段落。
function isSummaryPhaseContent(rawContent) {
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return false;
  if (state.summaryReady) return true;
  if (typeof rawContent !== 'string' || !rawContent) return false;
  if (detectMeetingSummary(rawContent)) return true;
  // 早期流式关键词识别（任何一个命中即认为进入总结模式）
  const earlySummaryPatterns = [
    /会议总结报告/,
    /【?风玲】?[^【]{0,60}?总结/,
    /核心观点/,
    /共识与?分歧/,
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

  // 主持人模式下：清掉"自答用户/自答嘉宾/复读上轮主持人发言"的段
  if (state.selectionMode === 'auto' && state.meetingStarted) {
    parsed = filterFakeGuestRecap(parsed);
    parsed = parsed.filter(seg => {
      if (seg.key !== 'fengling') return true;
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
function filterFakeGuestRecap(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return parsed;
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return parsed;

  const result = [];
  let hasGuestSoFar = hasAnyGuestSpokenRecently(null); // 历史里是否已有嘉宾发过言

  for (const seg of parsed) {
    if (seg.key !== 'fengling') {
      result.push(seg);
      hasGuestSoFar = true;
      continue;
    }
    // 是风玲段
    if (looksLikeHostFakingGuestSpeeches(seg.text) && !hasGuestSoFar) {
      console.log('[拦截] 风玲段疑似自答"嘉宾发言"（嘉宾实际尚未开口），丢弃：', seg.text.slice(0, 30));
      continue;
    }
    result.push(seg);
  }
  return result;
}

// 在主持人模式下：丢弃"与最近主持人发言"重复的风玲段（跨条去重）
function filterRepeatingHostSegments(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return parsed;
  if (state.selectionMode !== 'auto' || !state.meetingStarted) return parsed;
  const result = [];
  for (const seg of parsed) {
    if (seg.key === 'fengling') {
      const norm = normalizeSegText(seg.text);
      if (isTextRepeatingRecentHost(norm)) {
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
  for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 10; i--) {
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
  
  const rawParsed = parseMultiSpeaker(fullContent, isOneOnOne)
    .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text))
    // 主持人模式下：拦截 LLM 自答用户角色（"您说得对/我明白了..."等承接语）
    .filter(seg => {
      if (state.selectionMode !== 'auto' || !state.meetingStarted) return true;
      if (seg.key !== 'fengling') return true;
      if (looksLikeFakeUserReplyEcho(seg.text)) {
        console.log('[拦截] 风玲段疑似自答用户回复，丢弃：', seg.text.slice(0, 30));
        return false;
      }
      return true;
    });
  const authorized = filterAuthorizedSpeakers(rawParsed, fullContent);
  // 拦截风玲"自答嘉宾发言"：嘉宾根本还没说话，风玲却说"刚才几位..."
  const noFakeRecap = filterFakeGuestRecap(authorized);
  // 跨条复读检测（主持人段）
  const noRepeating = filterRepeatingHostSegments(noFakeRecap);
  const parsed = dedupeSpeakerSegments(noRepeating);
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
  const filtered = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
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

// ========== 检查是否需要继续生成 ==========
// 如果风玲引导了嘉宾发言，但AI没有生成嘉宾的回复，自动继续请求
async function checkAndContinueGeneration(content) {
  // 会前推荐阶段和已结束阶段都不做自动续写，避免死循环
  if (state.selectionMode === 'auto' && (!state.meetingStarted || state.meetingEnded)) return;
  // 总结阶段：只由风玲总结，不触发任何嘉宾续写
  if (state.summaryReady) return;

  // 防"主持人连续邀请用户但用户没回复"导致死循环：
  // 用户回复时会清零；只要计数 >= 2 一律不再续写
  if ((state.consecutiveUserInvitePending || 0) >= 2) {
    console.warn('[自动续写] 主持人已连续多次邀请用户但用户尚未回复，停止续写');
    return;
  }

  // 绝对递归深度保护（不区分成功/失败），防止风玲←→嘉宾无限循环
  state.autoContinueDepth = (state.autoContinueDepth || 0) + 1;
  if (state.autoContinueDepth > 8) {
    console.warn('[自动续写] 达到绝对深度上限，停止续写');
    return;
  }

  // 先做一次初步解析，以便判断 LLM 是否有有效推进
  // 这里必须应用与渲染管线一致的过滤，否则会用"被污染"的段落做续写决策
  let parsed = parseMultiSpeaker(content)
    .filter(seg => seg.key === 'fengling' || !isHostDirectiveText(seg.text));
  if (state.selectionMode === 'auto' && state.meetingStarted) {
    parsed = parsed.filter(seg => {
      if (seg.key !== 'fengling') return true;
      if (looksLikeFakeUserReplyEcho(seg.text)) return false;
      return true;
    });
    parsed = filterFakeGuestRecap(parsed);
  }

  // 关键：LLM 本次确实产出了可识别的发言段 → 视为成功推进，重置连续失败计数
  // autoContinueRetries 只用于防止"LLM 完全失败或反复不听话"的死循环
  if (parsed.length > 0) {
    state.autoContinueRetries = 0;
  }
  if (state.autoContinueRetries >= 5) return;

  // 主持人模式：前3轮前不应直接输出最终总结
  if (state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded) {
    const hasSummaryWithoutApproval = detectMeetingSummary(content);
    if (hasSummaryWithoutApproval && !state.summaryReady) {
      state.autoContinueRetries += 1;
      const correctionPrompt = state.awaitingEndConfirmation
        ? '[系统提示] 用户尚未明确同意结束会议，请不要直接输出会议总结报告。此刻只允许由【风玲】等待用户决定，或温和询问用户是继续讨论还是结束。'
        : (state.hostedRound < 3
          ? '[系统提示] 当前讨论轮次不足3轮，请先继续深入讨论（至少到第3轮）再考虑总结；优先补充新观点与分歧碰撞，避免提前收尾。'
          : (state.meetingFlowMode === 'three-round'
            ? (state.userParticipationCount > 0
              ? '[系统提示] 当前处于三轮会谈模式的第3阶段。未经用户明确同意结束前，不要输出会议总结报告；请继续围绕观点差异、赞同点与讨论中新获得的新知展开，或由【风玲】先询问用户会议是否可以结束。'
              : '[系统提示] 当前处于三轮会谈模式的第3阶段，但用户尚未正式参与本轮互动。请先由【风玲】邀请用户表达倾向、追问分歧点或点名嘉宾回应，不要直接总结。')
            : '[系统提示] 未经用户明确同意结束前，不要输出会议总结报告。请继续主持讨论，或由【风玲】先询问用户会议是否可以结束。'));
      state.messages.push({
        role: 'user',
        content: correctionPrompt
      });
      await generateResponse();
      return;
    }

    if (
      state.meetingFlowMode === 'three-round'
      && state.hostedStage === 'user-interaction'
      && state.userParticipationCount === 0
      && detectHostEndConfirmationPrompt(content)
    ) {
      state.autoContinueRetries += 1;
      state.messages.push({
        role: 'user',
        content: '[系统提示] 三轮会谈模式在进入结束确认前，必须先邀请用户参与一次讨论。请只输出一段新的【风玲】邀请用户表达看法、追问分歧点或点名嘉宾继续回应的话，不要总结，也不要询问是否结束。'
      });
      await generateResponse();
      return;
    }
  }

  const isHostedMeeting = state.selectionMode === 'auto' && state.meetingStarted && !state.meetingEnded;
  const hasSummary = detectMeetingSummary(content);
  const last = parsed[parsed.length - 1];
  const hasHost = parsed.some(seg => seg.key === 'fengling');

  // 全局守卫：本次回复中任何一段风玲被识别为"邀请用户发言"，立即停止续写链，等待用户回复。
  // 注意 isHostInvitingUser 已内置"启发式硬否决"：只要点了在场嘉宾的姓名，就不算邀请用户。
  if (isHostedMeeting) {
    const hostSegs = parsed.filter(seg => seg.key === 'fengling');
    for (const seg of hostSegs) {
      const inviting = await isHostInvitingUser(seg.text);
      if (inviting) {
        console.log('[自动续写] 识别到风玲在邀请用户发言，暂停续写，等待用户输入');
        state.autoContinueRetries = 0;
        state.consecutiveUserInvitePending = (state.consecutiveUserInvitePending || 0) + 1;
        return;
      }
    }
    // 本次回复没有"邀请用户"段，重置连续计数
    if (hostSegs.length > 0) {
      state.consecutiveUserInvitePending = 0;
    }
  }

  // 共用约束片段
  const SAFETY_GUARDS = [
    '严禁复述、改写、引用之前已经说过的任何文字（哪怕一句也不能重复）。',
    '严禁假装用户已经发言或回复——用户实际尚未输入任何内容；本轮回复中不得出现"您说得对/好的/嗯/我明白了/谢谢您的回应"等承接用户回复的开场白。',
    '严禁假装嘉宾已经发过言——只要嘉宾本轮还未真正发言，风玲就不得使用"刚才几位/前面几位/听了各位/综合诸位/几位先生的观点/几位的分享"等承接语；必须先让被邀请的嘉宾出场说话，再由风玲做过渡。',
    '严禁在文中转述系统提示，禁止出现"系统提示/系统通知"等字样。'
  ].join('');

  // 情况1：没有解析出任何发言人（LLM 没按多说话人格式输出）
  if (parsed.length === 0) {
    if (isHostedMeeting && !hasSummary) {
      state.autoContinueRetries += 1;
      state.messages.push({
        role: 'user',
        content: `[系统提示] 上轮未按【名字】格式输出发言。请按主持人模式规范重新组织本轮：至少由【风玲】做一次简短收尾并引导下一位嘉宾发言。${SAFETY_GUARDS}`
      });
      await generateResponse();
    }
    return;
  }

  // 情况2：最后发言者是嘉宾（不是风玲）→ 必须补风玲引导下一轮，否则流程会卡住
  if (isHostedMeeting && !hasSummary && last && last.key !== 'fengling') {
    console.log('[自动续写] 嘉宾发言后缺少主持人引导，自动补风玲收尾...');
    state.messages.push({
      role: 'user',
      content: `[系统提示] 本轮最后缺少主持人收尾。请只输出一段全新的【风玲】衔接话（1-3句），内容必须是全新的引导话术。回复只包含这一段【风玲】，不要输出任何其他嘉宾的发言。${SAFETY_GUARDS}`
    });
    await generateResponse();
    return;
  }

  // 情况3：整段没有主持人且不是总结
  if (isHostedMeeting && !hasSummary && !hasHost) {
    state.messages.push({
      role: 'user',
      content: `[系统提示] 本轮缺少主持人收尾。请补一段全新的【风玲】结束语引导下一轮（1-3句）。${SAFETY_GUARDS}`
    });
    await generateResponse();
    return;
  }

  // 情况4：最后发言者是风玲 → LLM 判定意图，决定是否续写嘉宾发言
  if (last && last.key === 'fengling') {
    const intent = await decideHostFollowUpIntent(last.text);
    if (intent?.intent === 'user_invite') {
      console.log('[自动续写] 判定风玲在邀请用户，等待用户回应');
      state.autoContinueRetries = 0;
      state.consecutiveUserInvitePending = (state.consecutiveUserInvitePending || 0) + 1;
      return;
    }
    if (intent?.intent === 'guest_invite' && state.selectedCelebrities.length > 0) {
      console.log('[自动续写] 判定风玲在邀请嘉宾，续写嘉宾发言', intent.targets);
      const continuePrompt = buildGuestFollowUpPrompt(last.text, intent?.targets || []) + SAFETY_GUARDS;
      state.messages.push({ role: 'user', content: continuePrompt });
      await generateResponse();
      return;
    }
    if (
      isHostedMeeting
      && state.meetingFlowMode === 'three-round'
      && state.hostedStage === 'round3'
      && state.userParticipationCount === 0
      && intent?.intent === 'none'
    ) {
      state.messages.push({
        role: 'user',
        content: `[系统提示] 当前已进入三轮会谈模式的第3阶段。请由【风玲】主动邀请用户参与本轮讨论：让用户表达倾向、追问某个分歧点，或点名某位嘉宾回应。不要直接总结，也不要询问是否结束。${SAFETY_GUARDS}`
      });
      await generateResponse();
      return;
    }
    // intent === 'none'：风玲既没邀请用户也没点名嘉宾（可能是中立陈述/收尾语）
    console.log('[自动续写] 判定风玲发言无明确邀请意图，停止续写');
    state.autoContinueRetries = 0;
    return;
  }

  // 其他情况：流程正常
  state.autoContinueRetries = 0;
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
  resetHostedMeetingProgress();
  state.autoContinueRetries = 0;
  
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
        resetHostedMeetingProgress();
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

  const bottomBtn = document.getElementById('scrollToBottomBtn');
  if (bottomBtn) {
    bottomBtn.addEventListener('click', () => {
      userScrolledUp = false;
      hideScrollToBottomBtn();
      chatArea.scrollTop = chatArea.scrollHeight;
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
  resetHostedMeetingProgress();
  state.autoContinueRetries = 0;
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
