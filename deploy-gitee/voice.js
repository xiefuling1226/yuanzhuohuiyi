// 语音朗读模块
// 方案：优先使用 Microsoft Edge 在线神经语音（免费，音质接近真人）
// 失败自动回退到浏览器内置 Web Speech API（并尽量挑选最优语音）

// ========== 名人性别映射（女性名人） ==========
// 未列出的默认按男性处理
const CELEBRITY_GENDER = {
  '风玲': 'female',
  '于丹': 'female',
  '屠呦呦': 'female',
  '武则天': 'female',
  '蒙台梭利': 'female',
  '蔡钰': 'female',
  '张雪': 'female',
  '李玫瑾': 'female',
  '梁宁': 'female',
};

function getCelebrityGender(speakerName) {
  return CELEBRITY_GENDER[speakerName] || 'male';
}

// ========== Edge 在线神经语音（zh-CN）声线池 ==========
// 每位名人按名字 hash 到其中一把，保证同一人每次都用同一把声音
const EDGE_FEMALE_VOICES = [
  'zh-CN-XiaoxiaoNeural',  // 晓晓 - 温暖知性（主持风玲默认）
  'zh-CN-XiaoyiNeural',    // 晓伊 - 活泼甜美
  'zh-CN-XiaohanNeural',   // 晓涵 - 温柔文艺
  'zh-CN-XiaomoNeural',    // 晓墨 - 沉稳大气
  'zh-CN-XiaoruiNeural',   // 晓睿 - 成熟稳重
  'zh-CN-XiaoxuanNeural',  // 晓萱 - 利落干练
  'zh-CN-XiaoqiuNeural',   // 晓秋 - 成熟柔和
  'zh-CN-XiaoshuangNeural',// 晓双 - 年轻活泼
];
const EDGE_MALE_VOICES = [
  'zh-CN-YunxiNeural',     // 云希 - 阳光青年
  'zh-CN-YunyangNeural',   // 云扬 - 专业播音
  'zh-CN-YunjianNeural',   // 云健 - 运动解说型低沉
  'zh-CN-YunfengNeural',   // 云枫 - 沉着坚定
  'zh-CN-YunhaoNeural',    // 云皓 - 热情有力
  'zh-CN-YunzeNeural',     // 云泽 - 中老年沉稳
];

