// 点击工具栏图标即打开侧边栏；所有采集 / OCR / 导出流程都在侧边栏页面中运行，
// 避免 MV3 service worker 被回收导致长任务中断。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
