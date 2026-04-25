package repository

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

type CardRepo struct{ db *sql.DB }

func NewCardRepo(db *sql.DB) *CardRepo { return &CardRepo{db: db} }

const cardCols = `id, title, description, url, COALESCE(section_id, ''),
                   sort_order, permission, created_at, updated_at`

func scanCard(row interface{ Scan(dest ...any) error }) (*model.Card, error) {
	var c model.Card
	if err := row.Scan(&c.ID, &c.Title, &c.Description, &c.URL, &c.SectionID,
		&c.SortOrder, &c.Permission, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (r *CardRepo) FindAll() ([]model.Card, error) {
	rows, err := r.db.Query(`SELECT ` + cardCols + ` FROM cards ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Card
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *CardRepo) FindByID(id string) (*model.Card, error) {
	row := r.db.QueryRow(`SELECT `+cardCols+` FROM cards WHERE id = ?`, id)
	return scanCard(row)
}

// ReferencesOrigin reports whether any card currently links to a URL whose
// origin matches. 修复:用 `LIKE origin || '/%' ESCAPE '\'` + 等值兜底,
// 防止类似 https://a.com 误命中 https://a.com.attacker.com 的前缀匹配,以及
// origin 中包含 LIKE 元字符 _ % 时的误命中。
func (r *CardRepo) ReferencesOrigin(origin string) (bool, error) {
	// 转义 LIKE 元字符
	esc := func(s string) string {
		var b strings.Builder
		for _, c := range s {
			switch c {
			case '\\', '%', '_':
				b.WriteByte('\\')
			}
			b.WriteRune(c)
		}
		return b.String()
	}
	pattern := esc(origin) + "/%"
	var n int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM cards WHERE url = ? OR url LIKE ? ESCAPE '\'`,
		origin, pattern,
	).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

type CardInput struct {
	Title       string
	Description string
	URL         string
	SectionID   string
	SortOrder   int
	Permission  string
}

func (r *CardRepo) Create(in CardInput) (*model.Card, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	var sectionID sql.NullString
	if in.SectionID != "" {
		sectionID = sql.NullString{String: in.SectionID, Valid: true}
	}
	_, err := r.db.Exec(`
		INSERT INTO cards (id, title, description, url, section_id, sort_order, permission, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Title, in.Description, in.URL, sectionID, in.SortOrder, in.Permission, now, now)
	if err != nil {
		return nil, err
	}
	return r.FindByID(id)
}

func (r *CardRepo) Update(id string, in CardInput) (*model.Card, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	var sectionID sql.NullString
	if in.SectionID != "" {
		sectionID = sql.NullString{String: in.SectionID, Valid: true}
	}
	res, err := r.db.Exec(`
		UPDATE cards SET title = ?, description = ?, url = ?, section_id = ?,
		                 sort_order = ?, permission = ?, updated_at = ?
		WHERE id = ?`,
		in.Title, in.Description, in.URL, sectionID, in.SortOrder, in.Permission, now, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.FindByID(id)
}

func (r *CardRepo) Delete(id string) error {
	res, err := r.db.Exec(`DELETE FROM cards WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Count returns total card count for the dashboard.
func (r *CardRepo) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM cards`).Scan(&n)
	return n, err
}

// URLsByOrigin 返回所有 URL 完整字符串,匹配同 origin 的卡片。供 favicon 抓取
// 时按精确页面 URL 解析 <link rel="icon"> 用。
func (r *CardRepo) URLsByOrigin(origin string) ([]string, error) {
	esc := func(s string) string {
		var b strings.Builder
		for _, c := range s {
			switch c {
			case '\\', '%', '_':
				b.WriteByte('\\')
			}
			b.WriteRune(c)
		}
		return b.String()
	}
	pattern := esc(origin) + "/%"
	rows, err := r.db.Query(
		`SELECT url FROM cards WHERE url = ? OR url LIKE ? ESCAPE '\'`,
		origin, pattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
