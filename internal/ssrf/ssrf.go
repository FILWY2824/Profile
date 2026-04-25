// Package ssrf rejects outbound requests aimed at host ranges that have no
// business being reached from server-side fetch logic. This matters for two
// endpoints specifically:
//
//   - /api/favicons/image — takes a user-supplied origin and fetches it
//   - any future "check this URL" style admin helper
//
// Without a guard, an attacker supplies http://169.254.169.254/latest/ and
// the server cheerfully pulls cloud instance metadata. Or 127.0.0.1:6379 and
// probes an internal Redis. The list below catches the IP ranges reserved by
// RFC 1918, 3927, 4193, 6598, and the loopback / link-local / multicast /
// unspecified blocks.
//
// This guard operates on the *resolved* IP, not the hostname — a DNS record
// pointing example.com → 127.0.0.1 will still be caught after Resolve.
package ssrf

import (
	"errors"
	"net"
	"net/netip"
)

// ErrBlocked is returned by Check when the target resolves to a disallowed
// address family or range. Callers should surface this as a 400/404 to the
// client; leaking the specific reason helps attackers map your internal
// network.
var ErrBlocked = errors.New("ssrf: target not permitted")

// blockedCIDRs is the union of IPv4 and IPv6 ranges we refuse to fetch from.
// Extend carefully — each entry widens the attack surface when removed.
var blockedCIDRs = []string{
	// IPv4
	"0.0.0.0/8",           // this-network
	"10.0.0.0/8",          // RFC 1918 private
	"100.64.0.0/10",       // RFC 6598 CGNAT
	"127.0.0.0/8",         // loopback
	"169.254.0.0/16",      // link-local incl. cloud metadata 169.254.169.254
	"172.16.0.0/12",       // RFC 1918 private
	"192.0.0.0/24",        // IETF protocol assignments
	"192.0.2.0/24",        // TEST-NET-1
	"192.168.0.0/16",      // RFC 1918 private
	"198.18.0.0/15",       // benchmarking
	"198.51.100.0/24",     // TEST-NET-2
	"203.0.113.0/24",      // TEST-NET-3
	"224.0.0.0/4",         // multicast
	"240.0.0.0/4",         // reserved
	"255.255.255.255/32",  // broadcast
	// IPv6
	"::/128",              // unspecified
	"::1/128",             // loopback
	"fc00::/7",            // unique local
	"fe80::/10",           // link-local
	"ff00::/8",            // multicast
	"::ffff:0:0/96",       // IPv4-mapped — blocked separately, see below
	"64:ff9b::/96",        // NAT64
}

var blockedPrefixes = mustParsePrefixes()

func mustParsePrefixes() []netip.Prefix {
	out := make([]netip.Prefix, 0, len(blockedCIDRs))
	for _, c := range blockedCIDRs {
		p, err := netip.ParsePrefix(c)
		if err != nil {
			panic("ssrf: invalid CIDR " + c + ": " + err.Error())
		}
		out = append(out, p)
	}
	return out
}

// IsBlockedIP reports whether ip falls into any blocked range. IPv4-mapped
// IPv6 addresses are unmapped first so "::ffff:127.0.0.1" also hits the
// loopback rule (a bypass we'd otherwise miss).
func IsBlockedIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return true // reject ambiguous input
	}
	if ip.Is4In6() {
		ip = ip.Unmap()
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// ResolveAndCheck resolves host (via the system resolver) and returns the
// first permitted address, or ErrBlocked if every resolved address is
// blocked. Use this immediately before dial.
//
// We deliberately use the system resolver — go's pure-Go resolver obeys
// the standard library's happy-eyeballs flow, matching what net/http would
// use anyway. Substituting a custom resolver is how you forget to apply
// the guard to one call site.
func ResolveAndCheck(host string) (netip.Addr, error) {
	addrs, err := net.LookupIP(host)
	if err != nil {
		return netip.Addr{}, err
	}
	for _, a := range addrs {
		ip, ok := netip.AddrFromSlice(a)
		if !ok {
			continue
		}
		if !IsBlockedIP(ip) {
			return ip, nil
		}
	}
	return netip.Addr{}, ErrBlocked
}
