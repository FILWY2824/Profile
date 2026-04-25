// Package ratelimit implements a sliding-window rate limiter with a hard cap
// on total memory.
package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Rule struct {
	Max    int
	Window time.Duration
}

type Decision struct {
	Allowed    bool
	RetryAfter int
	Remaining  int
}

type Limiter interface {
	Allow(bucket, key string, rule Rule) Decision
}

type MemoryLimiter struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	maxBuckets int
	now        func() time.Time
}

type bucket struct {
	timestamps []int64
	lastSeen   int64
}

func NewMemoryLimiter(maxBuckets int) *MemoryLimiter {
	if maxBuckets <= 0 {
		maxBuckets = 2000
	}
	return &MemoryLimiter{
		buckets:    make(map[string]*bucket),
		maxBuckets: maxBuckets,
		now:        time.Now,
	}
}

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

func (l *MemoryLimiter) Allow(bucketName, key string, rule Rule) Decision {
	if rule.Max <= 0 || rule.Window <= 0 {
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
			return Decision{Allowed: true, Remaining: -1}
		}
		b = &bucket{timestamps: make([]int64, 0, rule.Max)}
		l.buckets[id] = b
	}
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

func (l *MemoryLimiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// trustProxy 默认值。设置入口在 main 通过 SetTrust。包内全局是因为太多
// handler 已经直接调用 ClientIP(req),改全部 callsite 比加全局开销更大。
var trustProxy = false

// SetTrustProxy 由 main.go 在启动时调用一次。线程安全:在 server start 之前
// 设定后只读。
func SetTrustProxy(b bool) { trustProxy = b }

// ClientIP extracts the best-effort client IP. 当 TrustProxy=false 时,只信任
// RemoteAddr — 攻击者无法伪造 RemoteAddr。当 TrustProxy=true 时,优先 CF/X-Real
// /XFF。
func ClientIP(r *http.Request) string {
	if trustProxy {
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
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
