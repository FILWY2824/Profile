// Package auth handles password hashing, JWT sign/verify, and HTTP-cookie
// session extraction. Every security-critical decision about "who is this
// request from?" goes through here — adding another code path that answers
// that question without consulting ResolveSession is a mistake.
package auth

import (
	"crypto/subtle"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// CookieName is the single name we use for auth cookies everywhere. If you
// need to change it, update it here and in any curl/test that hard-codes it.
const CookieName = "qishu_token"

// bcryptCost=12 is a 2024 sweet spot: ~250ms on modern x86, slow enough to
// deter offline brute-force but fast enough that a login request doesn't
// feel sluggish. Doubles roughly every +1.
const bcryptCost = 12

// dummyHash is used by ConstantTimeVerify to burn an equivalent amount of
// CPU when the user doesn't exist, preventing user enumeration via response
// timing. It's generated once at import time from an unguessable input.
var dummyHash = func() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("this-is-a-dummy-hash-not-a-real-password-zq7b3"), bcryptCost)
	if err != nil {
		// Can't happen — bcrypt.GenerateFromPassword only fails on cost OOB.
		panic(err)
	}
	return h
}()

// HashPassword is the only place bcrypt.GenerateFromPassword is called in
// the project. Centralising it makes cost bumps a one-line change.
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// VerifyPassword returns nil on match. It is NOT timing-safe when the hash
// itself is missing — use ConstantTimeVerify in login paths where the email
// might not exist.
func VerifyPassword(hash, plain string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
}

// ConstantTimeVerify runs VerifyPassword against realHash if non-empty,
// otherwise against a precomputed dummy hash so both branches take roughly
// the same wall-clock time. Returns true iff realHash was non-empty and the
// password matched.
//
// This is a bog-standard defence against user-enumeration via login timing.
// Without it, "email does not exist" returns in <1ms while "wrong password"
// takes ~250ms, and an attacker can tell the difference from a browser tab.
func ConstantTimeVerify(realHash, plain string) bool {
	if realHash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(plain))
		return false
	}
	err := bcrypt.CompareHashAndPassword([]byte(realHash), []byte(plain))
	return err == nil
}

// Claims is the JWT payload we embed in session cookies. Kept minimal —
// anything large goes in the DB keyed by sub.
type Claims struct {
	UserID string `json:"sub"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// Signer owns the HS256 secret and the session lifetime. Construct one at
// process boot and pass it into handlers via dependency injection — do not
// add a package-level global; it makes tests harder and conflicts with the
// "no hidden state" rule we're trying to maintain after the refactor.
type Signer struct {
	secret        []byte
	sessionExpiry time.Duration
}

// NewSigner returns a Signer. Callers are responsible for length-checking
// secret beforehand; this constructor trusts its input.
func NewSigner(secret string, sessionExpiry time.Duration) *Signer {
	return &Signer{secret: []byte(secret), sessionExpiry: sessionExpiry}
}

// Sign produces a JWT for the given user identity.
func (s *Signer) Sign(userID, email, role string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.sessionExpiry)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

// Verify parses token and returns its claims, rejecting anything that:
//   - uses a non-HS256 algorithm (prevents alg:none attacks)
//   - has a bad signature
//   - is expired or not-yet-valid
//
// We never return partial claims on error — callers only get nil on fail.
func (s *Signer) Verify(token string) (*Claims, error) {
	var claims Claims
	_, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	return &claims, nil
}

// SessionExpiry exposes the configured session lifetime; handlers need it
// when setting cookie Max-Age.
func (s *Signer) SessionExpiry() time.Duration { return s.sessionExpiry }

// ConstantTimeEqual wraps subtle.ConstantTimeCompare so callers don't have
// to cast []byte everywhere. Returns true iff a and b are equal. Use for
// comparing fixed-length secrets like CSRF tokens and verification codes.
func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
