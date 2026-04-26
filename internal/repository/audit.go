// audit.go — login_history 与 activity_log 的存储层。
//
// 修改 (2026-04):
//   - 新增 ListByUserPaged / CountByUser / Count 方法,前端账户中心和
//     管理员审计页都要做 10 条/页 + 总条数翻页,旧的 ListByUser 只是
//     "最近 N 条",不能翻页。
package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

type LoginHistoryRepo struct{ db *sql.DB }

func NewLoginHistoryRepo(db *sql.DB) *LoginHistoryRepo { return &LoginHistoryRepo{db: db} }

// Record appends a login attempt. userID may be empty (login attempt with
// unknown email). Never errors in a way callers act on — failure to write
// audit should not block the actual login response.
func (r *LoginHistoryRepo) Record(h model.LoginHistory) error {
	if h.ID == "" {
		h.ID = uuid.NewString()
	}
	if h.Timestamp == "" {
		h.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	var userID sql.NullString
	if h.UserID != "" {
		userID = sql.NullString{String: h.UserID, Valid: true}
	}
	success := 0
	if h.Success {
		success = 1
	}
	_, err := r.db.Exec(`
		INSERT INTO login_history (id, user_id, email, ip, user_agent, success, reason, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		h.ID, userID, h.Email, h.IP, h.UserAgent, success, h.Reason, h.Timestamp)
	return err
}

// ListByUser returns the most recent N entries for a single user.
// Kept for backward compat — new callers should use ListByUserPaged.
func (r *LoginHistoryRepo) ListByUser(userID string, limit int) ([]model.LoginHistory, error) {
	return r.ListByUserPaged(userID, limit, 0)
}

// ListByUserPaged supports limit + offset for client-side pagination.
func (r *LoginHistoryRepo) ListByUserPaged(userID string, limit, offset int) ([]model.LoginHistory, error) {
	rows, err := r.db.Query(`
		SELECT id, COALESCE(user_id, ''), email, ip, user_agent, success, reason, timestamp
		FROM login_history
		WHERE user_id = ?
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLoginRows(rows)
}

// CountByUser returns the total login_history rows for a user, used by
// pagination UI to render page numbers.
func (r *LoginHistoryRepo) CountByUser(userID string) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM login_history WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

// ListAll is for admin UI. Paged.
func (r *LoginHistoryRepo) ListAll(limit, offset int) ([]model.LoginHistory, error) {
	rows, err := r.db.Query(`
		SELECT id, COALESCE(user_id, ''), email, ip, user_agent, success, reason, timestamp
		FROM login_history
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLoginRows(rows)
}

// Count returns total login_history rows site-wide.
func (r *LoginHistoryRepo) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM login_history`).Scan(&n)
	return n, err
}

func scanLoginRows(rows *sql.Rows) ([]model.LoginHistory, error) {
	var out []model.LoginHistory
	for rows.Next() {
		var h model.LoginHistory
		var success int
		if err := rows.Scan(&h.ID, &h.UserID, &h.Email, &h.IP, &h.UserAgent,
			&success, &h.Reason, &h.Timestamp); err != nil {
			return nil, err
		}
		h.Success = success == 1
		out = append(out, h)
	}
	return out, rows.Err()
}

// PruneOlderThan deletes rows older than cutoff. Returns row count.
func (r *LoginHistoryRepo) PruneOlderThan(cutoff time.Time) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM login_history WHERE timestamp < ?`,
		cutoff.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// LastSuccessfulForUser returns the timestamp (RFC3339 string) of the
// user's most recent successful login_history entry, or empty string if
// none exists. Used by the session "resume" tracker to decide whether
// enough time has passed to count the current request as a fresh login.
func (r *LoginHistoryRepo) LastSuccessfulForUser(userID string) (string, error) {
	var ts string
	err := r.db.QueryRow(`
		SELECT timestamp FROM login_history
		WHERE user_id = ? AND success = 1
		ORDER BY timestamp DESC LIMIT 1`, userID).Scan(&ts)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return ts, err
}

// ─────────────────────────────────────────────────────────────────────────

type ActivityLogRepo struct{ db *sql.DB }

func NewActivityLogRepo(db *sql.DB) *ActivityLogRepo { return &ActivityLogRepo{db: db} }

func (r *ActivityLogRepo) Record(a model.ActivityLog) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.Timestamp == "" {
		a.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	if a.Meta == "" {
		a.Meta = "{}"
	}
	var userID sql.NullString
	if a.UserID != "" {
		userID = sql.NullString{String: a.UserID, Valid: true}
	}
	_, err := r.db.Exec(`
		INSERT INTO activity_log (id, user_id, username, email, action, detail, target, ip, meta, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, userID, a.Username, a.Email, a.Action, a.Detail, a.Target, a.IP, a.Meta, a.Timestamp)
	return err
}

// ListByUser kept for legacy callers; new callers should use ListByUserPaged.
func (r *ActivityLogRepo) ListByUser(userID string, limit int) ([]model.ActivityLog, error) {
	return r.ListByUserPaged(userID, limit, 0)
}

func (r *ActivityLogRepo) ListByUserPaged(userID string, limit, offset int) ([]model.ActivityLog, error) {
	rows, err := r.db.Query(`
		SELECT id, COALESCE(user_id, ''), username, email, action, detail,
		       COALESCE(target, ''), ip, meta, timestamp
		FROM activity_log WHERE user_id = ?
		ORDER BY timestamp DESC LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActivityRows(rows)
}

func (r *ActivityLogRepo) CountByUser(userID string) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM activity_log WHERE user_id = ?`, userID).Scan(&n)
	return n, err
}

func (r *ActivityLogRepo) ListAll(limit, offset int) ([]model.ActivityLog, error) {
	rows, err := r.db.Query(`
		SELECT id, COALESCE(user_id, ''), username, email, action, detail,
		       COALESCE(target, ''), ip, meta, timestamp
		FROM activity_log ORDER BY timestamp DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActivityRows(rows)
}

func (r *ActivityLogRepo) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM activity_log`).Scan(&n)
	return n, err
}

func scanActivityRows(rows *sql.Rows) ([]model.ActivityLog, error) {
	var out []model.ActivityLog
	for rows.Next() {
		var a model.ActivityLog
		if err := rows.Scan(&a.ID, &a.UserID, &a.Username, &a.Email, &a.Action,
			&a.Detail, &a.Target, &a.IP, &a.Meta, &a.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *ActivityLogRepo) PruneOlderThan(cutoff time.Time) (int64, error) {
	res, err := r.db.Exec(`DELETE FROM activity_log WHERE timestamp < ?`,
		cutoff.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
