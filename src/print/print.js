import { kvGet, kvDel } from '../lib/kv.js';

const params = new URLSearchParams(location.search);
const key = params.get('key');
const data = key ? await kvGet(key) : null;

if (!data) {
  document.body.textContent = '打印内容已过期，请回到侧边栏重新导出。';
} else {
  const doc = new DOMParser().parseFromString(data.html, 'text/html');
  document.title = data.title || document.title;
  for (const style of doc.head.querySelectorAll('style')) document.head.appendChild(style);
  document.body.replaceChildren(...doc.body.childNodes);
  // 打印时去掉网页版的最大宽度限制
  const s = document.createElement('style');
  s.textContent = 'body { max-width: none !important; margin: 0 !important; padding: 0 !important; }';
  document.head.appendChild(s);
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  if (params.get('dialog') === '1') {
    await kvDel(key);
    setTimeout(() => print(), 300);
  }
}