// 手工指定特定名人的神经语音（选择相对贴近历史/人物气质的声线）
const CELEBRITY_EDGE_VOICE = {
  '风玲':     'zh-CN-XiaoxiaoNeural',

  '于丹':     'zh-CN-XiaoruiNeural',
  '屠呦呦':   'zh-CN-XiaoqiuNeural',
  '武则天':   'zh-CN-XiaomoNeural',
  '蒙台梭利': 'zh-CN-XiaohanNeural',
  '蔡钰':     'zh-CN-XiaoxuanNeural',
  '张雪':     'zh-CN-XiaoxuanNeural',
  '李玫瑾':   'zh-CN-XiaoruiNeural',
  '梁宁':     'zh-CN-XiaoxuanNeural',

  '毛泽东':   'zh-CN-YunzeNeural',
  '秦始皇':   'zh-CN-YunjianNeural',
  '曹操':     'zh-CN-YunjianNeural',
  '李世民':   'zh-CN-YunfengNeural',
  '刘邦':     'zh-CN-YunfengNeural',
  '凯撒':     'zh-CN-YunjianNeural',
  '拿破仑':   'zh-CN-YunhaoNeural',
  '丘吉尔':   'zh-CN-YunzeNeural',
  '林肯':     'zh-CN-YunfengNeural',
  '曼德拉':   'zh-CN-YunzeNeural',
  '甘地':     'zh-CN-YunfengNeural',
  '特朗普':   'zh-CN-YunhaoNeural',

  '孔子':     'zh-CN-YunzeNeural',
  '老子':     'zh-CN-YunzeNeural',
  '庄子':     'zh-CN-YunfengNeural',
  '孟子':     'zh-CN-YunfengNeural',
  '墨子':     'zh-CN-YunjianNeural',
  '孙子':     'zh-CN-YunjianNeural',
  '王阳明':   'zh-CN-YunfengNeural',
  '韩非子':   'zh-CN-YunjianNeural',
  '苏格拉底': 'zh-CN-YunzeNeural',
  '柏拉图':   'zh-CN-YunfengNeural',
  '亚里士多德':'zh-CN-YunfengNeural',

  '乔布斯':   'zh-CN-YunhaoNeural',
  '埃隆·马斯克':'zh-CN-YunxiNeural',
  '比尔·盖茨':'zh-CN-YunxiNeural',
  '杰夫·贝索斯':'zh-CN-YunyangNeural',
  '沃伦·巴菲特':'zh-CN-YunzeNeural',
  '查理·芒格':'zh-CN-YunzeNeural',
  '稻盛和夫': 'zh-CN-YunzeNeural',
  '松下幸之助':'zh-CN-YunzeNeural',
  '任正非':   'zh-CN-YunfengNeural',
  '马云':     'zh-CN-YunhaoNeural',
  '张一鸣':   'zh-CN-YunxiNeural',
  '李斌':     'zh-CN-YunxiNeural',
  '曹德旺':   'zh-CN-YunfengNeural',
  '山姆·沃尔顿':'zh-CN-YunfengNeural',
  '瑞·达利欧':'zh-CN-YunyangNeural',
  '洛克菲勒': 'zh-CN-YunzeNeural',

  '爱因斯坦': 'zh-CN-YunyangNeural',
  '牛顿':     'zh-CN-YunfengNeural',
  '霍金':     'zh-CN-YunjianNeural',
  '图灵':     'zh-CN-YunxiNeural',
  '费曼':     'zh-CN-YunxiNeural',
  '冯·诺依曼':'zh-CN-YunyangNeural',
  '香农':     'zh-CN-YunyangNeural',
  '特斯拉':   'zh-CN-YunfengNeural',
  '达尔文':   'zh-CN-YunyangNeural',
  '钱学森':   'zh-CN-YunfengNeural',
  '杨振宁':   'zh-CN-YunzeNeural',
  '袁隆平':   'zh-CN-YunzeNeural',
  '张衡':     'zh-CN-YunfengNeural',
  '祖冲之':   'zh-CN-YunfengNeural',
  '尹烨':     'zh-CN-YunxiNeural',
  '王立铭':   'zh-CN-YunxiNeural',

  '马克思':   'zh-CN-YunyangNeural',
  '尼采':     'zh-CN-YunfengNeural',
  '康德':     'zh-CN-YunyangNeural',
  '黑格尔':   'zh-CN-YunyangNeural',
  '弗洛伊德': 'zh-CN-YunyangNeural',
  '荣格':     'zh-CN-YunyangNeural',
  '阿德勒':   'zh-CN-YunfengNeural',
  '马斯洛':   'zh-CN-YunyangNeural',
  '弗兰克尔': 'zh-CN-YunyangNeural',
  '约翰·杜威':'zh-CN-YunyangNeural',
  '以赛亚·伯林':'zh-CN-YunzeNeural',
  '武志红':   'zh-CN-YunxiNeural',

  '亚当·斯密':'zh-CN-YunyangNeural',
  '凯恩斯':   'zh-CN-YunyangNeural',
  '彼得·德鲁克':'zh-CN-YunzeNeural',
  '薛兆丰':   'zh-CN-YunxiNeural',
  '刘润':     'zh-CN-YunxiNeural',
  '吴军':     'zh-CN-YunxiNeural',
  '吴伯凡':   'zh-CN-YunxiNeural',
  '罗振宇':   'zh-CN-YunxiNeural',
  '樊登':     'zh-CN-YunxiNeural',
  '纳西姆·塔勒布':'zh-CN-YunyangNeural',

  '鲁迅':     'zh-CN-YunfengNeural',
  '莫言':     'zh-CN-YunzeNeural',
  '余华':     'zh-CN-YunxiNeural',
  '冯唐':     'zh-CN-YunxiNeural',
  '刘墉':     'zh-CN-YunzeNeural',
  '蒋勋':     'zh-CN-YunzeNeural',
  '林语堂':   'zh-CN-YunfengNeural',
  '刘慈欣':   'zh-CN-YunfengNeural',
  '苏轼':     'zh-CN-YunfengNeural',
  '李白':     'zh-CN-YunhaoNeural',
  '杜甫':     'zh-CN-YunzeNeural',
  '王羲之':   'zh-CN-YunfengNeural',
  '罗贯中':   'zh-CN-YunzeNeural',
  '吴承恩':   'zh-CN-YunzeNeural',
  '施耐庵':   'zh-CN-YunzeNeural',
  '曹雪芹':   'zh-CN-YunzeNeural',
  '司马光':   'zh-CN-YunzeNeural',
  '司马迁':   'zh-CN-YunzeNeural',
  '诸葛亮':   'zh-CN-YunfengNeural',
  '当年明月': 'zh-CN-YunxiNeural',
  '莎士比亚': 'zh-CN-YunfengNeural',
  '托尔斯泰': 'zh-CN-YunzeNeural',
  '海明威':   'zh-CN-YunfengNeural',
  '易中天':   'zh-CN-YunxiNeural',
  '傅佩荣':   'zh-CN-YunzeNeural',
  '曾仕强':   'zh-CN-YunzeNeural',
  '华杉':     'zh-CN-YunxiNeural',

  '贝多芬':   'zh-CN-YunfengNeural',
  '梵高':     'zh-CN-YunfengNeural',
  '毕加索':   'zh-CN-YunhaoNeural',
  '达芬奇':   'zh-CN-YunyangNeural',
  '吴冠中':   'zh-CN-YunzeNeural',

  '罗翔':     'zh-CN-YunxiNeural',
  '张雪峰':   'zh-CN-YunxiNeural',
  '蔡康永':   'zh-CN-YunxiNeural',
  '韩望喜':   'zh-CN-YunzeNeural',
  '蒋海松':   'zh-CN-YunxiNeural',
  '徐文兵':   'zh-CN-YunzeNeural',
  '翟双庆':   'zh-CN-YunzeNeural',
  '陶行知':   'zh-CN-YunzeNeural',
};

