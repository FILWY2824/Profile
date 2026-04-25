// Package db owns the single SQLite handle for the process. It is deliberately
// a thin wrapper: business code talks to repositories (internal/repository),
// which hold a *sql.DB injected from here. No globals.
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed all:migrations
var migrationFS embed.FS

// DB wraps *sql.DB with a tiny convenience layer. We intentionally keep this
// shallow — no ORM, no query builder — so every SQL statement in the code base
// is greppable and auditable.
type DB struct {
	*sql.DB
}

// Open creates (or opens) the SQLite database at path, applies pragmas that
// are non-negotiable for this codebase, and runs pending migrations.
//
// The pragma list is a deliberate subset:
//   - WAL for concurrent readers without blocking the single writer
//   - foreign_keys=ON: SQLite's default is OFF (historical), and we rely on
//     ON DELETE SET NULL / CASCADE behaviour
//   - busy_timeout=5000: absorbs briefly-held write locks before returning
//     SQLITE_BUSY to the caller
//   - synchronous=NORMAL: pairs with WAL; FULL is overkill and hurts tps
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir data dir: %w", err)
	}

	// mattn/go-sqlite3 uses `?_pragma_name=value` and a dedicated DSN key
	// `_foreign_keys=on`. Pragmas run on every connection — matches what
	// modernc does. The WAL pragma is persisted in the DB file itself
	// after first write, so we set it once and it sticks.
	dsn := fmt.Sprintf(
		"file:%s?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000&_synchronous=NORMAL",
		path,
	)
	raw, err := sql.Open("sqlite3", dsn)
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
// than the value stored in SQLite's user_version pragma. All migrations for a
// single step run inside one transaction so partial-failure halts the step.
//
// Files are named NNN_description.sql — NNN is the version number. We sort
// numerically (not lexically) to avoid the 10-vs-2 ordering bug.
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
		// user_version pragma can't be parameterised; version number is an
		// int from our own filename so no injection surface.
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
