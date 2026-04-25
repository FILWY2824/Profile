// Package repository hosts per-table SQL. Each repo takes a *sql.DB in its
// constructor; none of them own a global.
//
// Rule: no business logic here. Repos translate Go values to rows and back.
// "Don't allow banned users to log in" lives in a handler or service, not
// in a WHERE clause.
package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

// ErrNotFound is returned when a lookup finds zero rows. Callers can use
// errors.Is to distinguish "no row" from "DB error". We lift it here
// because importing sql.ErrNoRows into every handler is noisy.
var ErrNotFound = errors.New("not found")

type UserRepo struct{ db *sql.DB }

func NewUserRepo(db *sql.DB) *UserRepo { return &UserRepo{db: db} }

// userColumns is the canonical SELECT list — keep in sync with scanUser.
const userColumns = `id, email, password_hash, name, role, status, email_verified, bio, avatar,
                     COALESCE(last_login_ip, ''),
                     COALESCE(last_login_at, ''),
                     COALESCE(password_changed_at, ''),
                     created_at, updated_at`

func scanUser(row interface{ Scan(dest ...any) error }) (*model.User, error) {
	var u model.User
	var verified int
	if err := row.Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.Status, &verified,
		&u.Bio, &u.Avatar, &u.LastLoginIP, &u.LastLoginAt, &u.PasswordChangedAt,
		&u.CreatedAt, &u.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	u.EmailVerified = verified == 1
	return &u, nil
}

func (r *UserRepo) FindByID(id string) (*model.User, error) {
	row := r.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (r *UserRepo) FindByEmail(email string) (*model.User, error) {
	row := r.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE email = ?`, email)
	return scanUser(row)
}

// CreateInput is the minimal set of fields required to create a user.
// Callers set EmailVerified explicitly — the register flow leaves it false
// until the user confirms the code; scripts/create_admin passes true.
type CreateInput struct {
	Email         string
	PasswordHash  string
	Name          string
	Role          string
	EmailVerified bool
}

func (r *UserRepo) Create(in CreateInput) (*model.User, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	verified := 0
	if in.EmailVerified {
		verified = 1
	}
	_, err := r.db.Exec(`
		INSERT INTO users (id, email, password_hash, name, role, status, email_verified,
		                   bio, avatar, last_login_ip, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'active', ?, '', '', '', ?, ?)`,
		id, in.Email, in.PasswordHash, in.Name, in.Role, verified, now, now)
	if err != nil {
		return nil, err
	}
	return r.FindByID(id)
}

// UpdateLastLogin records the IP and timestamp of the most recent
// successful login. Used by the admin "when did X last log in?" query and
// nothing else — does not affect session validity.
func (r *UserRepo) UpdateLastLogin(id, ip string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.Exec(
		`UPDATE users SET last_login_ip = ?, last_login_at = ?, updated_at = ? WHERE id = ?`,
		ip, now, now, id,
	)
	return err
}

// SetPassword sets a new password hash and stamps password_changed_at so
// existing JWTs from before the change get rejected by the session check.
func (r *UserRepo) SetPassword(id, newHash string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.Exec(
		`UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?`,
		newHash, now, now, id,
	)
	return err
}

// MarkEmailVerified flips the flag. Idempotent.
func (r *UserRepo) MarkEmailVerified(id string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.Exec(
		`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`, now, id,
	)
	return err
}

// CountByRole returns admin/member/user totals for the dashboard. One query,
// O(1) rows returned.
func (r *UserRepo) CountByRole() (map[string]int, error) {
	rows, err := r.db.Query(`SELECT role, COUNT(*) FROM users GROUP BY role`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]int)
	for rows.Next() {
		var role string
		var n int
		if err := rows.Scan(&role, &n); err != nil {
			return nil, err
		}
		out[role] = n
	}
	return out, rows.Err()
}

// Count returns total user count.
func (r *UserRepo) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// List returns a paginated slice of users ordered by created_at DESC.
// Filter args may be empty — empty role/status skip that filter.
func (r *UserRepo) List(role, status string, limit, offset int) ([]model.User, error) {
	// We avoid a single SQL with optional WHERE branches to keep planning
	// simple. Two cases cover all current callers.
	q := `SELECT ` + userColumns + ` FROM users`
	args := []any{}
	clauses := []string{}
	if role != "" {
		clauses = append(clauses, "role = ?")
		args = append(args, role)
	}
	if status != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, status)
	}
	if len(clauses) > 0 {
		q += " WHERE "
		for i, c := range clauses {
			if i > 0 {
				q += " AND "
			}
			q += c
		}
	}
	q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := r.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// UpdateProfile changes name/bio/avatar — fields the user is allowed to
// edit on themselves. Email and role are NOT here; those need separate
// admin/verification flows.
func (r *UserRepo) UpdateProfile(id, name, bio, avatar string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`UPDATE users SET name = ?, bio = ?, avatar = ?, updated_at = ? WHERE id = ?`,
		name, bio, avatar, now, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AdminUpdate is the admin-only mutator: changes role, status, name, bio.
// Email changes go through the email-change verification flow (phase 3+).
func (r *UserRepo) AdminUpdate(id, name, role, status, bio string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`UPDATE users SET name = ?, role = ?, status = ?, bio = ?, updated_at = ? WHERE id = ?`,
		name, role, status, bio, now, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes a user row. Cascades not declared on FKs (we used SET NULL
// in the schema for cards.section_id, but users isn't referenced anywhere
// non-nullably). Callers should sanity-check "is this the last admin?"
// before invoking.
func (r *UserRepo) Delete(id string) error {
	res, err := r.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountAdmins is the safety check before deleting/demoting an admin —
// "don't lock everyone out".
func (r *UserRepo) CountAdmins() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'`).Scan(&n)
	return n, err
}
