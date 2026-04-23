/**
 * 轻量级、常量内存的速率限制。
 * ---------------------------------------------------------------------------
 * 设计目标:
 *   • 每个桶只保存 count/resetAt/lastSeen,避免为高频请求累积时间戳数组
 *   • 对桶总量做上限保护,防止被伪造 IP / 大量唯一标识打爆内存
 *   • 优先信任已由反代规范化的 x-real-ip,对 x-forwarded-for 仅做兜底解析
 * ---------------------------------------------------------------------------
 */

import net from 'net';

const buckets = new Map(); // key -> { count, resetAt, lastSeen }
const MAX_BUCKETS = Math.max(512, Math.min(20_000, parseInt(process.env.RATE_LIMIT_MAX_BUCKETS || '5000', 10) || 5000));
const STALE_BUCKET_MS = 30 * 60_000;
const MAX_ID_LENGTH = 160;

function normalizeIpCandidate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let candidate = raw;
  if (candidate.startsWith('[') && candidate.endsWith(']')) candidate = candidate.slice(1, -1);
  const comma = candidate.indexOf(',');
  if (comma !== -1) candidate = candidate.slice(0, comma).trim();

  const portMatch = candidate.match(/^(.+):(\d+)$/);
  if (portMatch && net.isIP(portMatch[1])) candidate = portMatch[1];

  return net.isIP(candidate) ? candidate : null;
}

function normalizeId(id) {
  if (id == null) return 'unknown';
  const value = String(id).trim();
  if (!value) return 'unknown';
  return value.length > MAX_ID_LENGTH ? value.slice(0, MAX_ID_LENGTH) : value;
}

function evictStaleBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeen > STALE_BUCKET_MS || now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

/** 读取请求真实 IP —— 优先 x-real-ip,其次 x-forwarded-for 的首个合法 IP */
export function getClientIp(request) {
  const realIp = normalizeIpCandidate(request.headers.get('x-real-ip'));
  if (realIp) return realIp;

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    for (const part of xff.split(',')) {
      const ip = normalizeIpCandidate(part);
      if (ip) return ip;
    }
  }

  return 'unknown';
}

export function rateLimit(scope, id, opts = {}) {
  const requestedMax = parseInt(opts.max ?? 30, 10);
  const requestedWindowMs = parseInt(opts.windowMs ?? 60_000, 10);
  const max = Math.max(1, Math.min(10_000, Number.isFinite(requestedMax) ? requestedMax : 30));
  const windowMs = Math.max(1_000, Math.min(24 * 3600_000, Number.isFinite(requestedWindowMs) ? requestedWindowMs : 60_000));

  const baseId = normalizeId(id);
  const now = Date.now();
  let key = `${scope}:${baseId}`;
  let bucket = buckets.get(key);

  if (!bucket && buckets.size >= MAX_BUCKETS) {
    evictStaleBuckets(now);
  }

  if (!bucket && buckets.size >= MAX_BUCKETS) {
    key = `${scope}:__overflow__`;
    bucket = buckets.get(key);
  }

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs, lastSeen: now };
    buckets.set(key, bucket);
  } else {
    bucket.lastSeen = now;
  }

  if (bucket.count >= max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfter };
  }

  bucket.count += 1;
  bucket.lastSeen = now;
  return { allowed: true, remaining: Math.max(0, max - bucket.count), retryAfter: 0 };
}

export function sweepRateLimit() {
  evictStaleBuckets(Date.now());
}

if (typeof setInterval !== 'undefined') {
  setInterval(sweepRateLimit, 5 * 60 * 1000).unref?.();
}
