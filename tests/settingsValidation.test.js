/**
 * settingsValidation.test.js —— settings 值校验回归
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings } from '../lib/settingsValidation.js';

function errorsFor(entries) {
  return validateSettings(entries).errors;
}

test('空值一律放行(用于回退默认或保持不变)', () => {
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '' }).length, 0);
  assert.equal(errorsFor({ TURNSTILE_ENABLED: '' }).length, 0);
});

test('整数区间:SESSION_EXPIRY_DAYS', () => {
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '7' }).length, 0);
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '1' }).length, 0);
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '365' }).length, 0);
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '0' }).length, 1);
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: '366' }).length, 1);
  assert.equal(errorsFor({ SESSION_EXPIRY_DAYS: 'abc' }).length, 1);
});

test('枚举:TURNSTILE_ENABLED', () => {
  assert.equal(errorsFor({ TURNSTILE_ENABLED: '0' }).length, 0);
  assert.equal(errorsFor({ TURNSTILE_ENABLED: '1' }).length, 0);
  assert.equal(errorsFor({ TURNSTILE_ENABLED: 'true' }).length, 1);
});

test('邮箱:RESEND_FROM', () => {
  assert.equal(errorsFor({ RESEND_FROM: 'a@b.com' }).length, 0);
  assert.equal(errorsFor({ RESEND_FROM: 'no-at-sign' }).length, 1);
  assert.equal(errorsFor({ RESEND_FROM: 'no@domain' }).length, 1);
});

test('负一特判:LOGIN_HISTORY_RETENTION_DAYS 允许 -1', () => {
  assert.equal(errorsFor({ LOGIN_HISTORY_RETENTION_DAYS: '-1' }).length, 0);
  assert.equal(errorsFor({ LOGIN_HISTORY_RETENTION_DAYS: '0' }).length, 0);
  assert.equal(errorsFor({ LOGIN_HISTORY_RETENTION_DAYS: '30' }).length, 0);
  assert.equal(errorsFor({ LOGIN_HISTORY_RETENTION_DAYS: '-5' }).length, 1);
});

test('OAuth token 边界', () => {
  assert.equal(errorsFor({ OAUTH_TOKEN_EXPIRY_SECONDS: '0' }).length, 1);
  assert.equal(errorsFor({ OAUTH_TOKEN_EXPIRY_SECONDS: '60' }).length, 0);
  assert.equal(errorsFor({ OAUTH_TOKEN_EXPIRY_SECONDS: '86400' }).length, 0);
  assert.equal(errorsFor({ OAUTH_TOKEN_EXPIRY_SECONDS: '86401' }).length, 1);
});

test('后缀匹配:_CLIENT_SECRET 至少 16 字符', () => {
  assert.equal(errorsFor({ QISHU_DEFAULT_CLIENT_SECRET: 'too-short' }).length, 1);
  assert.equal(errorsFor({ QISHU_DEFAULT_CLIENT_SECRET: 'a'.repeat(16) }).length, 0);
  assert.equal(errorsFor({ SOME_NEW_CLIENT_SECRET: 'a'.repeat(16) }).length, 0);
});

test('未登记键:不报错(白名单已经在上游挡住)', () => {
  assert.equal(errorsFor({ SOME_RANDOM_KEY: 'anything' }).length, 0);
});

test('整批校验:多个错误一次返回', () => {
  const errs = errorsFor({
    SESSION_EXPIRY_DAYS: '9999',
    TURNSTILE_ENABLED: 'true',
    RESEND_FROM: 'bad-email',
  });
  assert.equal(errs.length, 3);
  assert.ok(errs.find(e => e.key === 'SESSION_EXPIRY_DAYS'));
  assert.ok(errs.find(e => e.key === 'TURNSTILE_ENABLED'));
  assert.ok(errs.find(e => e.key === 'RESEND_FROM'));
});
