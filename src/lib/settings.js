// 设置的默认值与读写。命令模板中可用的占位符（由本机 host 替换）：
//   {image}     本次要识别的图片的绝对路径（PNG）
//   {prompt}    提示词全文（其中的 {image} 也会被替换）
//   {prompt_file} 写有提示词的临时文件路径
//   {out_file}  输出文件路径；若命令写入了该文件，则以它的内容作为结果，否则取 stdout
//   {workdir}   本次调用的临时工作目录

export const AGENT_PRESETS = {
  claude: {
    label: 'Claude Code',
    command: 'claude',
    args: ['-p', '--output-format', 'text', '--allowedTools', 'Read', '--add-dir', '{workdir}'],
    stdin: '{prompt}',
  },
  codex: {
    label: 'Codex CLI',
    command: 'codex',
    args: ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', '{out_file}', '-i', '{image}'],
    stdin: '{prompt}',
  },
  hermes: {
    label: 'Hermes Agent',
    command: 'hermes',
    args: ['chat', '-q', '{prompt}'],
    stdin: '',
  },
  custom: {
    label: '自定义命令',
    command: '',
    args: ['{prompt_file}', '{image}', '{out_file}'],
    stdin: '',
  },
};

// 截屏工具。trigger:
//   system  由 host 调用操作系统自带的截屏（Windows 截图工具 / macOS screencapture -i / Linux gnome-screenshot -a）
//   hotkey  发送全局快捷键唤起截图软件（PixPin 默认 F1），然后等待剪贴板出现新图片
//   command 运行命令唤起截图软件；output=clipboard 等待剪贴板，output=file 读取 {out_file}
export const SCREENSHOT_TOOLS = {
  system: { label: '系统自带截屏', trigger: 'system' },
  pixpin: { label: 'PixPin', trigger: 'hotkey', hotkey: '{F1}', command: '', args: [], output: 'clipboard' },
  snipaste: { label: 'Snipaste', trigger: 'command', command: '', args: ['snip'], output: 'clipboard' },
  custom: { label: '自定义截图命令', trigger: 'command', command: '', args: ['{out_file}'], output: 'file' },
  browser: { label: '浏览器内置（静默，支持滚动长截图）', trigger: 'browser' },
};

export const DEFAULT_OCR_PROMPT = `你是一个精确的 OCR 引擎。请读取并识别图片文件 {image} 中的全部文字。
要求：
1. 按阅读顺序输出为 Markdown，保留标题层级、段落、列表、表格、引用；
2. 忽略网页导航栏、菜单、广告、按钮、页眉页脚页码等界面元素，只保留正文；
3. 不要翻译、不要总结、不要改写、不要添加任何解释或前后缀；
4. 段落因换行被截断时请合并为完整段落；看不清的字用 □ 代替；
5. 若图片中没有正文，输出空字符串。
只输出识别出的 Markdown 正文。`;

export const DEFAULT_NEXT_PROMPT = `图片文件 {image} 是一个网页阅读界面当前视口的截图（视口大小 {viewport} CSS 像素，截图像素是 CSS 像素的 {scale} 倍）。
我想自动翻到"下一页 / 下一章 / 下一节"继续阅读。下面是页面中可点击元素的候选列表，格式为 [编号] 标签 "文字" @ (x,y,宽,高)（CSS 像素，相对视口左上角）：
{candidates}

请判断应该点击哪个元素进入下一页。
- 如果候选列表中有，输出 {"id": 编号}
- 如果下一页按钮不在列表中但截图中可见（例如画在 canvas 上），输出 {"x": 视口CSS横坐标, "y": 视口CSS纵坐标}
- 如果这是最后一页或找不到下一页，输出 {"id": null}
只输出一行 JSON，不要任何其他文字。`;

export const DEFAULT_SETTINGS = {
  agent: 'claude',
  agents: structuredClone(AGENT_PRESETS),
  agentTimeoutSec: 300,
  ocrPrompt: DEFAULT_OCR_PROMPT,
  nextPrompt: DEFAULT_NEXT_PROMPT,
  ocrConcurrency: 1,

  screenshotTool: 'system',
  tools: structuredClone(SCREENSHOT_TOOLS),
  screenshotTimeoutSec: 120,
  // 连续翻页模式下的截屏方式：
  //   system-region 由系统静默截取浏览器视口（无需手动框选），可滚动拼接
  //   browser       浏览器内置 captureVisibleTab，可滚动拼接
  //   interactive   每一页都调用上面选择的截屏工具，由你手动框选
  continuousCapture: 'system-region',
  scrollCapture: true,
  hideFixedAfterFirst: true,
  maxScrollCssPx: 40000,
  sliceHeightPx: 2400,

  mode: 'single', // single | continuous
  maxPages: 50,
  nextStrategy: 'auto', // auto | agent | selector | key
  nextSelector: '',
  nextKey: 'ArrowRight',
  settleMs: 1200,
  pageChangeTimeoutMs: 10000,

  bookTitle: '',
  bookAuthor: '',
  exportFormat: 'epub', // epub | pdf | txt | md | html
  includeImages: false,
  chapterMode: 'heading', // heading | page | single
  mergeAcrossPages: true,
};

// 合并已保存的设置与默认值（深度合并一层对象，保证新版本新增的字段有默认值）
export function mergeSettings(saved) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!saved) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        out[k][k2] = v2 && typeof v2 === 'object' && !Array.isArray(v2) ? { ...(out[k][k2] || {}), ...v2 } : v2;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeSettings(settings);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
