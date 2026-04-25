package repository

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

type VCodeRepo struct{ db *sql.DB }

func NewVCodeRepo(db *sql.DB) *VCodeRepo { return &VCodeRepo{db: db} }

// HashCode 把明文验证码做 SHA-256 -> hex,存进 code_hash 列。
// 我们没有用 bcrypt 因为 6 位数字字典空间小(10^6),bcrypt 的延迟反而成为
// DOS 放大器,且 SHA-256 + 限流(每邮箱每分钟最多 N 次发码) 已足以防暴破。
func HashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

type IssueInput struct {
	Email     string
	Code      string // 明文,本函数内做 hash
	Type      string
	IP        string
	Meta      string
	ExpiresAt time.Time
}

// Issue 把同 (email,type) 旧未使用码标记为已使用,然后插入新行。
func (r *VCodeRepo) Issue(in IssueInput) (*model.VerificationCode, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE verification_codes SET used = 1 WHERE email = ? AND type = ? AND used = 0`,
		in.Email, in.Type,
	); err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	hash := HashCode(in.Code)
	if _, err := tx.Exec(`
		INSERT INTO verification_codes (id, email, code, code_hash, type, ip, meta, attempts, used, expires_at, created_at)
		VALUES (?, ?, '', ?, ?, ?, ?, 0, 0, ?, ?)`,
		id, in.Email, hash, in.Type, in.IP, in.Meta,
		in.ExpiresAt.UTC().Format(time.RFC3339), now,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &model.VerificationCode{
		ID: id, Email: in.Email, Type: in.Type, IP: in.IP,
		Meta: in.Meta, Used: false, ExpiresAt: in.ExpiresAt.UTC().Format(time.RFC3339),
		CreatedAt: now,
	}, nil
}

// FindActive 返回最近一条未使用的码(不返回 hash 给业务层)。
func (r *VCodeRepo) FindActive(email, codeType string) (*model.VerificationCode, error) {
	row := r.db.QueryRow(`
		SELECT id, email, code_hash, type, ip, meta, attempts, used, expires_at, created_at
		FROM verification_codes
		WHERE email = ? AND type = ? AND used = 0
		ORDER BY created_at DESC
		LIMIT 1`, email, codeType)

	var v model.VerificationCode
	var used int
	var hash string
	if err := row.Scan(&v.ID, &v.Email, &hash, &v.Type, &v.IP, &v.Meta,
		&v.Attempts, &used, &v.ExpiresAt, &v.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.Used = used == 1
	v.CodeHash = hash
	return &v, nil
}

// VerifyCode 等值校验 hash,常量时间。
func (r *VCodeRepo) VerifyCode(stored, plainCandidate string) bool {
	if stored == "" {
		return false
	}
	want := HashCode(plainCandidate)
	if len(stored) != len(want) {
		return false
	}
	var diff byte
	for i := 0; i < len(stored); i++ {
		diff |= stored[i] ^ want[i]
	}
	return diff == 0
}

func (r *VCodeRepo) IncrementAttempts(id string) (int, error) {
	_, err := r.db.Exec(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`, id)
	if err != nil {
		return 0, err
	}
	var n int
	err = r.db.QueryRow(`SELECT attempts FROM verification_codes WHERE id = ?`, id).Scan(&n)
	return n, err
}

// ConsumeIfUnused 原子地把 used=0 -> 1。返回是否成功(true 表示这次调用确实
// 把它消费掉了,false 表示之前已经被消费或不存在)。
// 这是修复"消费不是原子操作"问题的关键。
func (r *VCodeRepo) ConsumeIfUnused(id string) (bool, error) {
	res, err := r.db.Exec(`UPDATE verification_codes SET used = 1 WHERE id = ? AND used = 0`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// MarkUsed 兼容旧路径(非原子,不再推荐)。
func (r *VCodeRepo) MarkUsed(id string) error {
	_, err := r.db.Exec(`UPDATE verification_codes SET used = 1 WHERE id = ?`, id)
	return err
}

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