// ========== 名人个性化参数（仅用于本地回退；Edge 神经语音不需要这些） ==========
const CELEBRITY_VOICE_PROFILES = {
  '风玲':     { pitch: 1.05, rate: 1.05 },
  '蔡钰':     { pitch: 1.05, rate: 1.05 },
  '屠呦呦':   { pitch: 1.05, rate: 1.00 },
  '武则天':   { pitch: 1.00, rate: 1.05 },
  '蒙台梭利': { pitch: 1.05, rate: 1.00 },
  '于丹':     { pitch: 1.05, rate: 1.00 },
  '张雪':     { pitch: 1.05, rate: 1.05 },
  '李玫瑾':   { pitch: 1.00, rate: 1.00 },
  '梁宁':     { pitch: 1.05, rate: 1.00 },

  '孔子': { pitch: 0.95, rate: 1.00 },
  '老子': { pitch: 0.92, rate: 0.95 },
  '庄子': { pitch: 0.95, rate: 1.00 },
  '王阳明': { pitch: 0.95, rate: 1.00 },
  '毛泽东': { pitch: 0.97, rate: 1.00 },
  '曹操':   { pitch: 0.97, rate: 1.05 },
  '李世民': { pitch: 0.95, rate: 1.00 },

  '爱因斯坦': { pitch: 1.00, rate: 1.05 },
  '图灵':     { pitch: 1.00, rate: 1.05 },
  '牛顿':     { pitch: 0.97, rate: 1.00 },
  '马克思':   { pitch: 0.95, rate: 1.00 },
  '亚当·斯密':{ pitch: 0.97, rate: 1.00 },

  '乔布斯':   { pitch: 1.00, rate: 1.10 },
  '埃隆·马斯克':{ pitch: 1.00, rate: 1.10 },
  '特朗普':   { pitch: 0.97, rate: 1.10 },
  '丘吉尔':   { pitch: 0.92, rate: 1.00 },

  '沃伦·巴菲特': { pitch: 0.97, rate: 1.00 },
  '比尔·盖茨':   { pitch: 1.00, rate: 1.05 },
  '稻盛和夫':    { pitch: 0.95, rate: 0.95 },
  '任正非':      { pitch: 0.95, rate: 1.00 },

  'default_male':   { pitch: 0.97, rate: 1.05 },
  'default_female': { pitch: 1.05, rate: 1.05 },
};

function getCelebrityVoiceConfig(speakerName) {
  if (CELEBRITY_VOICE_PROFILES[speakerName]) return CELEBRITY_VOICE_PROFILES[speakerName];
  const gender = getCelebrityGender(speakerName);
  return gender === 'female'
    ? CELEBRITY_VOICE_PROFILES['default_female']
    : CELEBRITY_VOICE_PROFILES['default_male'];
}

