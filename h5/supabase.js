// 名人圆桌会议 - Supabase 数据上报

const SUPABASE_URL = CONFIG.supabaseUrl;
const SUPABASE_KEY = CONFIG.supabaseKey;

// 生成或获取会话ID
function getSessionId() {
  let sid = sessionStorage.getItem('roundtable_session_id');
  if (!sid) {
    sid = 'rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('roundtable_session_id', sid);
  }
  return sid;
}

// Supabase REST API 插入数据
async function supabaseInsert(table, data) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
  } catch (e) {
    // 静默失败，不影响用户体验
  }
}

// Supabase REST API 查询数据
async function supabaseSelect(table, query = '') {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    return await res.json();
  } catch (e) {
    return [];
  }
}

// 记录访问
function logVisit() {
  supabaseInsert('roundtable_visits', {
    session_id: getSessionId(),
    user_agent: navigator.userAgent,
  });
}

// 记录对话消息（增加 speaker 字段）
function logMessage(speaker, role, content) {
  supabaseInsert('roundtable_messages', {
    session_id: getSessionId(),
    speaker: speaker,
    role: role,
    content: content.slice(0, 5000), // 截断避免超长
  });
}
