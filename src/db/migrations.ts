/**
 * Каркас миграций: упорядоченный список идемпотентных миграций + раннер.
 *
 * Каждая миграция безопасна к повторному выполнению (проверяет состояние перед
 * изменением схемы), поэтому первый запуск нового кода на существующей БД переносит
 * её актуальное состояние, ничего не ломая. Раннер пишет applied-записи в
 * schema_migrations, чтобы при последующих стартах не проверять заново.
 *
 * Новые миграции добавляются в конец MIGRATIONS с возрастающим id.
 */
import type { Database } from 'bun:sqlite';

export interface Migration {
	id: number;
	name: string;
	up: (db: Database) => void;
}

/** Есть ли колонка в таблице (для идемпотентных ALTER-миграций). */
function hasColumn(db: Database, table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	return cols.some((c) => c.name === column);
}

export const MIGRATIONS: Migration[] = [
	{
		id: 1,
		name: 'users.status',
		up: (db) => {
			if (!hasColumn(db, 'users', 'status')) {
				db.exec(
					"ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active'))",
				);
			}
		},
	},
	{
		id: 2,
		name: 'items.created_by',
		up: (db) => {
			if (!hasColumn(db, 'items', 'created_by')) db.exec('ALTER TABLE items ADD COLUMN created_by INTEGER');
		},
	},
	{
		id: 3,
		name: 'items.updated_at + backfill',
		up: (db) => {
			if (!hasColumn(db, 'items', 'updated_at')) {
				db.exec('ALTER TABLE items ADD COLUMN updated_at TEXT');
				db.exec('UPDATE items SET updated_at = date_added WHERE updated_at IS NULL');
			}
		},
	},
];

const ENSURE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	id INTEGER PRIMARY KEY,
	applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Применяет все незаписанные миграции (каждую — в своей транзакции). Идемпотентно. */
export function runMigrations(db: Database): void {
	db.exec(ENSURE_MIGRATIONS_TABLE);
	const applied = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
	const record = db.prepare('INSERT INTO schema_migrations (id) VALUES ($id)');
	for (const m of MIGRATIONS) {
		if (applied.has(m.id)) continue;
		db.transaction(() => m.up(db))();
		record.run({ $id: m.id });
	}
}
