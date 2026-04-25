package repository

import (
	"database/sql"
	"errors"
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
// origin matches. Used as the guard on /api/favicons/image — we only fetch
// favicons for origins we already reference, which blocks the DoS/SSRF
// vector where an attacker feeds arbitrary origins.
func (r *CardRepo) ReferencesOrigin(origin string) (bool, error) {
	var n int
	// LIKE prefix match is fine for origin — the origin form is scheme://host
	// with no trailing slash; we match everything that starts with it.
	err := r.db.QueryRow(`SELECT COUNT(*) FROM cards WHERE url LIKE ? || '%'`, origin).Scan(&n)
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
