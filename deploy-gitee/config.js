// 名人圆桌会议 H5 - API 配置

const APP_STORAGE_KEYS = {
  model: 'roundtable_model',
  meetingFlowMode: 'roundtable_meeting_flow_mode',
};

const FREE_MODEL_OPTIONS = [
  {
    value: 'deepseek-chat',
    label: 'DeepSeek Chat',
    description: '响应更均衡，适合日常圆桌讨论与观点展开。',
  },
  {
    value: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    description: '推理更强，适合复杂议题的拆解、比较与延展。',
  },
];

const HOSTED_MEETING_MODE_OPTIONS = [
  {
    value: 'three-round',
    label: '三轮会谈模式',
    description: '固定三阶段推进，默认使用这一模式组织主持型会议。',
  },
  {
    value: 'host-relay',
    label: '主持人衔接模式',
    description: '由主持人根据讨论充分度动态衔接推进，不固定为三轮。',
  },
];

function readStoredOption(key, fallback, validValues) {
  try {
    const value = localStorage.getItem(key);
    return validValues.includes(value) ? value : fallback;
  } catch (error) {
    return fallback;
  }
}

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_MEETING_FLOW_MODE = 'three-round';

const CONFIG = {
  // DeepSeek API
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: 'sk-26ca4b36df41403eb7ce144c0f796ceb',
  model: readStoredOption(
    APP_STORAGE_KEYS.model,
    DEFAULT_MODEL,
    FREE_MODEL_OPTIONS.map(item => item.value)
  ),

  // 圆桌设置
  defaultModel: DEFAULT_MODEL,
  defaultMeetingFlowMode: DEFAULT_MEETING_FLOW_MODE,
  meetingFlowMode: readStoredOption(
    APP_STORAGE_KEYS.meetingFlowMode,
    DEFAULT_MEETING_FLOW_MODE,
    HOSTED_MEETING_MODE_OPTIONS.map(item => item.value)
  ),
  freeModelOptions: FREE_MODEL_OPTIONS,
  hostedMeetingModeOptions: HOSTED_MEETING_MODE_OPTIONS,
  storageKeys: APP_STORAGE_KEYS,

  // 对话参数
  maxHistoryRounds: 15,
  temperature: 0.85,
  max_tokens: 4000,  // 增加最大输出长度，防止推荐嘉宾时被截断

  // Supabase
  supabaseUrl: 'https://mvgpnjvfpckqznzpmskv.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Z3BuanZmcGNrcXpuenBtc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODA4MjMsImV4cCI6MjA5MTg1NjgyM30.4UAgzGeiyBIEEqqyOn65u4p-BcNn_dZnO5HRDc2-gEY',
};
