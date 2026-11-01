import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePages, splitChapters, shouldJoin } from '../src/lib/book.js';
import { markdownToHtml, markdownToText, joinSoftLines } from '../src/lib/markdown.js';
import { cleanOcrOutput, parseJsonLoose, formatCandidates } from '../src/lib/agent.js';
import { mergeSettings, DEFAULT_SETTINGS } from '../src/lib/settings.js';

test('跨页断句合并：中文无句末标点时直接相连', () => {
  const { md } = combinePages([{ text: '他走进房间，看见' }, { text: '桌上放着一封信。' }]);
  assert.equal(md, '他走进房间，看见桌上放着一封信。');
});

test('跨页断句合并：有句末标点或标题时不合并', () => {
  assert.equal(shouldJoin('结束了。', '新段落'), false);
  assert.equal(shouldJoin('没有标点', '## 第二章'), false);
  const { md } = combinePages([{ text: 'a sentence that' }, { text: 'continues here.' }]);
  assert.equal(md, 'a sentence that continues here.');
});

test('去掉每页顶部重复的页眉标题，并继续合并断句', () => {
  const { md } = combinePages([
    { text: '# 第一章\n\n冯保四散奔了开' },
    { text: '# 第一章\n\n去。冯保立刻大步' },
    { text: '# 第二章\n\n新的一章。' },
  ]);
  assert.equal(md, '# 第一章\n\n冯保四散奔了开去。冯保立刻大步\n\n# 第二章\n\n新的一章。');
});

test('合并关闭时保持分段', () => {
  const { md } = combinePages([{ text: '甲' }, { text: '乙' }], { mergeAcrossPages: false });
  assert.equal(md, '甲\n\n乙');
});

test('附带截图时插入图片标记', () => {
  const { md, images } = combinePages([{ text: '甲', images: ['A', 'B'] }, { text: '乙', images: ['C'] }], { includeImages: true });
  assert.deepEqual(images, ['A', 'B', 'C']);
  assert.equal(md, '@@IMG:0@@\n\n@@IMG:1@@\n\n甲\n\n@@IMG:2@@\n\n乙');
});

test('按标题分章', () => {
  const ch = splitChapters('序言文字\n\n# 第一章\n内容一\n\n# 第二章\n内容二', { mode: 'heading' });
  assert.deepEqual(ch.map((c) => c.title), ['前言', '第一章', '第二章']);
  assert.match(ch[2].md, /内容二/);
});

test('只有二级标题时按二级标题分章；无标题时整本一章', () => {
  assert.equal(splitChapters('## A\nx\n## B\ny', { mode: 'heading' }).length, 2);
  assert.equal(splitChapters('纯文本', { mode: 'heading', fallbackTitle: 'T' })[0].title, 'T');
});

test('Markdown → XHTML', () => {
  const html = markdownToHtml('# 标题\n\n第一行\n第二行\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> 引用\n\n---\n\n**粗** <tag>');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<p>第一行第二行<\/p>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<table><thead><tr><th>x<\/th><th>y<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<blockquote><p>引用<\/p><\/blockquote>/);
  assert.match(html, /<hr\/>/);
  assert.match(html, /<strong>粗<\/strong> &lt;tag&gt;/);
});

test('软换行拼接', () => {
  assert.equal(joinSoftLines(['hello', 'world']), 'hello world');
  assert.equal(joinSoftLines(['你好', '世界']), '你好世界');
});

test('Markdown → 纯文本', () => {
  assert.equal(markdownToText('# 标题\n\n**粗**和`码`'), '标题\n\n粗和码');
});

test('清理 OCR 输出中的代码块包裹与前缀', () => {
  assert.equal(cleanOcrOutput('```markdown\n# 标题\n正文\n```'), '# 标题\n正文');
  assert.equal(cleanOcrOutput('以下是识别结果：\n正文'), '正文');
});

test('宽松解析 JSON', () => {
  assert.deepEqual(parseJsonLoose('好的。{"id": 3}'), { id: 3 });
  assert.deepEqual(parseJsonLoose('```json\n{"x": 10, "y": 20}\n```'), { x: 10, y: 20 });
  assert.deepEqual(parseJsonLoose('{"id": null}'), { id: null });
  assert.equal(parseJsonLoose('none'), null);
});

test('候选元素格式化', () => {
  const s = formatCandidates([{ id: 0, tag: 'a', text: '下一页', label: '', rel: 'next', rect: { x: 1, y: 2, w: 3, h: 4 } }]);
  assert.equal(s, '[0] <a> "下一页 rel=next" @ (1,2,3,4)');
});

test('设置合并保留默认字段', () => {
  const s = mergeSettings({ agent: 'codex', agents: { claude: { command: 'C:\\claude.exe' } } });
  assert.equal(s.agent, 'codex');
  assert.equal(s.agents.claude.command, 'C:\\claude.exe');
  assert.deepEqual(s.agents.claude.args, DEFAULT_SETTINGS.agents.claude.args);
  assert.ok(s.agents.codex);
});
