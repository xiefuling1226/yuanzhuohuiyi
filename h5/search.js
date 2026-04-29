// 网络搜索模块 - 用于补充模型训练数据之后的最新信息

const searchState = {
  cache: new Map(),  // 缓存搜索结果
  isSearching: false,
};

/**
 * 检测用户消息是否可能涉及最新信息（2024年之后）
 */
function needsRecentInfo(userMessage) {
  const message = String(userMessage || '').toLowerCase();
  if (!message) return false;

  const recentKeywords = [
    '2025', '2026', '今年', '最近', '最新', '近期',
    '最新数据', '最新进展', '最新动态', '近来', '现状', '目前情况',
    '股市', '经济', '政策', '科技进展', 'ai进展', '发布', '上线', '财报',
    '融资', '票房', '选举', '法规', '关税', '战争', '疫情', '汇率',
  ];
  if (recentKeywords.some(keyword => message.includes(keyword))) return true;

  // 明确时间表达也触发：如“这周/本月/昨天/今天”
  if (/(今天|昨日|昨天|本周|这周|本月|上个月|本季度|今年|去年|刚刚|近期)/.test(message)) return true;

  return false;
}

/**
 * 使用网络搜索获取最新信息
 * @param {string} query - 搜索关键词
 * @returns {Promise<string>} 搜索结果摘要
 */
async function searchRecentInfo(query) {
  // 检查缓存
  const cacheKey = query.toLowerCase().trim();
  if (searchState.cache.has(cacheKey)) {
    const cached = searchState.cache.get(cacheKey);
    console.log('🔍 使用缓存的搜索结果:', cacheKey);
    return cached.content;
  }
  
  try {
    console.log('🔍 搜索最新信息:', query);
    
    // 使用多个搜索源
    const searchPromises = [
      searchWithWikipedia(query),
      searchWithDuckDuckGo(query),
    ];
    
    // 并行执行所有搜索
    const results = await Promise.allSettled(searchPromises);
    
    // 合并结果
    let summary = '';
    let successCount = 0;
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        summary += result.value + '\n\n';
        successCount++;
      }
    }
    
    if (successCount > 0) {
      const resultContent = summary.trim();
      // 缓存结果（10分钟过期）
      searchState.cache.set(cacheKey, {
        content: resultContent,
        timestamp: Date.now(),
      });
      
      console.log(`✅ 搜索完成，从 ${successCount} 个源获取到最新信息`);
      return resultContent;
    } else {
      console.log('⚠️ 未搜索到相关信息');
      return null;
    }
  } catch (error) {
    console.error('❌ 搜索失败:', error);
    return null;
  }
}

/**
 * 使用 DuckDuckGo API 搜索
 */
async function searchWithDuckDuckGo(query) {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`,
      { signal: AbortSignal.timeout(1600) }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    let results = [];
    
    // 提取摘要
    if (data.Abstract) {
      results.push(`摘要：${data.Abstract}\n来源: ${data.AbstractSource}`);
    }
    
    // 提取相关主题
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics.slice(0, 3).map((t, i) => {
        if (t.Text && t.FirstURL) {
          return `${i + 1}. ${t.Text}\n   来源: ${t.FirstURL}`;
        }
        return null;
      }).filter(Boolean);
      
      if (topics.length > 0) {
        results.push('相关信息：\n' + topics.join('\n\n'));
      }
    }
    
    if (results.length > 0) {
      return `DuckDuckGo 搜索（${query}）：\n${results.join('\n\n')}`;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 使用 Wikipedia API 搜索
 */
async function searchWithWikipedia(query) {
  try {
    const response = await fetch(
      `https://zh.wikipedia.org/api/rest_v1/search/summary/${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(1200) }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.extract) {
      return `维基百科摘要（${query}）：\n${data.extract}\n来源: ${data.content_urls?.desktop?.page || 'Wikipedia'}`;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 生成时间背景补充信息
 * @param {string} userMessage - 用户消息
 * @returns {Promise<string|null>} 补充信息
 */
async function generateTimeContext(userMessage) {
  if (!needsRecentInfo(userMessage)) {
    return null;
  }

  // 提取搜索关键词：清理语气词、保留核心名词
  const query = String(userMessage || '')
    .replace(/[？?！!。，“”、]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(请问|帮我|想了解|我想知道|能不能|可以|一下|吗|呢|呀|吧|请)/g, ' ')
    .trim()
    .slice(0, 80);
  
  const searchResult = await searchRecentInfo(query);
  
  if (searchResult) {
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    return `## 最新信息补充（检索时间：${now}）\n${searchResult}\n\n**注意**：以上信息来自实时网络搜索，可能与模型训练数据不同。`;
  }
  
  return null;
}

/**
 * 为在场嘉宾补齐“知识空白期”信息（如 2024 之后）
 * @param {string[]} selectedCelebrityKeys - 在场嘉宾 key 列表
 * @param {string} userMessage - 用户本轮问题
 * @returns {Promise<string|null>} 嘉宾时效补充
 */
async function generateCelebrityTimeContext(selectedCelebrityKeys, userMessage) {
  const keys = Array.isArray(selectedCelebrityKeys) ? selectedCelebrityKeys : [];
  if (keys.length === 0) return null;

  const topic = String(userMessage || '')
    .replace(/[？?！!。，“”、]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(请问|帮我|想了解|我想知道|能不能|可以|一下|吗|呢|呀|吧|请)/g, ' ')
    .trim()
    .slice(0, 40);

  // 控制成本：最多为 2 位最相关在场嘉宾做实时补充
  const celebrityNames = keys
    .map(k => CELEBRITIES[k]?.displayName)
    .filter(Boolean)
    .slice(0, 2);
  if (celebrityNames.length === 0) return null;

  const queries = celebrityNames.map(name => {
    const base = topic ? `${name} ${topic}` : `${name}`;
    return `${base} 2025 2026 最新动态 近况`;
  });

  const results = await Promise.allSettled(queries.map(q => searchRecentInfo(q)));
  const sections = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) continue;
    sections.push(`### ${celebrityNames[i]}（时效补充）\n${r.value}`);
  }

  if (sections.length === 0) return null;
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `## 嘉宾时效信息补充（检索时间：${now}）\n${sections.join('\n\n')}\n\n**使用要求**：请优先以各嘉宾既有思想体系/skill为核心，仅将以上信息作为“2024年后补充背景”，不要编造未检索到的事实。`;
}

/**
 * 清理过期缓存（超过10分钟的）
 */
function cleanExpiredCache() {
  const now = Date.now();
  const expireTime = 10 * 60 * 1000;  // 10分钟
  
  for (const [key, value] of searchState.cache.entries()) {
    if (now - value.timestamp > expireTime) {
      searchState.cache.delete(key);
    }
  }
}

// 每5分钟清理一次缓存
setInterval(cleanExpiredCache, 5 * 60 * 1000);
