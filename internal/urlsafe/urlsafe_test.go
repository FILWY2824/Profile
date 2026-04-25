package urlsafe

import "testing"

func TestIsSafeHTTPURL(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		// Accepted
		{"https://example.com", true},
		{"http://example.com", true},
		{"https://example.com:8443/path?q=1", true},
		{"https://sub.domain.example.com/a/b", true},

		// Wrong scheme — the core attacks we must block
		{"javascript:alert(1)", false},
		{"JAVASCRIPT:alert(1)", false},
		{"data:text/html,<script>alert(1)</script>", false},
		{"vbscript:msgbox(1)", false},
		{"file:///etc/passwd", false},
		{"ftp://example.com", false},

		// Missing host
		{"http://", false},
		{"https://", false},
		{"http:/path", false},
		{"http:foo", false},

		// Empty / whitespace / control
		{"", false},
		{"   ", false},
		{"http://example.com\x00", false},
		{"http://example.com\n", false},
		{"http://example.com\t", false},

		// Relative / garbage
		{"/relative/path", false},
		{"example.com", false},

		// Weird but technically OK
		{"https://user:pass@example.com/", true},
		{"https://[::1]/", true}, // bracketed IPv6 literal — SSRF guard rejects, URL-safe allows
	}
	for _, c := range cases {
		got := IsSafeHTTPURL(c.in)
		if got != c.want {
			t.Errorf("IsSafeHTTPURL(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestSanitizeHTTPURLOrEmpty(t *testing.T) {
	if got := SanitizeHTTPURLOrEmpty("https://example.com"); got != "https://example.com" {
		t.Errorf("good URL got stripped: %q", got)
	}
	if got := SanitizeHTTPURLOrEmpty("javascript:alert(1)"); got != "" {
		t.Errorf("dangerous URL not stripped, got: %q", got)
	}
	if got := SanitizeHTTPURLOrEmpty("  https://example.com  "); got != "https://example.com" {
		t.Errorf("whitespace not trimmed, got: %q", got)
	}
}