// 按名字 hash 选一把声音（在声音池里保持稳定映射）
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getEdgeVoiceForSpeaker(speakerName) {
  if (!speakerName) return EDGE_FEMALE_VOICES[0];
  if (CELEBRITY_EDGE_VOICE[speakerName]) return CELEBRITY_EDGE_VOICE[speakerName];
  const pool = getCelebrityGender(speakerName) === 'female' ? EDGE_FEMALE_VOICES : EDGE_MALE_VOICES;
  return pool[hashString(speakerName) % pool.length];
}

// ========== 全局语音状态 ==========
const voiceState = {
  enabled: true,
  isSpeaking: false,
  currentUtterance: null,
  currentAudio: null,          // Edge TTS 播放中的 <audio> 对象
  queue: [],
  processing: false,
  autoPlay: false,
  rate: 1.0,
  pitch: 1.0,
  voice: null,
  voices: [],
  femaleVoices: [],            // 本地高品质女声池
  maleVoices: [],              // 本地高品质男声池
  useEdgeTTS: true,            // 默认启用在线神经语音
  edgeAvailable: true,         // 在线语音是否可用（遇到失败会临时置 false 回退）
};

// ========== 本地语音：优选策略 ==========
// 高品质关键字打分（分数越高越优先）
function localVoiceQualityScore(v) {
  const n = (v.name || '').toLowerCase();
  let score = 0;
  if (n.includes('neural')) score += 100;
  if (n.includes('online')) score += 80;
  if (n.includes('natural')) score += 70;
  if (n.includes('premium')) score += 60;
  if (n.includes('enhanced')) score += 50;
  if (n.includes('wavenet')) score += 40;
  if ((v.lang || '').toLowerCase().startsWith('zh')) score += 20;
  return score;
}

function isFemaleVoice(v) {
  const n = (v.name || '').toLowerCase();
  return ['female', '女', 'xiaoxiao', 'xiaoyi', 'xiaohan', 'xiaomo', 'xiaorui',
          'xiaoxuan', 'xiaoqiu', 'xiaoshuang', 'yaoyao', 'huihui', 'tingting',
          'mei-jia', 'meijia', 'sin-ji', 'yuna'].some(h => n.includes(h));
}
function isMaleVoice(v) {
  const n = (v.name || '').toLowerCase();
  return ['male', '男', 'yunxi', 'yunyang', 'yunjian', 'yunfeng', 'yunhao',
          'yunze', 'kangkang', 'daniel'].some(h => n.includes(h));
}

function pickVoiceForGender(gender) {
  const pool = gender === 'female' ? voiceState.femaleVoices : voiceState.maleVoices;
  if (pool && pool.length) return pool[0];
  return voiceState.voice || null;
}

function pickLocalVoiceForSpeaker(speakerName) {
  const gender = getCelebrityGender(speakerName);
  const pool = gender === 'female' ? voiceState.femaleVoices : voiceState.maleVoices;
  if (pool && pool.length) {
    return pool[hashString(speakerName || 'default') % pool.length];
  }
  return pickVoiceForGender(gender);
}

// ========== 初始化 ==========
function initVoice() {
  if (!('speechSynthesis' in window)) {
    console.warn('浏览器不支持语音合成');
    voiceState.edgeAvailable = true; // 仍可用 Edge TTS + <audio>
  }
  loadVoices();
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  return true;
}

function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return;
  voiceState.voices = speechSynthesis.getVoices() || [];
  const zhVoices = voiceState.voices.filter(v => (v.lang || '').toLowerCase().startsWith('zh'));
  const pool = zhVoices.length ? zhVoices : voiceState.voices;

  const females = pool.filter(isFemaleVoice).sort((a, b) => localVoiceQualityScore(b) - localVoiceQualityScore(a));
  const males = pool.filter(isMaleVoice).sort((a, b) => localVoiceQualityScore(b) - localVoiceQualityScore(a));

  if (!females.length) {
    const rest = pool.filter(v => !isMaleVoice(v))
      .sort((a, b) => localVoiceQualityScore(b) - localVoiceQualityScore(a));
    if (rest.length) females.push(rest[0]);
  }
  if (!males.length) {
    const rest = pool.filter(v => !isFemaleVoice(v))
      .sort((a, b) => localVoiceQualityScore(b) - localVoiceQualityScore(a));
    if (rest.length) males.push(rest[0]);
  }

  voiceState.femaleVoices = females;
  voiceState.maleVoices = males;
  voiceState.voice = (zhVoices[0] || voiceState.voices[0] || null);

  console.log('🎤 本地语音初始化', {
    total: voiceState.voices.length,
    zh: zhVoices.length,
    female: females.map(v => v.name),
    male: males.map(v => v.name),
  });
}

