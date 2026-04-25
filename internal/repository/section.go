package repository

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/qishu/profile/internal/model"
)

type SectionRepo struct{ db *sql.DB }

func NewSectionRepo(db *sql.DB) *SectionRepo { return &SectionRepo{db: db} }

const sectionCols = `id, name, slug, description, sort_order, created_at, updated_at`

func scanSection(row interface{ Scan(dest ...any) error }) (*model.Section, error) {
	var s model.Section
	if err := row.Scan(&s.ID, &s.Name, &s.Slug, &s.Description, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *SectionRepo) FindAll() ([]model.Section, error) {
	rows, err := r.db.Query(`SELECT ` + sectionCols + ` FROM sections ORDER BY sort_order ASC, created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Section
	for rows.Next() {
		s, err := scanSection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (r *SectionRepo) FindByID(id string) (*model.Section, error) {
	row := r.db.QueryRow(`SELECT `+sectionCols+` FROM sections WHERE id = ?`, id)
	return scanSection(row)
}

func (r *SectionRepo) FindBySlug(slug string) (*model.Section, error) {
	row := r.db.QueryRow(`SELECT `+sectionCols+` FROM sections WHERE slug = ?`, slug)
	return scanSection(row)
}

type SectionInput struct {
	Name        string
	Slug        string
	Description string
	SortOrder   int
}

func (r *SectionRepo) Create(in SectionInput) (*model.Section, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()
	_, err := r.db.Exec(`
		INSERT INTO sections (id, name, slug, description, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, in.Name, in.Slug, in.Description, in.SortOrder, now, now)
	if err != nil {
		return nil, err
	}
	return r.FindByID(id)
}

func (r *SectionRepo) Update(id string, in SectionInput) (*model.Section, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.Exec(`
		UPDATE sections SET name = ?, slug = ?, description = ?, sort_order = ?, updated_at = ?
		WHERE id = ?`,
		in.Name, in.Slug, in.Description, in.SortOrder, now, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.FindByID(id)
}

func (r *SectionRepo) Delete(id string) error {
	res, err := r.db.Exec(`DELETE FROM sections WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SectionRepo) Count() (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM sections`).Scan(&n)
	return n, err
}
