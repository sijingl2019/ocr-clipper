import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, crc32 } from '../src/lib/zip.js';

test('crc32 已知值', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('生成的 zip 可被系统工具解压，且 mimetype 为第一个未压缩条目', async () => {
  const big = '重复的中文内容 '.repeat(500);
  const blob = await createZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'OEBPS/中文.xhtml', data: big },
    { name: 'bin.dat', data: new Uint8Array([0, 1, 2, 255]) },
  ]);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt16LE(8), 0); // stored
  assert.equal(buf.slice(30, 38).toString(), 'mimetype');
  assert.equal(buf.slice(38, 58).toString(), 'application/epub+zip');

  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  try {
    const zipPath = join(dir, 't.zip');
    writeFileSync(zipPath, buf);
    // 用 Python 标准库 zipfile 做独立校验（CRC、解压内容）
    const py =
      'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;' +
      "print(json.dumps({n:list(z.read(n)) if n.endswith('.dat') else z.read(n).decode('utf-8') for n in z.namelist()}))";
    const out = JSON.parse(execFileSync('python', ['-I', '-c', py, zipPath], { encoding: 'utf8' }));
    assert.deepEqual(Object.keys(out), ['mimetype', 'OEBPS/中文.xhtml', 'bin.dat']);
    assert.equal(out['OEBPS/中文.xhtml'], big);
    assert.deepEqual(out['bin.dat'], [0, 1, 2, 255]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
