// 语音朗读模块
// Microsoft Edge 在线神经语音：全场固定「晓晨」zh-CN-XiaochenNeural（清晰播报向中文女声），不按发言人切换。
// 失败时回退 Web Speech API：仅使用本机中文女声；语速略慢以便听清。

/** Edge TTS 固定声线：晓晨（明亮清晰，偏信息播报） */
const EDGE_TTS_VOICE_ZH_FEMALE_CLEAR = 'zh-CN-XiaochenNeural';

function getEdgeVoiceForSpeaker(_speakerName) {
  return EDGE_TTS_VOICE_ZH_FEMALE_CLEAR;
}

function isMobileLikeDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  const coarse =
    /iphone|ipod|ipad|android|mobile|webos|blackberry|opera mini|iemobile/i.test(ua);
  const fine =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(max-width: 768px)').matches;
  return coarse || fine;
}

function isIOSOrWeChatWebView() {
  const ua = (navigator.userAgent || '').toLowerCase();
  return /iphone|ipad|ipod/i.test(ua) || /micromessenger/i.test(ua);
}

/** 移动端：异步 Edge TTS + blob 常在脱离用户手势后被系统静默静音；改用系统朗读（本地女声池）以保证出声；桌面仍用 Edge 神经女声 */
function shouldPreferLocalSpeechOverEdge() {
  return isMobileLikeDevice();
}


// ========== 本地回退：统一女声语速/音高 ==========
const CELEBRITY_VOICE_PROFILES = {
  default_female: { pitch: 1.05, rate: 1.05 },
};

function getCelebrityVoiceConfig(_speakerName) {
  return CELEBRITY_VOICE_PROFILES.default_female;
}

// 按名字 hash 在本地女声池中取一把（稳定映射）
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ========== 全局语音状态 ==========
/** 用于在用户手势内抢占移动端音频解锁（异步合成后再 play 否则会无声） */
const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==';

const voiceState = {
  enabled: true,
  isSpeaking: false,
  currentUtterance: null,
  currentAudio: null,          // Edge TTS 播放中的 <audio> 对象（与 sharedPlaybackAudio 同一实例）
  sharedPlaybackAudio: null,   // 全程复用一个 audio，便于 iOS / WebView 解锁后续 blob 播放
  sharedPlaybackPrimed: false, // 是否已在手势内成功 play 过静音（解锁标记）
  queue: [],
  processing: false,
  autoPlay: false,
  rate: 0.98, // 接近日常语速，手机扬声器上比过慢更易听清
  pitch: 1.0,
  voice: null,
  voices: [],
  femaleVoices: [],            // 本地高品质女声池
  maleVoices: [],              // 本地高品质男声池
  useEdgeTTS: true,            // 默认启用在线神经语音
  edgeAvailable: true,         // 在线语音是否可用
  edgeFailStreak: 0,           // 连续失败次数，避免手机偶发断线后整会话锁死劣质本地音
};

function getSharedPlaybackAudio() {
  if (!voiceState.sharedPlaybackAudio) {
    const a = document.createElement('audio');
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.setAttribute('x-webkit-airplay', 'allow');
    a.preload = 'auto';
    try {
      a.playsInline = true;
    } catch (_) {}
    voiceState.sharedPlaybackAudio = a;
  }
  return voiceState.sharedPlaybackAudio;
}

/** 在用户手势栈内调用：同一 audio 先播极短静音，后续异步设置的 blob/mp3 更易通过系统的「允许有声播放」策略 */
function primeSharedPlaybackAudioFromGesture() {
  if (voiceState.sharedPlaybackPrimed) return;
  try {
    const a = getSharedPlaybackAudio();
    try {
      a.pause();
    } catch (_) {}
    a.src = SILENT_AUDIO_DATA_URI;
    a.volume = 0.001;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        try {
          a.pause();
          a.volume = 1;
          voiceState.sharedPlaybackPrimed = true;
        } catch (_) {}
      }).catch(() => {});
    } else {
      voiceState.sharedPlaybackPrimed = true;
    }
  } catch (_) {}
}

