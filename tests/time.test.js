/**
 * time.test.js —— 时区与日期边界转换测试
 *
 * 这些函数直接喂进 SQL WHERE,算错一小时就会让运营报表差一天。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shanghaiStartIso, shanghaiEndIso, fmtDateTime, fmtDate } from '../lib/time.js';

test('time: 上海日历 → UTC 边界', () => {
  // 2026-04-20 的上海 00:00:00 对应 UTC 是 2026-04-19T16:00:00Z
  assert.equal(shanghaiStartIso('2026-04-20'), '2026-04-19T16:00:00.000Z');
  // 2026-04-20 的上海 23:59:59.999 对应 UTC 是 2026-04-20T15:59:59.999Z
  assert.equal(shanghaiEndIso('2026-04-20'),   '2026-04-20T15:59:59.999Z');
});

test('time: fmt* 在空/非法输入下回退到 "-"', () => {
  assert.equal(fmtDateTime(''), '-');
  assert.equal(fmtDateTime(null), '-');
  assert.equal(fmtDateTime(undefined), '-');
  assert.equal(fmtDate(''), '-');
});

test('time: fmtDateTime 产出非空字符串(具体格式随 Node Intl 可能微差)', () => {
  const s = fmtDateTime('2026-04-20T12:34:56.000Z');
  assert.ok(typeof s === 'string' && s.length > 0);
  assert.notEqual(s, '-');
});