// ========== Edge 在线神经语音（WSS） ==========
// 免费公共端点（Edge 浏览器"朗读"功能使用的同一接口）
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + EDGE_TTS_TOKEN;

function genRequestId() {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 将 rate 数值（倍率，1.0 = 正常）转为 SSML 百分比字符串
function ratePercent(rate) {
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

// 请求 Edge TTS 合成，返回 Blob URL（mp3）。超时或出错抛异常。
function edgeTTSSynthesize(text, voiceName, rate = 1.0, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(EDGE_TTS_URL);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    const chunks = [];
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { ws.close(); } catch (_) {}
        reject(new Error('Edge TTS 超时'));
      }
    }, timeoutMs);

    ws.onopen = () => {
      const requestId = genRequestId();
      const configMsg =
        'X-Timestamp:' + new Date().toISOString() + '\r\n' +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
      ws.send(configMsg);

      const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
        "<voice name='" + voiceName + "'>" +
        "<prosody rate='" + ratePercent(rate) + "' pitch='+0Hz'>" + escapeXml(text) + "</prosody>" +
        "</voice></speak>";

      const ssmlMsg =
        'X-RequestId:' + requestId + '\r\n' +
        'Content-Type:application/ssml+xml\r\n' +
        'Path:ssml\r\n\r\n' + ssml;
      ws.send(ssmlMsg);
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === 'string') {
        if (evt.data.includes('Path:turn.end')) {
          done = true;
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}
          if (!chunks.length) {
            reject(new Error('Edge TTS 未返回音频'));
            return;
          }
          let total = 0;
          for (const c of chunks) total += c.byteLength;
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            merged.set(new Uint8Array(c), offset);
            offset += c.byteLength;
          }
          const blob = new Blob([merged], { type: 'audio/mpeg' });
          resolve(URL.createObjectURL(blob));
        }
      } else {
        // 二进制消息：前 2 字节为 header 长度（big endian），随后是 header 文本，再后为音频数据
        const buf = evt.data;
        if (buf.byteLength < 2) return;
        const dv = new DataView(buf);
        const headerLen = dv.getUint16(0);
        const audioStart = 2 + headerLen;
        if (buf.byteLength > audioStart) {
          chunks.push(buf.slice(audioStart));
        }
      }
    };

    ws.onerror = (e) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error('Edge TTS WS 连接错误'));
      }
    };

    ws.onclose = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error('Edge TTS WS 已关闭'));
      }
    };
  });
}

// ========== 朗读控制 ==========
function toggleVoice() {
  voiceState.enabled = !voiceState.enabled;
  if (!voiceState.enabled) {
    try { speechSynthesis.cancel(); } catch (_) {}
    stopCurrentAudio();
    voiceState.queue = [];
    voiceState.processing = false;
    voiceState.isSpeaking = false;
    voiceState.currentUtterance = null;
  }
  updateVoiceButton();
  return voiceState.enabled;
}

function stopCurrentAudio() {
  if (voiceState.currentAudio) {
    try {
      voiceState.currentAudio.pause();
      voiceState.currentAudio.src = '';
    } catch (_) {}
    voiceState.currentAudio = null;
  }
}

function speak(text, speakerName = '') {
  if (!voiceState.enabled || !text) return;
  voiceState.queue.push({ text, speakerName });
  if (!voiceState.processing) processQueue();
}

