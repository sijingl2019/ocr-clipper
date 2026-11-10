import { loadSettings, saveSettings, AGENT_PRESETS, SCREENSHOT_TOOLS, DEFAULT_OCR_PROMPT, DEFAULT_NEXT_PROMPT } from '../lib/settings.js';
import { Runner, ocrPage } from '../lib/runner.js';
import { listPages, getPage, updatePage, deletePage, clearPages, swapSeq, pageText } from '../lib/db.js';
import { exportBook } from '../lib/export.js';
import { callHost, pingHost } from '../lib/native.js';
import { ocrImage } from '../lib/agent.js';
import { captureViewportBlob } from '../lib/capture.js';
import { base64ToBlob } from '../lib/image.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let settings = await loadSettings();

// ---------- 通用 ----------
function log(msg, isErr = false) {
  const li = document.createElement('li');
  if (isErr) li.className = 'err';
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString();
  li.append(t, msg);
  $('#log').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 250);
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^(https?|file):/.test(tab.url || '')) throw new Error('请在普通网页标签页上使用（不支持 chrome:// 等内部页面）');
  return tab;
}

// ---------- 标签页切换 ----------
for (const b of $$('.tabs button')) {
  b.onclick = () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'results') renderPages();
  };
}

// ---------- data-key 绑定 ----------
function bindSimpleFields() {
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? '';
    el.addEventListener('change', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      persist();
      refreshVisibility();
    });
  }
  for (const r of $$('input[name=mode]')) {
    r.checked = r.value === settings.mode;
    r.onchange = () => {
      settings.mode = r.value;
      persist();
      refreshVisibility();
    };
  }
}

function refreshVisibility() {
  document.body.classList.toggle('continuous', settings.mode === 'continuous');
  $('.strategy-selector').style.display = settings.nextStrategy === 'selector' ? '' : 'none';
  $('.strategy-key').style.display = settings.nextStrategy === 'key' ? '' : 'none';
  const tool = settings.tools[settings.screenshotTool];
  const hints = {
    system: '调用系统自带截图（Windows：截图工具 Win+Shift+S 同款；macOS：screencapture；Linux：gnome-screenshot），框选后结果自动读取。',
    hotkey: `发送快捷键 ${tool?.hotkey || ''} 唤起截图软件，框选后请复制到剪贴板（PixPin / Snipaste 中按 Ctrl+C 或点"复制"）。`,
    command: '运行命令唤起截图软件，框选后复制到剪贴板（或写入输出文件）。',
    browser: '使用浏览器内置截取当前可视区域，无需框选，可滚动拼接长图。',
  };
  $('#toolHint').textContent = hints[tool?.trigger] || '';
}

// ---------- 智能体编辑 ----------
function fillAgentSelect() {
  $('#agent').innerHTML = Object.entries(settings.agents)
    .map(([k, a]) => `<option value="${k}">${a.label || k}</option>`)
    .join('');
  $('#agent').value = settings.agent;
}

function loadAgentEditor() {
  const a = settings.agents[$('#agent').value] || {};
  $('#agentCommand').value = a.command || '';
  $('#agentArgs').value = JSON.stringify(a.args || []);
  $('#agentStdin').value = a.stdin || '';
}

function saveAgentEditor() {
  const a = settings.agents[$('#agent').value];
  a.command = $('#agentCommand').value.trim();
  a.stdin = $('#agentStdin').value;
  try {
    const args = JSON.parse($('#agentArgs').value || '[]');
    if (!Array.isArray(args)) throw new Error();
    a.args = args.map(String);
    $('#agentArgs').style.borderColor = '';
  } catch {
    $('#agentArgs').style.borderColor = 'var(--danger)';
    return;
  }
  persist();
}

$('#agent').addEventListener('change', loadAgentEditor);
for (const id of ['#agentCommand', '#agentArgs', '#agentStdin']) $(id).addEventListener('change', saveAgentEditor);
$('#resetAgentBtn').onclick = () => {
  const preset = AGENT_PRESETS[settings.agent];
  if (!preset) return;
  settings.agents[settings.agent] = structuredClone(preset);
  loadAgentEditor();
  persist();
};

