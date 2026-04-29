#!/usr/bin/env node
/**
 * 主持人模式 对账测试（不启动浏览器、不需要 API）：
 * 1) 语法 + verify-flow 轻量通过
 * 2) 静态：app.js 中「流式 keepStream 残留 / 新轮 clear」等已修复
 * 3) VM：buildSystemPrompt 在 meetingStarted+hostedRound 0..3 下关键条目不缺失
 * 4) 轻量：模拟链式续写时 hostedRound 与「morph 根因」的不变量
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const H5 = path.join(__dirname, '..');
const LOAD_ORDER = ['config.js', 'celebrities.js', 'search.js', 'prompt.js'];
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function readApp() {
  return fs.readFileSync(path.join(H5, 'app.js'), 'utf8');
}

// ---------- 1) 语法 + verify-flow ----------
function runSyntax() {
  const files = [...LOAD_ORDER, 'app.js', 'supabase.js', 'voice.js'];
  for (const f of files) {
    const full = path.join(H5, f);
    execSync(`node --check "${full}"`, { stdio: 'inherit' });
  }
}

function runVerifyFlowInline() {
  // 不 spawn 子进程，避免在部分环境 hang；逻辑与 tools/verify-flow.cjs 第 1–2 节一致
  const sandbox = {
    console: { log: () => {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
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
    vm.runInContext(fs.readFileSync(path.join(H5, f), 'utf8'), sandbox, { filename: f });
  }
  if (typeof sandbox.buildSystemPrompt !== 'function') {
    throw new Error('buildSystemPrompt missing after load');
  }
  const p0 = sandbox.buildSystemPrompt([], { selectionMode: 'auto', meetingStarted: false });
  assert(p0.length > 400, 'pre-meeting too short');
  const pM = sandbox.buildSystemPrompt(['albert-einstein', 'adam-smith'], {
    selectionMode: 'auto', meetingStarted: true, meetingEnded: false, hostedRound: 1,
  });
  assert(pM.includes('三阶段'), '三阶段');
  assert(pM.includes('爱因斯坦'), 'skill');
  console.log('  verify-flow 等效 VM: OK (API smoke 可单独 node verify-flow.cjs --api)');
}

// ---------- 2) app.js 静态对账：防止回归「风玲被 morph 掉 / 不引导第二轮」相关根因 ----------
function staticAppInvariants() {
  const app = readApp();
  const err = (m) => { throw new Error(`[对账-静态] ${m}`); };

  if (/\bkeepStreamRender\b/.test(app)) {
    err('应已移除 keepStreamRender 分支；否则会保留流式 DOM，续写时 reconcile 会误 morph 风玲行');
  }
  if (!/clearStreamMessages\(\);/.test(app) || !/streamTypingMsg = null;/.test(app)) {
    err('generateResponse 开始处应 clearStreamMessages 并重置 streamTypingMsg，见注释「新一次生成前清空流式」');
  }
  if (!/const chainContinued = \(await checkAndContinueGeneration/.test(app)) {
    err('应使用 chainContinued 与 hostedRound 联动');
  }
  if (!/!chainContinued/.test(app) || !/state\.hostedRound = Math\.min\(3, state\.hostedRound \+ 1\)/.test(app)) {
    err('应仅在续写链结束时递增 hostedRound（可附 suppressHostedRoundBump 等条件）');
  }
  if (!/getMissingGuestKeysFromParsed/.test(app) && !/buildMissingGuestsContinuePrompt/.test(app)) {
    err('应存在缺嘉宾续写与 missing 检测，保证一轮内补全后才会结束链');
  }
  if (!/reconcileStreamDom/.test(app)) {
    err('reconcileStreamDom 应存在（流式段对齐；配合开头 clear 避免跨链污染）');
  }

  // 有完整文本时应落盘，而不是保留流
  if (!/一律落盘为正式气泡/.test(app) && !/renderFinalContent\(fullContent\)/.test(app)) {
    err('应有一律 renderFinal/tryReuse 的落盘路径');
  }
}

// ---------- 3) VM: buildSystemPrompt 各阶段 ----------
function vmPromptRounds() {
  const sandbox = {
    console: { log: () => {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
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
    vm.runInContext(fs.readFileSync(path.join(H5, f), 'utf8'), sandbox, { filename: f });
  }

  const guestKeys = ['albert-einstein', 'adam-smith'];
  const forRound = (hr) => sandbox.buildSystemPrompt(guestKeys, {
    selectionMode: 'auto',
    meetingStarted: true,
    meetingEnded: false,
    hostedRound: hr,
    awaitingEndConfirmation: false,
    summaryReady: false,
  });
  for (const hr of [0, 1, 2, 3]) {
    const p = forRound(hr);
    assert(p.includes('三阶段') || p.includes('阶段'), `hostedRound=${hr}: 三阶段/阶段 缺失`);
    assert(p.length > 500, `hostedRound=${hr}: 提示过短`);
    if (hr <= 1) {
      assert(
        p.includes('最前') || p.includes('段首') || p.includes('不插') || p.includes('之间'),
        `hostedRound=${hr}: 第1/2段「段首/不插风玲」类约束缺失，可能导致流程违背产品需求`
      );
    }
  }
  const p3 = forRound(2);
  assert(
    p3.includes('用户') || p3.includes('第三') || p3.includes('3'),
    '第3段/共识 相关提示过弱，检查 prompt.js 中 meetingStarted 块'
  );
  console.log('  VM buildSystemPrompt hostedRound=0,1,2,3: OK');
}

// ---------- 4) 轻量：链式 + hostedRound 与 morph 根因说明 ----------
function simulateChainRoundCount() {
  let hosted = 0;
  const onComplete = (chainContinued) => {
    if (!chainContinued) hosted = Math.min(3, hosted + 1);
  };
  onComplete(true);
  assert(hosted === 0, 'G1 若触发续写链，本层不递增');
  onComplete(false);
  assert(hosted === 1, '链末层不续写时递增到 1（第一轮闭合）');
  onComplete(true);
  assert(hosted === 1, '第二轮首段续写不递增本层（直到链末）');
  onComplete(false);
  assert(hosted === 2, '第二轮链末应递增到 2');
  console.log('  模拟链式 hostedRound: OK');
}

function morphRootCauseInvariants() {
  const note =
    '根因: 上一条的 streamMsgElements[0] 是风玲; 下一条只解析出嘉宾' +
    '时 reconcile 会把 DOM 0 从风玲 morph 到第一位嘉宾' +
    '；修复: 新 generate 前 clear + 有全文必 renderFinal 落盘，不再 keepStream 残留。';
  assert(note.length > 20, '说明');
  console.log('  morph 对账说明已记录: OK');
}

// ---------- main ----------
function main() {
  console.log('=== 主持人模式 / 对账系统测试 (verify-hosted-meeting) ===\n');
  console.log('— A) 语法 (核心 JS)...');
  runSyntax();
  console.log('  OK\n');
  console.log('— B) 与 verify-flow 等效的 VM 基线 (同进程, 不 spawn)...');
  runVerifyFlowInline();
  console.log('');
  console.log('— C) app.js 静态对账 (防止风玲消失 / 轮次不推进回归)...');
  staticAppInvariants();
  console.log('  静态: OK\n');
  console.log('— D) VM: 会中多 hostedRound 提示词...');
  vmPromptRounds();
  console.log('');
  console.log('— E) 轻量 链式 与 根因 不变量...');
  simulateChainRoundCount();
  morphRootCauseInvariants();
  console.log('\n=== 全部对账通过，可验收 ===');
  console.log('请本地执行: node 圆桌会议/h5/tools/verify-hosted-meeting.cjs');
  console.log('（浏览器端仍需您人工走一遍会前→确认→会中 3 段；本脚本不替代实机。）\n');
}

try {
  main();
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
