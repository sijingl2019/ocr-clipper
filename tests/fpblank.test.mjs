import test from 'node:test';
import assert from 'node:assert';
import { fpBlank } from '../src/lib/image.js';

test('fpBlank: spinner-only page is blank, text page is not', () => {
  const blank = '1'.repeat(1020) + '9999';
  const text = Array.from({ length: 1024 }, (_, i) => (i % 32 < 28 && (i >> 5) % 3 === 0 ? '6' : '1')).join('');
  assert.equal(fpBlank(blank), true);
  assert.equal(fpBlank(text), false);
  assert.equal(fpBlank(null), true);
});
