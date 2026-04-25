// Package db owns the single SQLite handle for the process. It is deliberately
// a thin wrapper: business code talks to repositories (internal/repository),
// which hold a *sql.DB injected from here. No globals.
//
// 改动:从 github.com/mattn/go-sqlite3 (CGO) 切换到 modernc.org/sqlite (纯 Go),
// 容器构建无需 CGO/musl,二进制完全静态。驱动名从 "sqlite3" 改成 "sqlite"。
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed all:migrations
var migrationFS embed.FS

// DB wraps *sql.DB.
type DB struct {
	*sql.DB
}

// Open creates (or opens) the SQLite database at path, applies pragmas, and
// runs pending migrations.
//
// modernc.org/sqlite uses a different DSN convention than mattn:
// pragmas go through the `_pragma=name(value)` form. We set:
//   - WAL journal mode for concurrent readers
//   - foreign_keys=ON (off by default)
//   - busy_timeout=5000 to absorb briefly-held write locks
//   - synchronous=NORMAL (paired with WAL)
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}

	q := url.Values{}
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "foreign_keys(ON)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "synchronous(NORMAL)")
	dsn := fmt.Sprintf("file:%s?%s", path, q.Encode())

	raw, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// SQLite serialises writes through a single lock; multiple connections
	// just cause SQLITE_BUSY churn. One connection is the right answer.
	raw.SetMaxOpenConns(1)
	raw.SetMaxIdleConns(1)

	if err := raw.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	d := &DB{DB: raw}
	if err := d.runMigrations(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

// runMigrations replays every .sql file in migrations/ whose version is higher
// than the user_version pragma. All migrations for a single step run inside
// one transaction.
func (d *DB) runMigrations() error {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	type mig struct {
		version int
		name    string
	}
	var migs []mig
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		prefix := strings.SplitN(e.Name(), "_", 2)[0]
		v, err := strconv.Atoi(prefix)
		if err != nil {
			return fmt.Errorf("invalid migration filename %q: expected NNN_ prefix", e.Name())
		}
		migs = append(migs, mig{version: v, name: e.Name()})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })

	var current int
	if err := d.QueryRow("PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}

	for _, m := range migs {
		if m.version <= current {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + m.name)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.name, err)
		}
		tx, err := d.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", m.name, err)
		}
		if _, err := tx.Exec(string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec %s: %w", m.name, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("bump user_version for %s: %w", m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit %s: %w", m.name, err)
		}
		fmt.Printf("[DB] migration applied: %s\n", m.name)
	}
	return nil
}
