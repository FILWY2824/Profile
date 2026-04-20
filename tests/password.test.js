/**
 * password.test.js —— validatePasswordStrength 的回归测试
 *
 * 纯函数,无依赖,最适合被 node --test 跑。每次修改 lib/password.js 都应该
 * 能通过这些用例,否则就是破坏了既有合约。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordStrength } from '../lib/password.js';

test('password: empty / too short → invalid', () => {
  assert.equal(validatePasswordStrength('').valid, false);
  assert.equal(validatePasswordStrength(undefined).valid, false);
  assert.equal(validatePasswordStrength('Ab1!').valid, false); // 只有 4 位
  assert.equal(validatePasswordStrength('Ab1!xyz').valid, false); // 只有 7 位
});

test('password: 少一类字符都不合格', () => {
  assert.equal(validatePasswordStrength('abcdefgh').valid, false);       // 没大写/数字/特殊
  assert.equal(validatePasswordStrength('Abcdefgh').valid, false);       // 没数字/特殊
  assert.equal(validatePasswordStrength('Abcdefg1').valid, false);       // 没特殊
  assert.equal(validatePasswordStrength('ABCDEFG1!').valid, false);      // 没小写
  assert.equal(validatePasswordStrength('abcdefg1!').valid, false);      // 没大写
  assert.equal(validatePasswordStrength('Abcdefg!').valid, false);       // 没数字
});

test('password: 满足所有类别 → 合格', () => {
  assert.equal(validatePasswordStrength('Abcdef1!').valid, true);
  assert.equal(validatePasswordStrength('MyP@ssw0rd').valid, true);
  assert.equal(validatePasswordStrength('Str0ng#Pass').valid, true);
});

test('password: 错误消息与分类一致', () => {
  assert.match(validatePasswordStrength('short').message, /至少|长度/);
  assert.match(validatePasswordStrength('nouppercase1!').message, /大写/);
  assert.match(validatePasswordStrength('NOLOWERCASE1!').message, /小写/);
  assert.match(validatePasswordStrength('NoDigitsHere!').message, /数字/);
  assert.match(validatePasswordStrength('NoSpecial1X').message, /特殊/);
});
