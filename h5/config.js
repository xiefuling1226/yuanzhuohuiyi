// 名人圆桌会议 H5 - API 配置

const CONFIG = {
  // DeepSeek API
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: 'sk-26ca4b36df41403eb7ce144c0f796ceb',
  model: 'deepseek-chat',

  // 对话参数
  maxHistoryRounds: 15,
  temperature: 0.85,

  // Supabase
  supabaseUrl: 'https://mvgpnjvfpckqznzpmskv.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Z3BuanZmcGNrcXpuenBtc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODA4MjMsImV4cCI6MjA5MTg1NjgyM30.4UAgzGeiyBIEEqqyOn65u4p-BcNn_dZnO5HRDc2-gEY',
};
