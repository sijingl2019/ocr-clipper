# Chrome 网上应用店上架材料

上传包：`npm run build` 生成的 `dist/ocr-clipper-<version>.zip`。

## 基本信息

- **名称**：OCR Clipper
- **类别**：工具（Tools）
- **语言**：中文（简体）
- **简短说明（manifest description，≤132 字符）**：滚动截屏 + 本机智能体 OCR，自动翻页，导出 EPUB / PDF / TXT / Markdown / HTML

## 详细说明

OCR Clipper 把网页（包括 canvas 渲染、无法复制文字的在线阅读器）截屏后，交给你电脑上已安装的 AI 智能体（Claude Code、Codex CLI、Hermes 或自定义命令）识别文字，并整理导出为电子书或文档。

主要功能：
- 当前页面截屏识别，或连续自动翻页截屏识别
- 截屏工具可选：系统自带截图、PixPin、Snipaste、自定义命令、浏览器内置；支持滚动拼接整页长图
- 自动识别"下一页 / 下一章"按钮：规则匹配，必要时由智能体根据截图判断，支持 canvas 阅读器
- 每页结果可预览、编辑、调整顺序、重新识别
- 导出 EPUB、PDF（带文字层）、TXT、Markdown、HTML，可合并跨页断句、按标题分章

使用前需要安装配套的本机组件（Native Messaging host），用于调用本机智能体与截图工具，下载地址：https://github.com/sijingl2019/ocr-clipper/releases/latest/download/ocr-clipper-host.zip（解压后 Windows 双击 install-windows.cmd，macOS/Linux 运行 sh install.sh；侧边栏未连接时也会显示安装步骤）。所有截图和识别都在你的电脑上进行，扩展本身不会把数据上传到任何服务器。

## 单一用途说明（Single purpose）

把网页内容截屏并用用户本机的 AI 智能体识别为文字，整理导出为电子书 / 文档。

## 权限理由（Permission justification）

| 权限 | 理由 |
| --- | --- |
| `sidePanel` | 扩展的全部操作界面在侧边栏中，便于在阅读网页的同时进行采集。 |
| `tabs` | 获取当前标签页的 URL / 标题（记录每页来源、判断是否翻页成功），以及调用 captureVisibleTab 截取可视区域。 |
| `scripting` | 在用户启动采集的页面中注入脚本：测量滚动区域、滚动以拼接长图、查找"下一页"按钮并点击。 |
| `storage` / `unlimitedStorage` | 在本地保存设置，以及在 IndexedDB 中保存截图和识别结果（长书截图体积较大）。 |
| `nativeMessaging` | 与用户自行安装的本机组件通讯，用于运行本机 AI 智能体做 OCR、调用系统 / 第三方截图工具。 |
| `downloads` | 把导出的 EPUB / PDF / TXT 等文件保存到用户电脑。 |
| `debugger` | 许多阅读器只响应真实的鼠标 / 键盘事件，扩展通过 DevTools 协议发送可信点击 / 按键来翻页；并用 Page.printToPDF 生成带文字层的 PDF。仅在用户主动开始采集或导出时使用。 |
| 主机权限 `<all_urls>` | 用户可能在任意网站上使用该工具（各种在线阅读器、文档站点），需要在用户选择的页面上截屏和注入翻页脚本。 |

## 远程代码（Remote code）

不使用远程代码。所有脚本都包含在扩展包内。

## 数据使用披露（Data usage）

- 收集的数据：网站内容（用户主动截取的页面截图与识别出的文字）。
- 这些数据只保存在用户本地浏览器（IndexedDB）中，并通过 Native Messaging 交给用户本机安装的智能体程序处理；扩展不向开发者或任何第三方服务器发送数据。
- 不出售数据，不用于与核心功能无关的用途，不用于信用评估。

## 需要另外准备的素材

- 截图：至少 1 张，1280×800 或 640×400（建议：侧边栏 + 阅读页面、结果列表、导出的 EPUB / PDF）
- 小型宣传图块：440×280（可选）
- 隐私权政策网址：可直接使用仓库中的 `store/PRIVACY.md` 的 GitHub 链接