// ---------- 截屏工具编辑 ----------
function fillToolSelects() {
  const opts = Object.entries(settings.tools)
    .map(([k, t]) => `<option value="${k}">${t.label || k}</option>`)
    .join('');
  $('#screenshotTool').innerHTML = opts;
  $('#screenshotTool').value = settings.screenshotTool;
  $('#toolEdit').innerHTML = opts;
  $('#toolEdit').value = settings.screenshotTool;
}

function loadToolEditor() {
  const t = settings.tools[$('#toolEdit').value] || {};
  $('#toolTrigger').value = t.trigger || 'command';
  $('#toolHotkey').value = t.hotkey || '';
  $('#toolCommand').value = t.command || '';
  $('#toolArgs').value = JSON.stringify(t.args || []);
  $('#toolOutput').value = t.output || 'clipboard';
  const trig = t.trigger;
  $$('.tool-hotkey').forEach((e) => (e.style.display = trig === 'hotkey' ? '' : 'none'));
  $$('.tool-command').forEach((e) => (e.style.display = trig === 'command' || trig === 'hotkey' ? '' : 'none'));
  $$('.tool-output').forEach((e) => (e.style.display = trig === 'command' ? '' : 'none'));
}

function saveToolEditor() {
  const t = settings.tools[$('#toolEdit').value];
  t.trigger = $('#toolTrigger').value;
  t.hotkey = $('#toolHotkey').value;
  t.command = $('#toolCommand').value.trim();
  t.output = $('#toolOutput').value;
  try {
    t.args = JSON.parse($('#toolArgs').value || '[]').map(String);
  } catch {}
  persist();
  loadToolEditor();
  refreshVisibility();
}

$('#toolEdit').addEventListener('change', loadToolEditor);
$('#screenshotTool').addEventListener('change', () => {
  $('#toolEdit').value = $('#screenshotTool').value;
  loadToolEditor();
});
for (const id of ['#toolTrigger', '#toolHotkey', '#toolCommand', '#toolArgs', '#toolOutput']) $(id).addEventListener('change', saveToolEditor);

$('#resetPromptsBtn').onclick = () => {
  settings.ocrPrompt = DEFAULT_OCR_PROMPT;
  settings.nextPrompt = DEFAULT_NEXT_PROMPT;
  $('#ocrPrompt').value = DEFAULT_OCR_PROMPT;
  $('#nextPrompt').value = DEFAULT_NEXT_PROMPT;
  persist();
};

// ---------- host ----------
async function checkHost(verbose) {
  const pill = $('#hostStatus');
  try {
    const info = await pingHost();
    pill.textContent = `host: ${info.platform}`;
    pill.className = 'pill ok';
    $('#hostSetup').hidden = true;
    if (verbose) {
      const det = await callHost('detect', {
        agents: Object.fromEntries(Object.entries(settings.agents).map(([k, a]) => [k, a.command])),
        tools: settings.tools,
      });
      $('#hostInfo').textContent = JSON.stringify({ ...info, ...det }, null, 2);
    }
  } catch (e) {
    pill.textContent = 'host: 未连接';
    pill.className = 'pill err';
    pill.title = e.message;
    // 只有找不到 host 时才显示安装指引；其他错误（如未授权）看 title / 日志
    $('#hostSetup').hidden = !/not found|not exist|Specified native messaging host/i.test(e.message);
    if (verbose) $('#hostInfo').textContent = e.message;
  }
}
$('#pingBtn').onclick = () => withBusy($('#pingBtn'), () => checkHost(true));
$('#recheckBtn').onclick = () => withBusy($('#recheckBtn'), () => checkHost(false));

$('#testAgentBtn').onclick = () =>
  withBusy($('#testAgentBtn'), async () => {
    const tab = await activeTab();
    $('#hostInfo').textContent = `正在用 ${settings.agent} 识别当前视口…`;
    const blob = await captureViewportBlob(tab.windowId);
    const t0 = Date.now();
    const text = await ocrImage(settings, blob);
    $('#hostInfo').textContent = `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n${text}`;
  });

$('#testShotBtn').onclick = () =>
  withBusy($('#testShotBtn'), async () => {
    const name = $('#toolEdit').value;
    const tool = settings.tools[name];
    if (tool.trigger === 'browser') {
      const tab = await activeTab();
      showPreview(await captureViewportBlob(tab.windowId));
      return;
    }
    $('#hostInfo').textContent = `已唤起 ${tool.label}，请框选并复制…`;
    const res = await callHost('screenshot', { name, tool, timeoutSec: settings.screenshotTimeoutSec });
    $('#hostInfo').textContent = `截图成功：${res.width || '?'}x${res.height || '?'}`;
    showPreview(base64ToBlob(res.png));
  });

