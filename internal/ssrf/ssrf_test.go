package ssrf

import (
	"net/netip"
	"testing"
)

func TestIsBlockedIP(t *testing.T) {
	cases := []struct {
		ip      string
		blocked bool
		reason  string
	}{
		// Loopback
		{"127.0.0.1", true, "loopback"},
		{"127.255.255.254", true, "loopback range"},
		{"::1", true, "ipv6 loopback"},

		// Private RFC 1918
		{"10.0.0.1", true, "rfc1918 10/8"},
		{"172.16.0.1", true, "rfc1918 172.16/12"},
		{"172.31.255.254", true, "rfc1918 end"},
		{"172.32.0.1", false, "just outside rfc1918 172/12"},
		{"192.168.1.1", true, "rfc1918 192.168/16"},

		// Cloud metadata & link-local
		{"169.254.169.254", true, "AWS/Azure/GCP metadata"},
		{"169.254.0.1", true, "link-local"},

		// CGNAT
		{"100.64.0.1", true, "rfc6598 cgnat"},
		{"100.63.255.255", false, "just outside cgnat"},

		// IPv6 private
		{"fc00::1", true, "ipv6 ULA"},
		{"fd00::abcd", true, "ipv6 ULA"},
		{"fe80::1", true, "ipv6 link-local"},

		// IPv4-mapped-IPv6 bypass attempt
		{"::ffff:127.0.0.1", true, "4in6 loopback must be blocked"},
		{"::ffff:10.0.0.1", true, "4in6 private"},

		// Should be allowed
		{"1.1.1.1", false, "cloudflare dns"},
		{"8.8.8.8", false, "google dns"},
		{"2606:4700:4700::1111", false, "public ipv6"},

		// Multicast / reserved
		{"224.0.0.1", true, "multicast"},
		{"255.255.255.255", true, "broadcast"},
		{"0.0.0.0", true, "unspecified"},
	}
	for _, c := range cases {
		addr, err := netip.ParseAddr(c.ip)
		if err != nil {
			t.Fatalf("parse %q: %v", c.ip, err)
		}
		got := IsBlockedIP(addr)
		if got != c.blocked {
			t.Errorf("IsBlockedIP(%s) [%s] = %v, want %v", c.ip, c.reason, got, c.blocked)
		}
	}
}

func TestIsBlockedIPInvalid(t *testing.T) {
	var zero netip.Addr // zero-value Addr is not valid
	if !IsBlockedIP(zero) {
		t.Error("invalid addr should be treated as blocked")
	}
}
