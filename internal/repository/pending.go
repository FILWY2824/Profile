package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

// PendingRegistration 取代之前把 password hash 塞进 verification_codes.meta
// 的做法。注册流程:
//   1. POST /register   -> 创建 PendingRegistration + 发验证码
//   2. POST /register/confirm 验码成功 -> 取出 PendingRegistration -> 创建 User
//      并删除 PendingRegistration
type PendingRegistration struct {
	ID           string
	Email        string
	PasswordHash string
	Name         string
	ExpiresAt    string
	CreatedAt    string
}

type PendingRepo struct{ db *sql.DB }

func NewPendingRepo(db *sql.DB) *PendingRepo { return &PendingRepo{db: db} }

// Upsert 先删该 email 的旧 pending,再插新的。注册流程允许用户重新发起,
// 这是"覆盖式"语义。
func (r *PendingRepo) Upsert(email, passwordHash, name string, expires time.Time) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM pending_registrations WHERE email = ?`, email); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = tx.Exec(`
		INSERT INTO pending_registrations (id, email, password_hash, name, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), email, passwordHash, name,
		expires.UTC().Format(time.RFC3339), now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// Take 原子地取出并删除一条记录。如果记录不存在或已过期,返回 ErrNotFound。
func (r *PendingRepo) Take(email string) (*PendingRegistration, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var p PendingRegistration
	err = tx.QueryRow(`
		SELECT id, email, password_hash, name, expires_at, created_at
		FROM pending_registrations WHERE email = ? LIMIT 1`, email).
		Scan(&p.ID, &p.Email, &p.PasswordHash, &p.Name, &p.ExpiresAt, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if expired, _ := time.Parse(time.RFC3339, p.ExpiresAt); time.Now().After(expired) {
		_, _ = tx.Exec(`DELETE FROM pending_registrations WHERE id = ?`, p.ID)
		_ = tx.Commit()
		return nil, ErrNotFound
	}

	if _, err := tx.Exec(`DELETE FROM pending_registrations WHERE id = ?`, p.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *PendingRepo) PruneExpired() (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(`DELETE FROM pending_registrations WHERE expires_at < ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