/** iOS / 微信内置浏览器：须在用户手势内解锁音频；异步 TTS 完成后再 play() 会失去手势上下文，故先解锁并重试播放 */
function unlockMobileAudioPlayback() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch (_) {}
  try {
    const silent = new Audio(SILENT_AUDIO_DATA_URI);
    silent.volume = 0.001;
    const p = silent.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        try {
          silent.pause();
          silent.src = '';
        } catch (_) {}
      }).catch(() => {});
    }
  } catch (_) {}
  if (isMobileLikeDevice() || isIOSOrWeChatWebView()) {
    primeSharedPlaybackAudioFromGesture();
  }
}

// ========== 本地语音：优选策略 ==========
// 高品质关键字打分（分数越高越优先）
function localVoiceQualityScore(v) {
  const n = (v.name || '').toLowerCase();
  let score = 0;
  if (n.includes('neural')) score += 100;
  if (n.includes('xiaochen') || n.includes('yunyang')) score += 35; // 偏清晰播音
  if (n.includes('xiaoxiao') || n.includes('xiaoyi')) score += 42;
  // iOS / 常见中文女声标识（系统 TTS 无 neural 时只能靠这些）
  if (/mei-jia|meijia|sin-ji|ting-ting|tingting|yu-shu|lisha/.test(n)) score += 55;
  if (n.includes('online')) score += 80;
  if (n.includes('natural')) score += 70;
  if (n.includes('premium')) score += 60;
  if (n.includes('enhanced')) score += 50;
  if (n.includes('wavenet')) score += 40;
  const lang = (v.lang || '').toLowerCase();
  if (lang === 'zh-cn' || lang === 'zh_cn') score += 25;
  else if (lang.startsWith('zh')) score += 20;
  return score;
}

function isFemaleVoice(v) {
  const n = (v.name || '').toLowerCase();
  return ['female', '女', 'xiaochen', 'xiaomeng', 'xiaoxiao', 'xiaoyi', 'xiaohan', 'xiaomo', 'xiaorui',
          'xiaoxuan', 'xiaoqiu', 'xiaoshuang', 'yaoyao', 'huihui', 'tingting',
          'mei-jia', 'meijia', 'sin-ji', 'yuna'].some(h => n.includes(h));
}
function isMaleVoice(v) {
  const n = (v.name || '').toLowerCase();
  return ['male', '男', 'yunxi', 'yunyang', 'yunjian', 'yunfeng', 'yunhao',
          'yunze', 'kangkang', 'daniel'].some(h => n.includes(h));
}

function pickLocalVoiceForSpeaker(speakerName) {
  const pool = voiceState.femaleVoices;
  if (pool && pool.length) {
    return pool[hashString(speakerName || 'default') % pool.length];
  }
  return voiceState.voice || null;
}

// ========== 初始化 ==========
function warmUpLocalVoices() {
  if (typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.getVoices();
    loadVoices();
  } catch (_) {}
}

