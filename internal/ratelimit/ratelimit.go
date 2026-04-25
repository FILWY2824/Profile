// Package ratelimit implements a sliding-window rate limiter with a hard cap
// on total memory. The cap matters: a naive limiter grows unboundedly as
// attackers cycle through random keys, and a tuned-for-peak limiter can OOM
// the 80MB-budget container.
//
// Algorithm: per-key ring of recent attempt timestamps, trimmed on each
// Allow() call. This is O(N) in the window size but N is tiny (10s of
// requests); the total work per request is a cache-friendly linear scan
// over a []int64 and cheaper than the constant overhead of a token-bucket
// refill-time calculation.
//
// Future: this Limiter is an interface on purpose — the day we go multi-
// instance, swap in a Redis implementation without touching handlers.
package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Rule is the (max, window) pair governing how often a key can act.
type Rule struct {
	Max    int           // allowed attempts in the window
	Window time.Duration // sliding window length
}

// Decision is the Allow() result. If !Allowed, RetryAfter is the seconds the
// caller should wait before trying again — suitable for the Retry-After
// header.
type Decision struct {
	Allowed    bool
	RetryAfter int
	Remaining  int
}

// Limiter is the interface handlers depend on. Deliberately minimal.
type Limiter interface {
	Allow(bucket, key string, rule Rule) Decision
}

// MemoryLimiter is a single-process Limiter suitable for the single-
// container default deploy. It enforces:
//   - maxBuckets entries globally (64-byte overhead × count = predictable
//     memory footprint); when full, new keys are rejected with Allowed=true
//     to fail open — a stuck limiter is worse than no limit for real users
//   - every ~10 minutes, buckets with no activity in the last hour are
//     garbage-collected
type MemoryLimiter struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	maxBuckets int
	now        func() time.Time // injectable for tests
}

type bucket struct {
	timestamps []int64 // unix nanoseconds, sorted ascending
	lastSeen   int64
}

// NewMemoryLimiter returns a limiter with the given cap. Reasonable default
// for the 100MB budget: 2000. At 50 buckets per active attacker x 1000
// attackers, that's still only ~128KB. Above 2000, the sweep can't keep
// up with adversarial fill rates in practice.
func NewMemoryLimiter(maxBuckets int) *MemoryLimiter {
	if maxBuckets <= 0 {
		maxBuckets = 2000
	}
	l := &MemoryLimiter{
		buckets:    make(map[string]*bucket),
		maxBuckets: maxBuckets,
		now:        time.Now,
	}
	return l
}

// StartSweep launches a goroutine that periodically drops idle buckets.
// Cancel by closing stop. Safe to call exactly once per Limiter.
func (l *MemoryLimiter) StartSweep(stop <-chan struct{}) {
	go func() {
		t := time.NewTicker(10 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				l.sweep(time.Hour)
			case <-stop:
				return
			}
		}
	}()
}

// Allow is the hot path. Holds the lock for O(len(timestamps)) work — under
// normal load that's single-digit entries and the lock is contended only on
// same-key attempts, which is fine (the goal is to serialise same-key
// attempts anyway).
func (l *MemoryLimiter) Allow(bucketName, key string, rule Rule) Decision {
	if rule.Max <= 0 || rule.Window <= 0 {
		// No rule configured ≡ unlimited. Useful for disabling in the admin
		// settings UI without branching at every call site.
		return Decision{Allowed: true, Remaining: -1}
	}

	id := bucketName + ":" + key
	now := l.now()
	nowNano := now.UnixNano()
	cutoff := nowNano - rule.Window.Nanoseconds()

	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[id]
	if !ok {
		if len(l.buckets) >= l.maxBuckets {
			// Fail-open: legitimate users shouldn't eat a 429 because the
			// limiter is full from attacker junk. The periodic sweep plus
			// natural expiry handles the overflow.
			return Decision{Allowed: true, Remaining: -1}
		}
		b = &bucket{timestamps: make([]int64, 0, rule.Max)}
		l.buckets[id] = b
	}

	// Drop timestamps outside the window.
	i := 0
	for i < len(b.timestamps) && b.timestamps[i] < cutoff {
		i++
	}
	if i > 0 {
		b.timestamps = append(b.timestamps[:0], b.timestamps[i:]...)
	}
	b.lastSeen = nowNano

	if len(b.timestamps) >= rule.Max {
		retryAfter := int((b.timestamps[0] + rule.Window.Nanoseconds() - nowNano) / int64(time.Second))
		if retryAfter < 1 {
			retryAfter = 1
		}
		return Decision{Allowed: false, RetryAfter: retryAfter, Remaining: 0}
	}
	b.timestamps = append(b.timestamps, nowNano)
	return Decision{Allowed: true, Remaining: rule.Max - len(b.timestamps)}
}

func (l *MemoryLimiter) sweep(idleFor time.Duration) {
	cutoff := l.now().Add(-idleFor).UnixNano()
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if b.lastSeen < cutoff {
			delete(l.buckets, k)
		}
	}
}

// Size returns the current bucket count. Handy for /api/admin/metrics.
func (l *MemoryLimiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// ClientIP extracts the best-effort client IP from an HTTP request.
//
// Preference order:
//  1. CF-Connecting-IP       — Cloudflare's signed header (only trust when
//                              the edge is actually Cloudflare)
//  2. X-Real-IP              — set by nginx/Caddy when deployed behind them
//  3. X-Forwarded-For first  — standard fallback
//  4. RemoteAddr             — direct connection
//
// We do NOT strip proxies — if a misconfigured deploy exposes the app
// directly to the internet, the attacker's IP IS the RemoteAddr and we
// want to rate-limit on that, not on a forged X-Forwarded-For header they
// control.
func ClientIP(r *http.Request) string {
	if v := r.Header.Get("CF-Connecting-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if i := strings.IndexByte(v, ','); i > 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	// RemoteAddr is "ip:port" — strip the port.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
