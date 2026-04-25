package ratelimit

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMemoryLimiter_AllowsUnderLimit(t *testing.T) {
	l := NewMemoryLimiter(100)
	rule := Rule{Max: 3, Window: time.Minute}

	for i := 0; i < 3; i++ {
		d := l.Allow("test", "key", rule)
		if !d.Allowed {
			t.Errorf("attempt %d should be allowed", i)
		}
	}
}

func TestMemoryLimiter_BlocksOverLimit(t *testing.T) {
	l := NewMemoryLimiter(100)
	rule := Rule{Max: 3, Window: time.Minute}

	for i := 0; i < 3; i++ {
		_ = l.Allow("test", "key", rule)
	}
	d := l.Allow("test", "key", rule)
	if d.Allowed {
		t.Error("4th attempt should be blocked")
	}
	if d.RetryAfter < 1 {
		t.Errorf("retryAfter should be positive, got %d", d.RetryAfter)
	}
}

func TestMemoryLimiter_SlidingWindow(t *testing.T) {
	l := NewMemoryLimiter(100)
	rule := Rule{Max: 2, Window: 100 * time.Millisecond}

	// Fake time to control the window.
	now := time.Now()
	l.now = func() time.Time { return now }

	l.Allow("test", "key", rule)
	l.Allow("test", "key", rule)

	// 3rd inside the window: blocked.
	if d := l.Allow("test", "key", rule); d.Allowed {
		t.Error("3rd inside window should be blocked")
	}

	// Advance past window.
	now = now.Add(200 * time.Millisecond)
	if d := l.Allow("test", "key", rule); !d.Allowed {
		t.Error("attempt after window should be allowed")
	}
}

func TestMemoryLimiter_ZeroRuleIsUnlimited(t *testing.T) {
	l := NewMemoryLimiter(100)
	rule := Rule{Max: 0, Window: 0}
	for i := 0; i < 1000; i++ {
		if !l.Allow("test", "key", rule).Allowed {
			t.Fatalf("zero-rule blocked at attempt %d", i)
		}
	}
}

// TestMemoryLimiter_CapFailsOpen verifies that once the bucket store hits its
// hard cap, new keys fail open (return Allowed=true) rather than blocking
// legit users.
func TestMemoryLimiter_CapFailsOpen(t *testing.T) {
	l := NewMemoryLimiter(5)
	rule := Rule{Max: 10, Window: time.Hour}

	// Exhaust the cap with distinct keys.
	for i := 0; i < 5; i++ {
		l.Allow("test", fmt.Sprintf("k%d", i), rule)
	}
	if l.Size() != 5 {
		t.Fatalf("expected 5 buckets, got %d", l.Size())
	}
	// Another distinct key — should fail open, not create a 6th bucket.
	d := l.Allow("test", "new-key", rule)
	if !d.Allowed {
		t.Error("over-cap lookup should fail open")
	}
	if l.Size() != 5 {
		t.Errorf("bucket count grew past cap: %d", l.Size())
	}
}

// TestMemoryLimiter_MemoryBound is a lightweight smoke test for the memory
// hard-cap property: 10k distinct keys must not all be stored.
func TestMemoryLimiter_MemoryBound(t *testing.T) {
	l := NewMemoryLimiter(500)
	rule := Rule{Max: 10, Window: time.Hour}
	for i := 0; i < 10000; i++ {
		l.Allow("bench", fmt.Sprintf("k%d", i), rule)
	}
	if l.Size() > 500 {
		t.Errorf("expected <=500 buckets, got %d", l.Size())
	}
}

func TestClientIP_Preferences(t *testing.T) {
	cases := []struct {
		headers map[string]string
		remote  string
		want    string
	}{
		{map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "10.0.0.1:1234", "1.2.3.4"},
		{map[string]string{"X-Real-IP": "5.6.7.8"}, "10.0.0.1:1234", "5.6.7.8"},
		{map[string]string{"X-Forwarded-For": "9.9.9.9, 10.0.0.1"}, "10.0.0.1:1234", "9.9.9.9"},
		{nil, "10.0.0.1:4567", "10.0.0.1"},
	}
	for i, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		for k, v := range c.headers {
			r.Header.Set(k, v)
		}
		r.RemoteAddr = c.remote
		if got := ClientIP(r); got != c.want {
			t.Errorf("case %d: ClientIP = %q, want %q", i, got, c.want)
		}
	}
}
