// 导出：EPUB / PDF / TXT / Markdown / HTML
import { listPages, pageText } from './db.js';
import { combinePages, splitChapters, firstHeading } from './book.js';
import { markdownToHtml, markdownToText, escapeHtml } from './markdown.js';
import { createZip } from './zip.js';
import { blobToBase64 } from './image.js';
import { printToPDF } from './cdp.js';
import { kvSet, kvDel } from './kv.js';

const BOOK_CSS = `
body { font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif; line-height: 1.8; margin: 0 5%; }
h1, h2, h3 { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; line-height: 1.4; }
p { text-indent: 2em; margin: 0.4em 0; }
img { max-width: 100%; display: block; margin: 1em auto; }
table { border-collapse: collapse; margin: 1em 0; }
td, th { border: 1px solid #999; padding: 0.3em 0.6em; }
blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
pre { white-space: pre-wrap; background: #f5f5f5; padding: 0.8em; }
`;

const sanitizeName = (s) => (s || 'ocr-clipper').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || 'ocr-clipper';

function replaceImageMarks(html, srcOf) {
  return html.replace(/<p>@@IMG:(\d+)@@<\/p>/g, (_, i) => `<img src="${srcOf(+i)}" alt=""/>`);
}

export async function buildBook(settings) {
  const pages = (await listPages()).filter((p) => p.status === 'done' || pageText(p));
  if (!pages.length) throw new Error('没有可导出的 OCR 结果');
  const opts = { mergeAcrossPages: settings.mergeAcrossPages, includeImages: settings.includeImages };
  const items = pages.map((p) => ({ text: pageText(p), images: p.slices }));
  const { md, images } = combinePages(items, opts);
  const title = settings.bookTitle || firstHeading(md) || pages[0].title || 'OCR Clipper';
  let chapters;
  if (settings.chapterMode === 'page') {
    // 按页分章时，每页单独组合（含该页图片标记）
    let offset = 0;
    chapters = items.map((it, i) => {
      const marks = opts.includeImages ? it.images.map((_, k) => `@@IMG:${offset + k}@@`).join('\n\n') : '';
      if (opts.includeImages) offset += it.images.length;
      return { title: firstHeading(it.text) || `第 ${i + 1} 页`, md: [marks, it.text].filter(Boolean).join('\n\n') };
    });
  } else {
    chapters = splitChapters(md, { mode: settings.chapterMode, fallbackTitle: title });
  }
  return { title, author: settings.bookAuthor || '', md, chapters, images };
}

export async function exportBook(settings) {
  const book = await buildBook(settings);
  const name = sanitizeName(book.title);
  switch (settings.exportFormat) {
    case 'md':
      return download(new Blob([book.md.replace(/^@@IMG:\d+@@$/gm, '')], { type: 'text/markdown' }), `${name}.md`);
    case 'txt':
      return download(new Blob([markdownToText(book.md.replace(/^@@IMG:\d+@@$/gm, ''))], { type: 'text/plain' }), `${name}.txt`);
    case 'html':
      return download(new Blob([await toHtml(book)], { type: 'text/html' }), `${name}.html`);
    case 'pdf':
      return exportPdf(book, name);
    case 'epub':
    default:
      return download(await toEpub(book), `${name}.epub`);
  }
}

export async function toHtml(book) {
  const srcs = await Promise.all(book.images.map(async (b) => `data:image/png;base64,${await blobToBase64(b)}`));
  const body = book.chapters
    .map((c) => replaceImageMarks(markdownToHtml(c.md), (i) => srcs[i]))
    .join('\n<div style="break-after: page"></div>\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(book.title)}</title>
<meta name="author" content="${escapeHtml(book.author)}"/>
<style>${BOOK_CSS} body { max-width: 46em; margin: 2em auto; padding: 0 1em; }</style></head>
<body>${body}</body></html>`;
}

export async function toEpub(book) {
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [];
  const manifest = [];
  const spine = [];
  const navItems = [];
  const ncxPoints = [];

  book.images.forEach((blob, i) => {
    files.push({ name: `OEBPS/images/img${i + 1}.png`, data: blob, store: true });
    manifest.push(`<item id="img${i + 1}" href="images/img${i + 1}.png" media-type="image/png"/>`);
  });

  book.chapters.forEach((c, i) => {
    const id = `chap${String(i + 1).padStart(3, '0')}`;
    let body = replaceImageMarks(markdownToHtml(c.md), (k) => `images/img${k + 1}.png`);
    if (!/^<h[1-6]>/.test(body)) body = `<h2>${escapeHtml(c.title)}</h2>\n${body}`;
    files.push({
      name: `OEBPS/${id}.xhtml`,
      data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeHtml(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body></html>`,
    });
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="${id}.xhtml">${escapeHtml(c.title)}</a></li>`);
    ncxPoints.push(
      `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${id}.xhtml"/></navPoint>`
    );
  });

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${escapeHtml(book.title)}</dc:title>
<dc:language>zh-CN</dc:language>
${book.author ? `<dc:creator>${escapeHtml(book.author)}</dc:creator>` : ''}
<meta property="dcterms:modified">${now}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>
${navItems.join('\n')}
</ol></nav></body></html>`;

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${escapeHtml(book.title)}</text></docTitle>
<navMap>${ncxPoints.join('\n')}</navMap>
</ncx>`;

  return createZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: BOOK_CSS },
    ...files,
  ]).then((b) => new Blob([b], { type: 'application/epub+zip' }));
}

// PDF：在后台标签页打开排版好的 HTML，用 DevTools 协议 Page.printToPDF 生成真正的文本 PDF；
// 若失败（例如被其他调试器占用），退回到浏览器打印对话框，由用户选择"另存为 PDF"。
async function exportPdf(book, name) {
  const key = `print-${Date.now()}`;
  await kvSet(key, { html: await toHtml(book), title: book.title });
  const url = chrome.runtime.getURL(`src/print/print.html?key=${key}`);
  const tab = await chrome.tabs.create({ url, active: false });
  await waitTabComplete(tab.id);
  await new Promise((r) => setTimeout(r, 800));
  try {
    const b64 = await printToPDF(tab.id);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await chrome.tabs.remove(tab.id);
    await kvDel(key);
    return download(new Blob([bytes], { type: 'application/pdf' }), `${name}.pdf`);
  } catch (e) {
    console.warn('printToPDF 失败，改用打印对话框', e);
    await chrome.tabs.update(tab.id, { url: `${url}&dialog=1`, active: true });
    return { dialog: true };
  }
}

async function waitTabComplete(tabId) {
  for (let i = 0; i < 50; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    // 直接保存到浏览器默认下载目录（若浏览器设置了"下载前询问保存位置"，仍会弹出对话框）
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
    return { id, filename };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
