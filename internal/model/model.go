// Package model holds the DB row types used across repositories and handlers.
// These are plain structs — no ORM, no tags that do anything at runtime other
// than JSON serialisation. Field layout matches the columns in migrations/.
package model

// Role and Status enums — string-valued to stay readable in sqlite3 CLI.
const (
	RoleUser   = "user"
	RoleMember = "member"
	RoleAdmin  = "admin"

	StatusActive   = "active"
	StatusBanned   = "banned"
	StatusDisabled = "disabled"

	PermPublic = "public"
	PermUser   = "user"
	PermMember = "member"
	PermAdmin  = "admin"

	VCodeRegister       = "register"
	VCodeEmailVerify    = "email_verify"
	VCodeForgotPassword = "forgot_password"
	VCodeChangePassword = "change_password"
	VCodeChangeEmail    = "change_email"
)

// User is the authenticated principal. PasswordHash is bcrypt output; we never
// serialise it to JSON (json:"-"). Likewise LastLoginIP is admin-visible only,
// it shouldn't leak through /api/account/profile — handlers project to DTOs.
type User struct {
	ID                 string `json:"id"`
	Email              string `json:"email"`
	PasswordHash       string `json:"-"`
	Name               string `json:"name"`
	Role               string `json:"role"`
	Status             string `json:"status"`
	EmailVerified      bool   `json:"emailVerified"`
	Bio                string `json:"bio"`
	Avatar             string `json:"avatar"`
	LastLoginIP        string `json:"lastLoginIp,omitempty"`
	LastLoginAt        string `json:"lastLoginAt,omitempty"`
	PasswordChangedAt  string `json:"passwordChangedAt,omitempty"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

// Section groups related cards on the homepage. Slug is the human-readable
// identifier used in URLs.
type Section struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
	SortOrder   int    `json:"order"` // JSON key kept as "order" for FE compat
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// Card is a single link shown on the homepage.
type Card struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
	SectionID   string `json:"sectionId,omitempty"`
	SortOrder   int    `json:"order"`
	Permission  string `json:"permission"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// VerificationCode backs the email-bound OTP for registration, email change,
// password reset, and password change. A single table with a `type` column is
// easier to audit than four near-identical tables.
type VerificationCode struct {
	ID        string
	Email     string
	Code      string
	Type      string
	IP        string
	Meta      string // JSON blob; contents depend on Type
	Attempts  int
	Used      bool
	ExpiresAt string
	CreatedAt string
}

// LoginHistory records every authentication attempt, successful or not. Kept
// for user-visible "recent logins" UX and admin incident response.
type LoginHistory struct {
	ID        string `json:"id"`
	UserID    string `json:"userId,omitempty"`
	Email     string `json:"email"`
	IP        string `json:"ip"`
	UserAgent string `json:"userAgent"`
	Success   bool   `json:"success"`
	Reason    string `json:"reason"`
	Timestamp string `json:"timestamp"`
}

// ActivityLog is the generic audit trail: settings changes, permission
// changes, content edits, etc. Detail and Meta are intentionally free-form.
type ActivityLog struct {
	ID        string `json:"id"`
	UserID    string `json:"userId,omitempty"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	Target    string `json:"target,omitempty"`
	IP        string `json:"ip"`
	Meta      string `json:"meta"`
	Timestamp string `json:"timestamp"`
}

// Setting is one row in the settings table. Category groups keys in the admin
// UI; Sensitive=true means the value is masked until the admin clicks
// "reveal" (and the reveal is itself logged).
type Setting struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Sensitive   bool   `json:"sensitive"`
	UpdatedAt   string `json:"updatedAt"`
}