function autoPlayAll(startElement) {
  console.log('🎵 启动自动连续播放模式');
  if (!voiceState.enabled) voiceState.enabled = true;

  voiceState.queue = [];
  voiceState.processing = false;
  try { speechSynthesis.cancel(); } catch (_) {}
  stopCurrentAudio();
  clearAllPlayingButtons();

  let current = startElement;
  while (current) {
    if (current.classList && current.classList.contains('message')) {
      const bubble = current.querySelector('.message-bubble');
      const nameEl = current.querySelector('.message-name');
      if (bubble && nameEl) {
        const content = bubble.textContent.trim();
        const speakerName = nameEl.textContent.trim();
        if (content) {
          voiceState.queue.push({ text: content, speakerName, element: current });
        }
      }
    }
    current = current.nextElementSibling;
  }

  voiceState.autoPlay = true;
  processQueue();
}

async function processQueue() {
  if (voiceState.queue.length === 0) {
    voiceState.processing = false;
    voiceState.isSpeaking = false;
    voiceState.autoPlay = false;
    updateVoiceButton();
    clearAllPlayingButtons();
    updateSendButtonForVoice(false);
    return;
  }

  voiceState.processing = true;
  voiceState.isSpeaking = true;
  updateVoiceButton();
  updateSendButtonForVoice(true);

  const item = voiceState.queue.shift();
  console.log('🔊 开始朗读:', item.speakerName, (item.text || '').substring(0, 30) + '...');

  clearAllPlayingButtons();
  if (item.element) {
    const voiceBtn = item.element.querySelector('.msg-voice-btn');
    if (voiceBtn) {
      voiceBtn.classList.add('playing');
      voiceBtn.title = '正在朗读...';
    }
    document.querySelectorAll('.message.voice-playing').forEach(el => el.classList.remove('voice-playing'));
    item.element.classList.add('voice-playing');
  }

  // 组装朗读脚本：先说"某某说："再朗读正文，合并为一句更自然
  const fullText = item.speakerName
    ? `${item.speakerName}：${item.text}`
    : item.text;

  try {
    if (voiceState.useEdgeTTS && voiceState.edgeAvailable) {
      await speakViaEdge(fullText, item);
    } else {
      await speakViaLocal(fullText, item);
    }
  } catch (err) {
    console.warn('Edge TTS 失败，回退本地语音:', err && err.message);
    voiceState.edgeAvailable = false;
    try {
      await speakViaLocal(fullText, item);
    } catch (e2) {
      console.error('本地语音也失败:', e2);
    }
  }

  if (item.element) {
    item.element.classList.remove('voice-playing');
    const voiceBtn = item.element.querySelector('.msg-voice-btn');
    if (voiceBtn) {
      voiceBtn.classList.remove('playing');
      voiceBtn.title = '朗读';
    }
  }

  setTimeout(() => processQueue(), 200);
}

// Edge 在线神经语音播放
function speakViaEdge(text, item) {
  return new Promise(async (resolve, reject) => {
    const voiceName = getEdgeVoiceForSpeaker(item.speakerName);
    const rate = voiceState.rate;
    let url;
    try {
      url = await edgeTTSSynthesize(text, voiceName, rate, 10000);
    } catch (e) {
      reject(e);
      return;
    }

    const audio = new Audio(url);
    voiceState.currentAudio = audio;
    audio.onended = () => {
      try { URL.revokeObjectURL(url); } catch (_) {}
      voiceState.currentAudio = null;
      resolve();
    };
    audio.onerror = (e) => {
      try { URL.revokeObjectURL(url); } catch (_) {}
      voiceState.currentAudio = null;
      reject(new Error('audio 播放失败'));
    };

    console.log('🎙️ Edge TTS:', { voice: voiceName, rate });
    audio.play().catch(err => reject(err));
  });
}

