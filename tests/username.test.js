/**
 * username.test.js —— validateName + validateBio 回归
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateName, validateBio, NAME_MAX_LENGTH, BIO_MAX_LENGTH } from '../lib/username.js';

test('validateName: 空 / 非字符串 / 空白', () => {
  assert.equal(validateName('').valid, false);
  assert.equal(validateName('   ').valid, false);
  assert.equal(validateName(undefined).valid, false);
  assert.equal(validateName(null).valid, false);
  assert.equal(validateName(42).valid, false);
});

test('validateName: 太短 / 太长', () => {
  assert.equal(validateName('a').valid, false);           // 1 个
  assert.equal(validateName('ab').valid, true);            // 2 个,合法下限
  assert.equal(validateName('a'.repeat(NAME_MAX_LENGTH)).valid, true);
  assert.equal(validateName('a'.repeat(NAME_MAX_LENGTH + 1)).valid, false);
});

test('validateName: trim 后校验 + 返回 trim 结果', () => {
  const r = validateName('  小名  ');
  assert.equal(r.valid, true);
  assert.equal(r.value, '小名');
});

test('validateName: 中文 + emoji 按 code unit 计', () => {
  // 中文两字 = length 2,emoji 一个 = length 2(UTF-16 代理对)
  assert.equal(validateName('你好').valid, true);
  assert.equal(validateName('\u{1F600}').valid, true);       // length 2,合法下限
  assert.equal(validateName('\u{1F600}\u{1F601}\u{1F602}\u{1F603}\u{1F604}\u{1F605}').valid, false); // 6×2=12 > 10
});

test('validateBio: 空允许', () => {
  assert.equal(validateBio('').valid, true);
  assert.equal(validateBio('').value, '');
  assert.equal(validateBio(null).valid, true);
  assert.equal(validateBio(undefined).valid, true);
});

test('validateBio: 长度上限 200', () => {
  assert.equal(validateBio('x').valid, true);
  assert.equal(validateBio('x'.repeat(BIO_MAX_LENGTH)).valid, true);
  assert.equal(validateBio('x'.repeat(BIO_MAX_LENGTH + 1)).valid, false);
});

test('validateBio: trim', () => {
  const r = validateBio('  hi there  ');
  assert.equal(r.valid, true);
  assert.equal(r.value, 'hi there');
});

test('validateBio: 非字符串拒绝', () => {
  assert.equal(validateBio(42).valid, false);
  assert.equal(validateBio({}).valid, false);
});
