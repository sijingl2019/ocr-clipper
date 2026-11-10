// 打包可上传到 Chrome 网上应用店的 zip：dist/ocr-clipper-<version>.zip
// - 只包含扩展运行所需文件（manifest.json、src/、icons/），不含 host、测试、脚本
// - 去掉 manifest 中的 "key"（应用店不接受该字段，发布后由应用店分配扩展 ID）
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../src/lib/zip.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const INCLUDE = ['src', 'icons'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
delete manifest.key;

const problems = [];
if (manifest.description.length > 132) problems.push(`description 超过 132 字符（${manifest.description.length}）`);
for (const [size, file] of Object.entries(manifest.icons || {})) {
  try {
    statSync(join(ROOT, file));
  } catch {
    problems.push(`缺少图标 ${size}: ${file}`);
  }
}

const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' }];
for (const dir of INCLUDE) {
  for (const file of walk(join(ROOT, dir)).sort()) {
    entries.push({ name: relative(ROOT, file).split(sep).join('/'), data: new Uint8Array(readFileSync(file)) });
  }
}

// 检查 manifest 中引用的文件都已打包
const names = new Set(entries.map((e) => e.name));
for (const ref of [manifest.background?.service_worker, manifest.side_panel?.default_path]) {
  if (ref && !names.has(ref)) problems.push(`manifest 引用的文件未打包：${ref}`);
}
if (problems.length) {
  console.error('打包失败：\n- ' + problems.join('\n- '));
  process.exit(1);
}

const zip = await createZip(entries);
mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', `ocr-clipper-${manifest.version}.zip`);
writeFileSync(out, Buffer.from(await zip.arrayBuffer()));
console.log(`已生成 ${relative(ROOT, out)}（${entries.length} 个文件，${(zip.size / 1024).toFixed(1)} KB）`);
for (const e of entries) console.log('  ' + e.name);

// 本机 host 下载包：dist/ocr-clipper-host.zip（上传到 GitHub Release，侧边栏里的下载链接指向它）
// 不含安装时生成的文件（.bat / .sh 启动器、host 清单）
const GENERATED = /^(ocr-clipper-host\.(bat|sh)|com\.ocrclipper\.host\.json)$/;
const hostDir = join(ROOT, 'host');
const hostEntries = walk(hostDir)
  .sort()
  .map((f) => relative(hostDir, f).split(sep).join('/'))
  .filter((n) => !GENERATED.test(n))
  .map((n) => ({ name: 'ocr-clipper-host/' + n, data: new Uint8Array(readFileSync(join(hostDir, n))) }));
const hostZip = await createZip(hostEntries);
const hostOut = join(ROOT, 'dist', 'ocr-clipper-host.zip');
writeFileSync(hostOut, Buffer.from(await hostZip.arrayBuffer()));
console.log(`已生成 ${relative(ROOT, hostOut)}（${hostEntries.length} 个文件）`);
for (const e of hostEntries) console.log('  ' + e.name);
