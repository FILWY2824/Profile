package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestHashAndVerify(t *testing.T) {
	h, err := HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPassword(h, "correct-horse-battery-staple"); err != nil {
		t.Errorf("matching password failed: %v", err)
	}
	if err := VerifyPassword(h, "wrong"); err == nil {
		t.Error("wrong password accepted")
	}
}

func TestConstantTimeVerify(t *testing.T) {
	h, _ := HashPassword("goodpass")

	if !ConstantTimeVerify(h, "goodpass") {
		t.Error("correct password rejected")
	}
	if ConstantTimeVerify(h, "badpass") {
		t.Error("wrong password accepted")
	}
	// Empty hash must go through the dummy path and return false.
	if ConstantTimeVerify("", "anything") {
		t.Error("empty hash should never verify")
	}
}

// TestConstantTimeVerifyTiming is a probabilistic check that the dummy path
// takes similar time to a real verify. Not bit-accurate — we want to catch
// cases where someone accidentally shortcuts the empty-hash branch.
func TestConstantTimeVerifyTiming(t *testing.T) {
	h, _ := HashPassword("real-password")

	start := time.Now()
	for i := 0; i < 3; i++ {
		ConstantTimeVerify(h, "wrong")
	}
	realDur := time.Since(start)

	start = time.Now()
	for i := 0; i < 3; i++ {
		ConstantTimeVerify("", "anything")
	}
	dummyDur := time.Since(start)

	ratio := float64(dummyDur) / float64(realDur)
	if ratio < 0.3 || ratio > 3.0 {
		t.Errorf("dummy vs real timing ratio way off: %.2f (real=%s dummy=%s) — enumeration risk",
			ratio, realDur, dummyDur)
	}
}

func TestJWTSignVerify(t *testing.T) {
	s := NewSigner("0123456789abcdef0123456789abcdef", time.Hour)
	tok, err := s.Sign("uid-1", "a@b.com", "user")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := s.Verify(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != "uid-1" || claims.Email != "a@b.com" || claims.Role != "user" {
		t.Errorf("claims mismatch: %+v", claims)
	}
}

func TestJWTVerify_RejectsBadSecret(t *testing.T) {
	a := NewSigner("secret-a-secret-a-secret-a-secret", time.Hour)
	b := NewSigner("secret-b-secret-b-secret-b-secret", time.Hour)
	tok, _ := a.Sign("u", "e", "user")
	if _, err := b.Verify(tok); err == nil {
		t.Error("token signed with a different secret must be rejected")
	}
}

func TestJWTVerify_RejectsAlgNone(t *testing.T) {
	// Build a valid claim set, sign it with the 'none' algorithm manually.
	// The verifier must reject this — this is the classic alg:none attack.
	s := NewSigner("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", time.Hour)
	claims := Claims{
		UserID: "u", Email: "e", Role: "user",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	raw, _ := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := s.Verify(raw); err == nil {
		t.Error("alg:none token must be rejected")
	}
}

func TestJWTVerify_RejectsExpired(t *testing.T) {
	s := NewSigner("ssssssssssssssssssssssssssssssss", -time.Hour)
	// Session expiry is negative, so Sign produces a token that's already
	// expired.
	tok, _ := s.Sign("u", "e", "user")
	if _, err := s.Verify(tok); err == nil {
		t.Error("expired token must be rejected")
	}
}

func TestConstantTimeEqual(t *testing.T) {
	if !ConstantTimeEqual("abc", "abc") {
		t.Error("equal strings should compare equal")
	}
	if ConstantTimeEqual("abc", "abd") {
		t.Error("different strings should not compare equal")
	}
	if ConstantTimeEqual("abc", "abcd") {
		t.Error("different-length strings should not compare equal")
	}
}

func TestDummyHashIsReal(t *testing.T) {
	// Sanity: dummyHash should be a bcrypt-format hash.
	if !strings.HasPrefix(string(dummyHash), "$2a$") && !strings.HasPrefix(string(dummyHash), "$2b$") {
		t.Error("dummyHash not in bcrypt format")
	}
}