// 本地 Web Speech 播放（回退）
function speakViaLocal(text, item) {
  return new Promise((resolve, reject) => {
    if (typeof SpeechSynthesisUtterance === 'undefined') {
      reject(new Error('浏览器不支持 Web Speech'));
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    const speaker = item.speakerName;
    const gender = getCelebrityGender(speaker);
    const cfg = getCelebrityVoiceConfig(speaker);

    const voice = pickLocalVoiceForSpeaker(speaker);
    if (voice) utter.voice = voice;

    utter.lang = 'zh-CN';
    utter.pitch = Math.max(0.85, Math.min(1.15, cfg.pitch));
    utter.rate = Math.max(0.8, Math.min(1.3, cfg.rate * voiceState.rate));

    console.log('🗣️ 本地语音:', {
      speaker, gender,
      voice: utter.voice ? utter.voice.name : 'default',
      pitch: utter.pitch, rate: utter.rate,
    });

    utter.onend = () => {
      voiceState.currentUtterance = null;
      resolve();
    };
    utter.onerror = (e) => {
      console.error('❌ 本地语音错误:', e);
      voiceState.currentUtterance = null;
      resolve(); // 出错也 resolve，队列继续
    };

    voiceState.currentUtterance = utter;
    try { speechSynthesis.cancel(); } catch (_) {}
    speechSynthesis.speak(utter);
  });
}

function stopSpeaking() {
  console.log('⏹️ 停止所有语音播放');
  try { speechSynthesis.cancel(); } catch (_) {}
  stopCurrentAudio();
  voiceState.queue = [];
  voiceState.processing = false;
  voiceState.isSpeaking = false;
  voiceState.autoPlay = false;
  voiceState.currentUtterance = null;

  document.querySelectorAll('.message.voice-playing').forEach(el => el.classList.remove('voice-playing'));
  clearAllPlayingButtons();
  updateSendButtonForVoice(false);
  updateVoiceButton();
}

function clearAllPlayingButtons() {
  document.querySelectorAll('.msg-voice-btn.playing').forEach(btn => {
    btn.classList.remove('playing');
    btn.title = '朗读';
  });
}

function updateSendButtonForVoice(isPlaying) {
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (!sendBtn || !stopBtn) return;
  if (isPlaying) {
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    stopBtn.title = '停止语音播放';
  } else {
    if (!window.state || !window.state.isGenerating) {
      sendBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
    }
  }
}

function pauseSpeaking() {
  if (voiceState.currentAudio) {
    try { voiceState.currentAudio.pause(); } catch (_) {}
    return;
  }
  if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.pause();
}

function resumeSpeaking() {
  if (voiceState.currentAudio) {
    try { voiceState.currentAudio.play(); } catch (_) {}
    return;
  }
  if (speechSynthesis.paused) speechSynthesis.resume();
}

function updateVoiceButton() {
  const btn = document.getElementById('voiceToggleBtn');
  if (!btn) return;
  if (voiceState.enabled) {
    btn.classList.add('active');
    btn.title = voiceState.isSpeaking ? '正在朗读...' : '语音朗读已开启';
  } else {
    btn.classList.remove('active');
    btn.title = '开启语音朗读';
  }
}

function setVoiceRate(rate) {
  voiceState.rate = Math.max(0.5, Math.min(2.0, rate));
}

function setVoicePitch(pitch) {
  voiceState.pitch = Math.max(0, Math.min(2.0, pitch));
}

// 一键切换"高品质在线语音/本地语音"
function setUseEdgeTTS(on) {
  voiceState.useEdgeTTS = !!on;
  voiceState.edgeAvailable = true; // 重置可用性标记
  console.log('Edge TTS', on ? '已启用' : '已关闭');
}

// 导出到全局
window.voiceState = voiceState;
window.initVoice = initVoice;
window.toggleVoice = toggleVoice;
window.speak = speak;
window.autoPlayAll = autoPlayAll;
window.stopSpeaking = stopSpeaking;
window.pauseSpeaking = pauseSpeaking;
window.resumeSpeaking = resumeSpeaking;
window.setVoiceRate = setVoiceRate;
window.setVoicePitch = setVoicePitch;
window.setUseEdgeTTS = setUseEdgeTTS;

// 风玲语音风格预设（仅用于本地回退模式下的 pitch/rate 微调）
window.FENGLING_VOICE_STYLES = {
  '知性优雅': { pitch: 1.05, rate: 1.00 },
  '温柔甜美': { pitch: 1.10, rate: 0.95 },
  '干练利落': { pitch: 1.00, rate: 1.10 },
  '沉稳大气': { pitch: 0.98, rate: 0.95 },
  '活泼亲切': { pitch: 1.10, rate: 1.05 },
};

function setFenglingVoiceStyle(styleName) {
  const style = window.FENGLING_VOICE_STYLES[styleName];
  if (style && CELEBRITY_VOICE_PROFILES['风玲']) {
    CELEBRITY_VOICE_PROFILES['风玲'] = style;
    console.log('✅ 风玲语音风格已设置为:', styleName, style);
  }
}
window.setFenglingVoiceStyle = setFenglingVoiceStyle;
