// Package urlsafe rejects URL schemes that render as clickable but load
// something other than HTTP. The attack this stops is straightforward: an
// admin (or someone who compromised an admin) sets an OAuth client's
// homepageUrl to `javascript:fetch('/api/...')` and the FE renders
// `<a href={homepageUrl}>` verbatim — click-to-XSS.
//
// Policy: accept only http:// and https:// with a host component. Anything
// else — including `data:`, `vbscript:`, `file:`, `ftp:`, relative paths
// with embedded control chars, the literal string "javascript:alert(1)" with
// a stray space, etc. — is treated as unsafe. Sanitize* returns "" for
// unsafe input so callers can store something defensible without propagating
// null/undefined through the pipeline.
package urlsafe

import (
	"net/url"
	"strings"
)

// IsSafeHTTPURL reports whether raw is a well-formed absolute http(s) URL
// pointing at a non-empty host. The URL may contain a path and query.
func IsSafeHTTPURL(raw string) bool {
	// Reject control characters and whitespace anywhere in the URL — the
	// net/url parser will happily round-trip a URL containing a NUL byte or
	// tab, but browsers interpret them inconsistently, opening XSS vectors.
	//
	// Important: scan the ORIGINAL input, not a trimmed copy. TrimSpace
	// strips trailing \n/\t, which would let a malicious "http://x\n" slip
	// past this check.
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}

	u, err := url.Parse(s)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	// url.Parse accepts "http:foo" (no //) as scheme "http", opaque "foo".
	// Demand a network-style URL with an actual host.
	if u.Host == "" {
		return false
	}
	return true
}

// SanitizeHTTPURLOrEmpty returns raw verbatim if safe, otherwise "". This is
// the function callers should reach for when writing user-supplied URL data
// to the database — it turns "javascript:alert(1)" into "" before storage,
// which is much safer than storing garbage and hoping every read-side render
// remembers to re-check.
func SanitizeHTTPURLOrEmpty(raw string) string {
	if IsSafeHTTPURL(raw) {
		return strings.TrimSpace(raw)
	}
	return ""
}
