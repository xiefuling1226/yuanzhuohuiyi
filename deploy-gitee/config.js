// 光年之约圆桌会 — 可提交到公开仓库的默认配置（apiKey 等为空，任何人克隆都能打开页面，对话前需自填密钥）
// 仅本机的密钥二选一，勿提交到公开仓库：
//  (1) 同目录下复制 config.example.local.js 为 config.local.js 并填写（已在 .gitignore，适合分享「代码」不分享「密钥」）
//  (2) 在 index.html 里、在本文件之前用内联 <script> 设置 window.ROUND_TABLE_SECRETS
// 发布到 Gitee 等：把含密钥的 config.local.js 与页面一起上传，或仅在服务器上编辑、勿 push 到公开库
//
// DeepSeek 官方 API 没有「换一个 model 就永久免费」的档位，按 token 计费；仅账户有赠送余额时可 0 元试用。
// 省钱/用赠金：保持 deepseek-v4-flash（勿用 deepseek-v4-pro）。旧名 deepseek-chat 多为兼容别名，一般不更便宜。

const CONFIG = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  apiKey: '',
  /** V4 入门档（最便宜）；官方无单独「免费」模型名 */
  model: 'deepseek-v4-flash',

  maxHistoryRounds: 15,
  temperature: 0.85,
  /** 普通会中回复上限；总结报告需更长输出 */
  max_tokens: 4000,
  /** 用户确认结束后的「会议总结报告」专稿，尽量给足输出空间，避免半截截断 */
  summaryMaxTokens: 8192,

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
