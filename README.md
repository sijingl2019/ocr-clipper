# OCR Clipper

一个通用的 Chrome OCR 扩展：对当前网页截屏（可滚动拼接长图），交给**本机智能体**（Claude Code / Codex / Hermes / 自定义命令）识别文字，自动判断并点击"下一页"连续采集，最后整理导出为 **EPUB / PDF / TXT / Markdown / HTML**。

## 架构

```
Chrome 扩展（侧边栏）                       本机 host（Node.js，Native Messaging）
├─ 截屏：浏览器内置 / 系统静默区域截取  ──►  captureRegion（PowerShell / screencapture / grim）
├─ 截屏：系统截图 / PixPin / Snipaste   ──►  screenshot（唤起工具 → 等待剪贴板 / 输出文件）
├─ 拼接长图 + 按空白行切片
├─ OCR / 下一页判断                     ──►  runAgent（claude -p / codex exec / hermes chat …）
├─ 自动翻页：规则 → 智能体（截图 + 候选元素）→ 记住按钮 → 可信点击
└─ 导出：EPUB（自带 zip）/ PDF（Page.printToPDF）/ TXT / MD / HTML
```

浏览器扩展无法直接运行本机程序，所以运行智能体和调用系统截图工具都通过 `host/` 下的 Native Messaging host 完成。

## 安装

1. 需要 Node.js 18+，以及至少一个智能体 CLI（如 `claude`、`codex`）。
2. 注册本机 host（仅当前用户，写入 `HKCU\Software\Google\Chrome\NativeMessagingHosts` 等）：
   - Windows：`powershell -ExecutionPolicy Bypass -File host\install-windows.ps1`
   - macOS / Linux：`sh host/install.sh`
3. 打开 `chrome://extensions`，开启"开发者模式"，点击"加载已解压的扩展程序"，选择本项目根目录。
   manifest 中内置了固定 key，扩展 ID 固定为 `alniecnjlgpfdfolhnmflgcjmomdianc`，与安装脚本一致。
4. 点击工具栏图标打开侧边栏 → 设置 → "检测连接 / 可用工具"。

卸载 host：`host\uninstall-windows.ps1`。

## 使用

- **当前页面截屏 → OCR**：默认调用系统截图工具（Windows 截图工具 / macOS screencapture / Linux gnome-screenshot），框选后自动读取结果并识别。
- **连续翻页截屏 → OCR**：默认用系统静默截取浏览器视口（不需要每页手动框选），可以滚动拼接长图；也可以改为浏览器内置截取，或每页手动框选。截完一页后，OCR 在后台进行，同时自动翻页继续截取。
- **截屏工具**：系统自带 / PixPin（发送快捷键 F1 唤起，框选后按 Ctrl+C 复制）/ Snipaste（运行 `Snipaste.exe snip`）/ 自定义命令 / 浏览器内置。快捷键、路径都可以在设置中修改。
- **下一页识别**：
  - 自动：先用规则匹配（`rel=next`、"下一页 / 下一章 / Next / ›" 等文字和 class），找不到时把视口截图和可点击元素列表发给智能体判断；
  - 智能体可以返回元素编号，也可以返回坐标（适用于 canvas 渲染的阅读器）；
  - 选中过的按钮会被记住，后续页面直接复用，不再询问智能体；
  - 普通 click 无效时改用 DevTools 协议发送真实鼠标事件；
  - 也可以指定 CSS 选择器，或用模拟按键（如 ArrowRight）翻页。
  - 页面内容不再变化 / 与上一页相同 / 智能体判断没有下一页时自动停止。
- **结果**：每一页都可以预览截图、修改文字、调整顺序、重新识别、删除。
- **导出**：支持合并跨页截断的段落、按标题 / 每页 / 不分章划分章节，可附带原始截图。PDF 通过 `Page.printToPDF` 生成带文字层的 PDF，失败时打开打印对话框。

## 智能体命令模板

| 占位符 | 含义 |
| --- | --- |
| `{image}` | 待识别图片的绝对路径（PNG） |
| `{prompt}` | 提示词全文 |
| `{prompt_file}` | 写有提示词的文件 |
| `{out_file}` | 输出文件；命令写入了它就以它为结果，否则取 stdout |
| `{workdir}` | 本次调用的临时目录 |

默认预设：

- Claude Code：`claude -p --output-format text --allowedTools Read --add-dir {workdir}`，提示词从 stdin 传入
- Codex：`codex exec --skip-git-repo-check -s read-only -o {out_file} -i {image}`，提示词从 stdin 传入
- Hermes：`hermes chat -q {prompt}`（不同版本的参数可能不一样，请按需修改）

## 开发

```
npm test        # 单元测试 + host 端到端测试（用 node 充当假智能体）
npm run icons   # 重新生成图标
npm run build   # 打包应用店上传包 dist/ocr-clipper-<version>.zip
```

## 发布到 Chrome 网上应用店

1. 修改 `manifest.json` 的 `version`，运行 `npm run build`。打包时会去掉 manifest 中的 `key`（应用店不接受这个字段），并且只打包 `manifest.json`、`src/`、`icons/`。
2. 在 [Chrome 网上应用店开发者控制台](https://chrome.google.com/webstore/devconsole) 上传 zip，按 `store/STORE_LISTING.md` 填写说明、权限理由和数据使用披露，隐私权政策填 `store/PRIVACY.md` 的链接。
3. 发布后应用店会分配新的扩展 ID。本机 host 需要授权这个 ID，用户安装时这样运行（可以和开发版 ID 同时授权）：
   - Windows：`powershell -ExecutionPolicy Bypass -File host\install-windows.ps1 -ExtensionId <应用店ID>,alniecnjlgpfdfolhnmflgcjmomdianc`
   - macOS / Linux：`sh host/install.sh <应用店ID> alniecnjlgpfdfolhnmflgcjmomdianc`

   未授权时，侧边栏的 host 状态提示里会显示当前扩展 ID 和需要运行的命令。

调试日志：`%TEMP%\ocr-clipper-host.log`。
