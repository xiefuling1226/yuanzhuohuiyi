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
  supabaseUrl: 'https://rjqabugbscbcdbyxwysk.supabase.co',
  supabaseKey: 'sb_publishable_XbOddN7lI-OadYa9u7jj4w_4wVvmHsB',
};
