package repository

import (
	"database/sql"
	"errors"
	"time"
)

// FaviconRow mirrors the favicon_cache table. The data_url field holds the
// pre-encoded `data:image/png;base64,...` blob — that means the read path
// is just "look up the row and write the string", no decode needed.
type FaviconRow struct {
	Origin         string
	DataURL        string
	ContentType    string
	Source         string
	FetchedAt      string
	FailedAttempts int
	LastError      string
}

type FaviconRepo struct{ db *sql.DB }

func NewFaviconRepo(db *sql.DB) *FaviconRepo { return &FaviconRepo{db: db} }

// Get returns the cached favicon for origin or ErrNotFound.
func (r *FaviconRepo) Get(origin string) (*FaviconRow, error) {
	var f FaviconRow
	err := r.db.QueryRow(
		`SELECT origin, data_url, content_type, source, fetched_at, failed_attempts, last_error
		 FROM favicon_cache WHERE origin = ?`, origin,
	).Scan(&f.Origin, &f.DataURL, &f.ContentType, &f.Source,
		&f.FetchedAt, &f.FailedAttempts, &f.LastError)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &f, nil
}

// Upsert creates or replaces a cache row. We use INSERT OR REPLACE because
// origin is the primary key — refreshing a successful fetch just overwrites.
func (r *FaviconRepo) Upsert(f FaviconRow) error {
	if f.FetchedAt == "" {
		f.FetchedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err := r.db.Exec(`
		INSERT OR REPLACE INTO favicon_cache
			(origin, data_url, content_type, source, fetched_at, failed_attempts, last_error)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		f.Origin, f.DataURL, f.ContentType, f.Source,
		f.FetchedAt, f.FailedAttempts, f.LastError)
	return err
}

// List returns all cached favicons for the admin UI. No paging — the table
// is bounded by the number of distinct origins across cards, which is small.
func (r *FaviconRepo) List() ([]FaviconRow, error) {
	rows, err := r.db.Query(`
		SELECT origin, data_url, content_type, source, fetched_at, failed_attempts, last_error
		FROM favicon_cache ORDER BY fetched_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FaviconRow
	for rows.Next() {
		var f FaviconRow
		if err := rows.Scan(&f.Origin, &f.DataURL, &f.ContentType, &f.Source,
			&f.FetchedAt, &f.FailedAttempts, &f.LastError); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *FaviconRepo) Delete(origin string) error {
	res, err := r.db.Exec(`DELETE FROM favicon_cache WHERE origin = ?`, origin)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
