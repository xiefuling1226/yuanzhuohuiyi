// 光年之约圆桌会 — 可提交到公开仓库的默认配置（与 h5 同步）
// 仅本机/仅部署环境的密钥见 config.example.local.js → 复制为 config.local.js，勿将含密钥的该文件推送到公开仓库

const CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  model: 'deepseek-chat',

  maxHistoryRounds: 15,
  temperature: 0.85,
  max_tokens: 4000,

  supabaseUrl: 'https://mvgpnjvfpckqznzpmskv.supabase.co',
  supabaseKey: '',
};

if (typeof window !== 'undefined' && window.ROUND_TABLE_SECRETS) {
  const s = window.ROUND_TABLE_SECRETS;
  if (s.apiKey) CONFIG.apiKey = s.apiKey;
  if (s.supabaseKey) CONFIG.supabaseKey = s.supabaseKey;
  if (s.apiEndpoint) CONFIG.apiEndpoint = s.apiEndpoint;
  if (s.supabaseUrl) CONFIG.supabaseUrl = s.supabaseUrl;
  if (s.model) CONFIG.model = s.model;
}