function showPreview(blob) {
  const url = URL.createObjectURL(blob);
  $('#previewImg').src = url;
  $('#previewDlg').showModal();
  $('#previewDlg').addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
}

// ---------- 运行 ----------
let refreshTimer;
const scheduleRender = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(renderPages, 200);
};

const runner = new Runner({
  log,
  onPages: scheduleRender,
  onPageUpdate: scheduleRender,
  onState: (running) => {
    $('#startBtn').disabled = running;
    $('#stopBtn').disabled = !running;
  },
});

$('#startBtn').onclick = async () => {
  try {
    const tab = await activeTab();
    $('#log').innerHTML = '';
    log(`开始：${settings.mode === 'single' ? '当前页面' : '连续翻页'}，智能体 ${settings.agent}`);
    runner.start(structuredClone(settings), tab);
  } catch (e) {
    log(e.message, true);
  }
};
$('#stopBtn').onclick = () => runner.stop();

// ---------- 结果 ----------
const STATUS = { pending: '等待', ocr: '识别中', done: '完成', error: '失败' };

async function renderPages() {
  // 正在编辑某页文本时不重绘，避免打断输入
  if (document.activeElement?.matches?.('.page textarea')) {
    scheduleRender();
    return;
  }
  const pages = await listPages();
  $('#pageCount').textContent = pages.length;
  const box = $('#pages');
  box.replaceChildren(
    ...pages.map((p, idx) => {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.id = p.id;
      const img = document.createElement('img');
      img.src = p.thumb || '';
      img.onclick = async () => showPreview((await getPage(p.id)).slices[0]);
      const right = document.createElement('div');
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('span');
      title.className = 'title';
      title.title = p.url;
      title.innerHTML = `#${idx + 1} <span class="status-${p.status}">${STATUS[p.status] || p.status}</span> · ${p.slices.length} 切片 · `;
      title.append(p.title || p.url || '');
      const tools = document.createElement('span');
      tools.className = 'tools';
      const mk = (label, fn, tip) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = tip;
        b.onclick = fn;
        tools.append(b);
      };
      mk('↑', async () => idx > 0 && (await swapSeq(p.id, pages[idx - 1].id), renderPages()), '上移');
      mk('↓', async () => idx < pages.length - 1 && (await swapSeq(p.id, pages[idx + 1].id), renderPages()), '下移');
      mk('重识别', () => ocrPage(settings, p.id, { onUpdate: scheduleRender }), '重新 OCR');
      mk('删除', async () => confirm('删除这一页？') && (await deletePage(p.id), renderPages()), '删除');
      meta.append(title, tools);
      right.append(meta);
      if (p.error) {
        const err = document.createElement('div');
        err.className = 'err-text';
        err.textContent = p.error;
        right.append(err);
      }
      const ta = document.createElement('textarea');
      ta.rows = 5;
      ta.value = pageText(p);
      ta.placeholder = p.status === 'done' ? '（空）' : '等待识别…';
      ta.onchange = () => updatePage(p.id, { texts: [ta.value], status: 'done', error: '' });
      right.append(ta);
      el.append(img, right);
      return el;
    })
  );
}

$('#exportBtn').onclick = () =>
  withBusy($('#exportBtn'), async () => {
    const r = await exportBook(settings);
    if (r?.dialog) alert('自动生成 PDF 失败，已打开打印页面，请在打印对话框中选择"另存为 PDF"。');
  });

$('#reocrFailedBtn').onclick = () =>
  withBusy($('#reocrFailedBtn'), async () => {
    for (const p of await listPages()) {
      if (p.status === 'error' || p.status === 'pending') await ocrPage(settings, p.id, { onUpdate: scheduleRender });
    }
  });

$('#clearBtn').onclick = async () => {
  if (!confirm('清空全部已采集的页面？')) return;
  await clearPages();
  renderPages();
};

// ---------- 初始化 ----------
fillAgentSelect();
fillToolSelects();
bindSimpleFields();
loadAgentEditor();
loadToolEditor();
refreshVisibility();
renderPages();
checkHost(false);