function initVoice() {
  if (!('speechSynthesis' in window)) {
    console.warn('浏览器不支持语音合成');
    voiceState.edgeAvailable = true; // 仍可用 Edge TTS + <audio>
  }
  loadVoices();
  warmUpLocalVoices();
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  // iOS / 部分安卓 WebView：voices 异步注入，延迟再扫一轮
  const delays = isIOSOrWeChatWebView() ? [120, 450, 1200] : [80, 400];
  delays.forEach(ms => setTimeout(warmUpLocalVoices, ms));
  // 首次触摸即解锁音频（被动监听，不占手势）
  if (typeof document !== 'undefined' && !document.documentElement.dataset.audioUnlockBound) {
    document.documentElement.dataset.audioUnlockBound = '1';
    const once = () => {
      unlockMobileAudioPlayback();
      document.removeEventListener('touchstart', once);
      document.removeEventListener('click', once);
    };
    document.addEventListener('touchstart', once, { passive: true });
    document.addEventListener('click', once);
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

/** 移动端单次 SSML 不宜过长（易超时 / 弱网失败），按标点切分为多段依次播放 */
function splitTextForEdgeTTS(text, maxChunk = 720) {
  const t = (text || '').trim();
  if (!t) return [];
  if (t.length <= maxChunk) return [t];
  const out = [];
  let rest = t;
  while (rest.length > maxChunk) {
    const slice = rest.slice(0, maxChunk);
    let cut = -1;
    const punctIdx = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('；'),
      slice.lastIndexOf('\n'),
    );
    const commaIdx = slice.lastIndexOf('，');
    if (punctIdx >= Math.floor(maxChunk * 0.32)) cut = punctIdx + 1;
    else if (commaIdx >= Math.floor(maxChunk * 0.32)) cut = commaIdx + 1;
    else cut = maxChunk;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [t];
}

async function edgeTTSSynthesizeWithRetry(text, voiceName, rate, timeoutMs, extraRetries) {
  let lastErr;
  const tries = 1 + (extraRetries || 0);
  for (let i = 0; i < tries; i++) {
    try {
      return await edgeTTSSynthesize(text, voiceName, rate, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i + 1 < tries) await new Promise(r => setTimeout(r, 380));
    }
  }
  throw lastErr;
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
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-160kbitrate-mono-mp3"}}}}';
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
  if (voiceState.enabled) unlockMobileAudioPlayback();
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
  const a = voiceState.currentAudio || voiceState.sharedPlaybackAudio;
  if (a) {
    try {
      a.pause();
      a.removeAttribute('src');
      a.load();
    } catch (_) {}
  }
  voiceState.currentAudio = null;
}

function speak(text, speakerName = '') {
  if (!voiceState.enabled || !text) return;
  unlockMobileAudioPlayback();
  voiceState.queue.push({ text, speakerName });
  if (!voiceState.processing) processQueue();
}

function autoPlayAll(startElement) {
  console.log('🎵 启动自动连续播放模式');
  unlockMobileAudioPlayback();
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

  // 组装朗读脚本：先说「某某说」再读正文（用逗号停顿，避免冒号被 TTS 吞成只念人名）
  const fullText = item.speakerName
    ? `${item.speakerName}说，${item.text}`
    : item.text;

  try {
    const preferLocal = shouldPreferLocalSpeechOverEdge();
    if (voiceState.useEdgeTTS && voiceState.edgeAvailable && !preferLocal) {
      await speakViaEdge(fullText, item);
      voiceState.edgeFailStreak = 0;
    } else {
      await speakViaLocal(fullText, item);
    }
  } catch (err) {
    console.warn('Edge TTS 失败，回退本地语音:', err && err.message);
    voiceState.edgeFailStreak = (voiceState.edgeFailStreak || 0) + 1;
    const maxFailsBeforeEdgeOff = isMobileLikeDevice() ? 5 : 3;
    if (voiceState.edgeFailStreak >= maxFailsBeforeEdgeOff) voiceState.edgeAvailable = false;
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

// Edge 在线神经语音播放（可分多段，适配手机弱网与扬声器）
async function speakViaEdge(text, item) {
  warmUpLocalVoices();
  unlockMobileAudioPlayback();
  const voiceName = getEdgeVoiceForSpeaker(item.speakerName);
  const mobile = isMobileLikeDevice();
  const rateMul = mobile ? 0.91 : 1;
  const effectiveRate = Math.max(0.72, Math.min(1.18, voiceState.rate * rateMul));
  const maxChunk = mobile ? 520 : 880;
  const timeoutMs = mobile ? 22000 : 12000;
  const extraRetries = mobile ? 1 : 0;

  const parts = splitTextForEdgeTTS(text, maxChunk);
  console.log('🎙️ Edge TTS:', { voice: voiceName, rate: effectiveRate, chunks: parts.length });

  function playBlobUrl(url) {
    return new Promise((resolve, reject) => {
      const audio = getSharedPlaybackAudio();
      audio.volume = 1;

      let settled = false;
      const detach = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        audio.removeEventListener('pause', onPause);
      };
      const finishOk = () => {
        if (settled) return;
        settled = true;
        detach();
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        if (voiceState.currentAudio === audio) voiceState.currentAudio = null;
        resolve();
      };
      const finishErr = (e) => {
        if (settled) return;
        settled = true;
        detach();
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        if (voiceState.currentAudio === audio) voiceState.currentAudio = null;
        reject(e);
      };

      function onEnded() {
        finishOk();
      }
      function onErr() {
        finishErr(new Error('audio 播放失败'));
      }
      function onPause() {
        if (audio.ended) return;
        if (!voiceState.isSpeaking) finishOk();
      }

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onErr);
      audio.addEventListener('pause', onPause);

      voiceState.currentAudio = audio;

      try {
        audio.pause();
      } catch (_) {}
      audio.src = url;
      try {
        audio.muted = false;
      } catch (_) {}
      try {
        audio.load();
      } catch (_) {}

      unlockMobileAudioPlayback();

      audio
        .play()
        .catch(() => {
          unlockMobileAudioPlayback();
          primeSharedPlaybackAudioFromGesture();
          return audio.play();
        })
        .catch((e) =>
          finishErr(e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'audio.play 被拒绝'))
        );
    });
  }

  for (let i = 0; i < parts.length; i++) {
    if (!voiceState.isSpeaking) return;
    const url = await edgeTTSSynthesizeWithRetry(parts[i], voiceName, effectiveRate, timeoutMs, extraRetries);
    if (!voiceState.isSpeaking) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
      return;
    }
    await playBlobUrl(url);
  }
}

