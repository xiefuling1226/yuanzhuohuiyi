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

// Supabase REST API 删除数据
async function supabaseDelete(table, filter) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('删除失败:', errorText);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('删除异常:', e);
    return false;
  }
}

// 获取用户地区信息（通过 IP）
async function getUserLocation() {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();
    return {
      country: data.country_name || '未知',
      region: data.region || '未知',
      city: data.city || '未知',
    };
  } catch (e) {
    return { country: '未知', region: '未知', city: '未知' };
  }
}

// 记录访问
async function logVisit() {
  const location = await getUserLocation();
  supabaseInsert('roundtable_visits', {
    session_id: getSessionId(),
    user_agent: navigator.userAgent,
    country: location.country,
    region: location.region,
    city: location.city,
  });
}

// 记录对话消息（增加 speaker 字段和名人信息）
function logMessage(speaker, role, content, celebrities = []) {
  const sessionId = getSessionId();
  console.log('💾 保存消息到 Supabase, session_id:', sessionId, 'speaker:', speaker);
  
  supabaseInsert('roundtable_messages', {
    session_id: sessionId,
    speaker: speaker,
    role: role,
    content: content.slice(0, 5000), // 截断避免超长
    celebrities: celebrities.length > 0 ? celebrities.join(',') : null,
  });
}
