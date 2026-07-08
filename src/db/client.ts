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
import { CREATE_INDEXES_SQL, CREATE_TABLE_SQL } from './schema.ts';

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