// 本地 Web Speech 播放（回退）
function speakViaLocal(text, item) {
  return new Promise((resolve, reject) => {
    if (typeof SpeechSynthesisUtterance === 'undefined') {
      reject(new Error('浏览器不支持 Web Speech'));
      return;
    }

    warmUpLocalVoices();

    unlockMobileAudioPlayback();

    const utter = new SpeechSynthesisUtterance(text);
    const speaker = item.speakerName;
    const cfg = getCelebrityVoiceConfig(speaker);

    const voice = pickLocalVoiceForSpeaker(speaker);
    if (voice) utter.voice = voice;

    utter.lang = 'zh-CN';
    const mobile = isMobileLikeDevice();
    let pitch = cfg.pitch;
    let rateMul = cfg.rate * voiceState.rate;
    if (mobile) {
      rateMul *= 0.88;
      pitch = Math.min(1.12, pitch * 1.03);
    }
    utter.pitch = Math.max(0.85, Math.min(1.15, pitch));
    utter.rate = Math.max(0.75, Math.min(1.22, rateMul));

    try {
      utter.volume = 1;
    } catch (_) {}

    console.log('🗣️ 本地语音（统一女声）:', {
      speaker,
      voice: utter.voice ? utter.voice.name : 'default',
      pitch: utter.pitch,
      rate: utter.rate,
      mobile,
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
    try {
      if (speechSynthesis.paused) speechSynthesis.resume();
    } catch (_) {}
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
  voiceState.edgeAvailable = true;
  voiceState.edgeFailStreak = 0;
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
window.unlockMobileAudioPlayback = unlockMobileAudioPlayback;

/** 气泡朗读按钮 touchstart/pointerdown：重置解锁标记并再走一遍移动端音频解锁（须与用户触碰同栈） */
function primeVoicePlaybackFromBubble() {
  voiceState.sharedPlaybackPrimed = false;
  unlockMobileAudioPlayback();
}
window.primeVoicePlaybackFromBubble = primeVoicePlaybackFromBubble;

// 风玲语音风格预设（作用于统一女声 pitch/rate）
window.FENGLING_VOICE_STYLES = {
  '知性优雅': { pitch: 1.05, rate: 1.00 },
  '温柔甜美': { pitch: 1.10, rate: 0.95 },
  '干练利落': { pitch: 1.00, rate: 1.10 },
  '沉稳大气': { pitch: 0.98, rate: 0.95 },
  '活泼亲切': { pitch: 1.10, rate: 1.05 },
};

function setFenglingVoiceStyle(styleName) {
  const style = window.FENGLING_VOICE_STYLES[styleName];
  if (style) {
    Object.assign(CELEBRITY_VOICE_PROFILES.default_female, style);
    console.log('✅ 统一女声语调已设置为:', styleName, style);
  }
}
window.setFenglingVoiceStyle = setFenglingVoiceStyle;
