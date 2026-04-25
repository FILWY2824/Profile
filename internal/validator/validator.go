// Package validator owns every input-length and format check in the project.
// Keeping it in one file turns "what's the max length of bio again?" into a
// single grep instead of a spelunk through handlers.
package validator

import (
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"
)

// ─── Field length caps ───
//
// These are rune counts, not byte counts. UTF-8 Chinese characters are 3
// bytes each, so a 200-byte limit on bio would translate to ~66 Chinese
// chars — much less than users expect. All limits below are in runes.
//
// Upper bounds were chosen from actual usage patterns in the original
// project (see AUDIT.md H7/H8 for the reasoning that led to these caps).
const (
	MaxEmailLen       = 254 // RFC 5321 §4.5.3.1.3
	MaxNameLen        = 32
	MaxBioLen         = 200
	MaxPasswordLen    = 128 // bcrypt truncates at 72 bytes anyway; we reject
	                        // obviously-long inputs so the cost of hashing
	                        // (and the memory for the request buffer) stays
	                        // bounded.
	MaxSectionNameLen        = 32
	MaxSectionDescLen        = 200
	MaxCardTitleLen          = 48
	MaxCardDescLen           = 200
	MaxCardURLLen            = 2048
	MaxOAuthClientNameLen    = 64
	MaxOAuthClientDescLen    = 500
	MaxSettingValueLen       = 4096
)

// ─── Regex ───
//
// slugRE: URL-safe identifier — alphanumeric + hyphen, 1-64 chars. We
// deliberately forbid underscores and dots so slugs stay copy-paste safe
// across URLs and command lines.
var (
	slugRE     = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	clientIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{4,64}$`)
)

// ValidateEmail returns nil if e is a syntactically valid email and within
// the RFC-mandated length. It does not do DNS lookups — that's a deploy-
// time check, not a signup-time check.
func ValidateEmail(e string) error {
	e = strings.TrimSpace(e)
	if e == "" {
		return errors.New("邮箱不能为空")
	}
	if utf8.RuneCountInString(e) > MaxEmailLen {
		return fmt.Errorf("邮箱过长(上限 %d 字符)", MaxEmailLen)
	}
	if _, err := mail.ParseAddress(e); err != nil {
		return errors.New("邮箱格式不正确")
	}
	return nil
}

// NormalizeEmail lowercases and trims. Always call this before looking up
// a user — the DB unique index is case-sensitive and we don't want
// "Alice@x.com" and "alice@x.com" becoming different accounts.
func NormalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}

// ValidatePassword enforces minimum strength. The old project required one
// upper, one lower, one digit — we keep the spirit but use a slightly more
// forgiving rule: length ≥ 8 and at least two of {upper, lower, digit,
// symbol}. This blocks "password" but allows "秋天的落叶2024" (an all-BMP
// Chinese + digit combo that the old regex would reject).
func ValidatePassword(pw string) error {
	n := utf8.RuneCountInString(pw)
	if n < 8 {
		return errors.New("密码至少 8 位")
	}
	if n > MaxPasswordLen {
		return fmt.Errorf("密码过长(上限 %d 位)", MaxPasswordLen)
	}
	var hasUpper, hasLower, hasDigit, hasOther bool
	for _, r := range pw {
		switch {
		case r >= 'A' && r <= 'Z':
			hasUpper = true
		case r >= 'a' && r <= 'z':
			hasLower = true
		case r >= '0' && r <= '9':
			hasDigit = true
		default:
			hasOther = true
		}
	}
	count := 0
	for _, b := range []bool{hasUpper, hasLower, hasDigit, hasOther} {
		if b {
			count++
		}
	}
	if count < 2 {
		return errors.New("密码需至少包含两类字符(大写/小写/数字/符号)")
	}
	return nil
}

// ValidateLen is a generic "length in runes" check — useful anywhere you
// don't already have a specialised helper.
func ValidateLen(fieldLabel, s string, min, max int) error {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	if n < min {
		return fmt.Errorf("%s至少 %d 字符", fieldLabel, min)
	}
	if n > max {
		return fmt.Errorf("%s超过 %d 字符", fieldLabel, max)
	}
	return nil
}

// ValidateName checks the user-visible display name. Very short names
// (< 2 chars) trigger collisions in UI space, so we floor at 2.
func ValidateName(n string) error {
	return ValidateLen("昵称", n, 2, MaxNameLen)
}

// ValidateBio permits empty (some users don't want one).
func ValidateBio(b string) error {
	if strings.TrimSpace(b) == "" {
		return nil
	}
	return ValidateLen("简介", b, 0, MaxBioLen)
}

// ValidateSlug matches the public URL format used for sections.
func ValidateSlug(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return errors.New("slug 不能为空")
	}
	if len(s) > 64 {
		return errors.New("slug 过长")
	}
	if !slugRE.MatchString(s) {
		return errors.New("slug 只能包含小写字母、数字与连字符,且不能以连字符开头/结尾")
	}
	return nil
}

// ValidateClientID enforces a mild shape on OAuth client identifiers. We
// want them greppable in logs without looking like free text.
func ValidateClientID(s string) error {
	if !clientIDRE.MatchString(s) {
		return errors.New("client_id 只能包含字母/数字/下划线/连字符,长度 4-64")
	}
	return nil
}

// ValidatePermission guards the card permission enum. Not using Go's iota
// here because we store the string form in DB for readability.
func ValidatePermission(p string) error {
	switch p {
	case "public", "user", "member", "admin":
		return nil
	}
	return errors.New("permission 必须是 public/user/member/admin 之一")
}

// ValidateRole guards the user role enum.
func ValidateRole(r string) error {
	switch r {
	case "user", "member", "admin":
		return nil
	}
	return errors.New("role 必须是 user/member/admin 之一")
}
