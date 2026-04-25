package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

type VCodeRepo struct{ db *sql.DB }

func NewVCodeRepo(db *sql.DB) *VCodeRepo { return &VCodeRepo{db: db} }

// IssueInput packs the fields that vary per call; Code is supplied by the
// caller so the same random generator is used everywhere (see
// internal/handler/auth.go#newCode).
type IssueInput struct {
	Email     string
	Code      string
	Type      string
	IP        string
	Meta      string
	ExpiresAt time.Time
}

// Issue invalidates any prior unused code for (email, type) — that's the
// "send again" semantics users expect: the old code stops working the
// moment a new one is issued.
func (r *VCodeRepo) Issue(in IssueInput) (*model.VerificationCode, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Superseded old codes don't need deleting — the "used=1" flag is
	// enough and preserves audit trail. Callers looking up "latest active"
	// already filter used=0.
	if _, err := tx.Exec(
		`UPDATE verification_codes SET used = 1 WHERE email = ? AND type = ? AND used = 0`,
		in.Email, in.Type,
	); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	if _, err := tx.Exec(`
		INSERT INTO verification_codes (id, email, code, type, ip, meta, attempts, used, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
		id, in.Email, in.Code, in.Type, in.IP, in.Meta,
		in.ExpiresAt.UTC().Format(time.RFC3339), now,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &model.VerificationCode{
		ID: id, Email: in.Email, Code: in.Code, Type: in.Type, IP: in.IP,
		Meta: in.Meta, Used: false, ExpiresAt: in.ExpiresAt.UTC().Format(time.RFC3339),
		CreatedAt: now,
	}, nil
}

// FindActive returns the most recent unused, unexpired code for (email, type)
// or ErrNotFound. Handlers check expiry again because there's a race window
// between "SELECT" and "now" — cheap to re-check.
func (r *VCodeRepo) FindActive(email, codeType string) (*model.VerificationCode, error) {
	row := r.db.QueryRow(`
		SELECT id, email, code, type, ip, meta, attempts, used, expires_at, created_at
		FROM verification_codes
		WHERE email = ? AND type = ? AND used = 0
		ORDER BY created_at DESC
		LIMIT 1`, email, codeType)

	var v model.VerificationCode
	var used int
	if err := row.Scan(&v.ID, &v.Email, &v.Code, &v.Type, &v.IP, &v.Meta,
		&v.Attempts, &used, &v.ExpiresAt, &v.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.Used = used == 1
	return &v, nil
}

// IncrementAttempts atomically increments the attempts column and returns the
// new value. Used to implement "5 wrong tries and this code is dead".
func (r *VCodeRepo) IncrementAttempts(id string) (int, error) {
	_, err := r.db.Exec(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`, id)
	if err != nil {
		return 0, err
	}
	var n int
	err = r.db.QueryRow(`SELECT attempts FROM verification_codes WHERE id = ?`, id).Scan(&n)
	return n, err
}

// MarkUsed flags the row as consumed. Call from inside the same handler that
// validated the code — once used it can never be validated again.
func (r *VCodeRepo) MarkUsed(id string) error {
	_, err := r.db.Exec(`UPDATE verification_codes SET used = 1 WHERE id = ?`, id)
	return err
}

// PruneExpired deletes used-or-expired codes older than cutoff. Called from
// the periodic sweeper to keep the table from growing forever. Returns the
// number of deleted rows so the sweeper can log something only when it
// matters.
func (r *VCodeRepo) PruneExpired() (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(
		`DELETE FROM verification_codes WHERE used = 1 OR expires_at < ?`, now,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
