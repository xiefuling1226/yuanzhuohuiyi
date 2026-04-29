#!/usr/bin/env node
/**
 * 圆桌 H5 静态与轻量集成验证（不启动浏览器）：
 * 1) node --check 核心 JS
 * 2) VM 内按序加载 config → celebrities → search → prompt，调用 buildSystemPrompt 多状态
 * 3) 可选：--api 发一条非流式最小请求测 DeepSeek 连通（需网络；不打印密钥）
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const H5 = path.join(__dirname, '..');
const LOAD_ORDER = ['config.js', 'celebrities.js', 'search.js', 'prompt.js'];
const SYNTAX_FILES = [...LOAD_ORDER, 'app.js', 'supabase.js', 'voice.js'];

async function main() {
  const withApi = process.argv.includes('--api');

  console.log('— 1) Syntax check');
  for (const f of SYNTAX_FILES) {
    const full = path.join(H5, f);
    if (!fs.existsSync(full)) {
      console.error('Missing:', full);
      process.exit(1);
    }
    execSync(`node --check "${full}"`, { stdio: 'inherit' });
    console.log('  OK', f);
  }

  console.log('— 2) VM load + buildSystemPrompt');
  const sandbox = {
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: false, status: 0 }),
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const localPath = path.join(H5, 'config.local.js');
  if (fs.existsSync(localPath)) {
    vm.runInContext(fs.readFileSync(localPath, 'utf8'), sandbox, { filename: 'config.local.js' });
  }
  for (const f of LOAD_ORDER) {
    const code = fs.readFileSync(path.join(H5, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  vm.runInContext(
    `globalThis.__ROUND_TABLE_API__ = {
      apiEndpoint: CONFIG.apiEndpoint,
      apiKey: CONFIG.apiKey,
      model: CONFIG.model
    };`,
    sandbox
  );
  if (typeof sandbox.buildSystemPrompt !== 'function') {
    console.error('buildSystemPrompt is not a function after loading prompt.js');
    process.exit(1);
  }

  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  const p0 = sandbox.buildSystemPrompt([], {
    selectionMode: 'auto',
    meetingStarted: false,
  });
  assert(typeof p0 === 'string' && p0.length > 800, 'pre-meeting prompt too short');
  assert(p0.includes('会前') || p0.includes('推荐'), 'pre-meeting markers missing');

  const pMeet = sandbox.buildSystemPrompt(['albert-einstein', 'adam-smith'], {
    selectionMode: 'auto',
    meetingStarted: true,
    meetingEnded: false,
    hostedRound: 1,
  });
  assert(pMeet.includes('三阶段'), 'hosted meeting: 三阶段 missing');
  assert(pMeet.includes('爱因斯坦'), 'skill inject: 爱因斯坦');
  assert(pMeet.includes('亚当·斯密'), 'skill inject: 亚当·斯密');

  const pEnd = sandbox.buildSystemPrompt(['albert-einstein'], {
    selectionMode: 'auto',
    meetingStarted: true,
    meetingEnded: true,
  });
  assert(pEnd.includes('会后') || pEnd.includes('总结'), 'post-meeting block missing');

  const pMan = sandbox.buildSystemPrompt(['alan-turing'], {
    selectionMode: 'manual',
    meetingStarted: true,
  });
  assert(pMan.includes('无主持人'), 'manual mode rules missing');

  console.log('  buildSystemPrompt scenarios: OK');

  if (withApi) {
    console.log('— 3) API smoke (--api)');
    const CONFIG = sandbox.__ROUND_TABLE_API__;
    if (!CONFIG || !CONFIG.apiKey) {
      console.log('  Skip: 无 config.local.js 或未填写 apiKey（复制 config.example.local.js 为 config.local.js）');
    } else {
      assert(CONFIG.apiEndpoint, 'apiEndpoint missing');
      const res = await fetch(CONFIG.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model || 'deepseek-chat',
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 8,
        stream: false,
      }),
    });
    const text = await res.text();
    assert(res.ok, `API HTTP ${res.status}: ${text.slice(0, 200)}`);
    console.log('  API responded OK (status', res.status + ')');
    }
  } else {
    console.log('— 3) API smoke skipped (pass --api to test DeepSeek)');
  }

  console.log('\nAll checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
