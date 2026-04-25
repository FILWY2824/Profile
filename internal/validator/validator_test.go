package validator

import (
	"strings"
	"testing"
)

func TestValidateEmail(t *testing.T) {
	good := []string{
		"a@b.co",
		"user.name+tag@example.com",
		"中文@中文.cn",
	}
	for _, e := range good {
		if err := ValidateEmail(e); err != nil {
			t.Errorf("ValidateEmail(%q) rejected: %v", e, err)
		}
	}
	bad := []string{
		"",
		"   ",
		"nope",
		"@nodomain",
		"nouser@",
		strings.Repeat("a", 300) + "@x.co",
	}
	for _, e := range bad {
		if err := ValidateEmail(e); err == nil {
			t.Errorf("ValidateEmail(%q) accepted, should reject", e)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	good := []string{
		"Abcdef12",      // upper+lower+digit
		"abcdef12",      // lower+digit
		"秋天的落叶2024",      // non-ascii+digit (two classes: other+digit)
		"password!",     // lower+symbol
	}
	for _, p := range good {
		if err := ValidatePassword(p); err != nil {
			t.Errorf("ValidatePassword(%q) rejected: %v", p, err)
		}
	}
	bad := []string{
		"",
		"short",         // too short
		"password",      // only lower, one class
		"12345678",      // only digit, one class
		"ABCDEFGH",      // only upper, one class
		strings.Repeat("a", 130) + "1", // too long
	}
	for _, p := range bad {
		if err := ValidatePassword(p); err == nil {
			t.Errorf("ValidatePassword(%q) accepted, should reject", p)
		}
	}
}

func TestValidateSlug(t *testing.T) {
	good := []string{"foo", "foo-bar", "a1", "a-b-c-1"}
	for _, s := range good {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("ValidateSlug(%q) rejected: %v", s, err)
		}
	}
	bad := []string{
		"",
		"Foo",            // uppercase
		"-foo",           // leading hyphen
		"foo-",           // trailing hyphen
		"foo--bar",       // double hyphen
		"foo_bar",        // underscore
		"foo.bar",        // dot
		"foo bar",        // space
		strings.Repeat("a", 65),
	}
	for _, s := range bad {
		if err := ValidateSlug(s); err == nil {
			t.Errorf("ValidateSlug(%q) accepted, should reject", s)
		}
	}
}

func TestValidateName(t *testing.T) {
	if err := ValidateName("a"); err == nil {
		t.Error("1-char name should be rejected")
	}
	if err := ValidateName("ab"); err != nil {
		t.Errorf("2-char name rejected: %v", err)
	}
	if err := ValidateName(strings.Repeat("z", 33)); err == nil {
		t.Error("33-char name should be rejected")
	}
	// Chinese is rune-counted, not byte-counted
	if err := ValidateName(strings.Repeat("中", 32)); err != nil {
		t.Errorf("32 Chinese chars rejected: %v", err)
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Alice@Example.COM  "); got != "alice@example.com" {
		t.Errorf("NormalizeEmail = %q", got)
	}
}
