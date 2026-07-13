/**
 * Singleton-подключение к SQLite через встроенный модуль bun:sqlite.
 *
 * Важно: bun:sqlite синхронный и работает в одном потоке — этого более чем
 * достаточно для локального/небольшого сервиса инвентаризации. Все запросы
 * идут через prepared statements (защита от SQL-инъекций).
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.ts';
import { runMigrations } from './migrations.ts';
import {
	CREATE_CATEGORIES_TABLE_SQL,
	CREATE_INDEXES_SQL,
	CREATE_ITEMS_FTS_SQL,
	CREATE_ITEMS_FTS_TRIGGERS_SQL,
	CREATE_LOCATIONS_TABLE_SQL,
	CREATE_TABLE_SQL,
	CREATE_USERS_INDEX_SQL,
	CREATE_USERS_TABLE_SQL,
} from './schema.ts';

let dbInstance: Database | null = null;

/** Абсолютный путь к файлу БД (относительно папки server/). */
export const dbPath = resolve(process.cwd(), config.dbPath);

/**
 * Открывает (и при необходимости инициализирует) соединение с БД.
 * Создаёт таблицу и индексы, если их ещё нет.
 */
export function getDb(): Database {
	if (dbInstance) return dbInstance;

	// Гарантируем существование каталога data/.
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = new Database(dbPath, { create: true });
	// Небольшой тюнинг для надёжности записи.
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec(CREATE_TABLE_SQL);
	db.exec(CREATE_INDEXES_SQL);
	db.exec(CREATE_ITEMS_FTS_SQL);
	db.exec(CREATE_ITEMS_FTS_TRIGGERS_SQL);
	db.exec(CREATE_CATEGORIES_TABLE_SQL);
	db.exec(CREATE_LOCATIONS_TABLE_SQL);
	db.exec(CREATE_USERS_TABLE_SQL);
	db.exec(CREATE_USERS_INDEX_SQL);

	// Schema-эволюция — через каркас миграций (идемпотентно, см. migrations.ts).
	runMigrations(db);

	// Runtime self-heal (data-sync, не схема): наполняем справочники из items
	// для существующей БД. На свежей БД items пуст.
	const { catN } = db.prepare('SELECT COUNT(*) as catN FROM categories').get() as { catN: number };
	if (catN === 0) {
		db.exec('INSERT INTO categories(name) SELECT DISTINCT category FROM items');
	}
	const { locN } = db.prepare('SELECT COUNT(*) as locN FROM locations').get() as { locN: number };
	if (locN === 0) {
		db.exec('INSERT INTO locations(name) SELECT DISTINCT location FROM items');
	}

	// Runtime self-heal: перестраиваем полнотекстовый индекс, если items заполнен, а items_fts пуст.
	const { ftsN } = db.prepare('SELECT COUNT(*) as ftsN FROM items_fts').get() as { ftsN: number };
	const { itemsN } = db.prepare('SELECT COUNT(*) as itemsN FROM items').get() as { itemsN: number };
	if (itemsN > 0 && ftsN === 0) {
		db.exec("INSERT INTO items_fts(items_fts) VALUES ('rebuild')");
	}

	dbInstance = db;
	return db;
}

/** Закрывает соединение (используется в тестах / при штатной остановке). */
export function closeDb(): void {
	if (dbInstance) {
		dbInstance.close();
		dbInstance = null;
	}
}
