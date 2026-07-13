/**
 * Схема БД: DDL и TypeScript-типы для таблицы items.
 */

export interface Item {
	id: number;
	name: string;
	category: string;
	quantity: number;
	location: string;
	description: string | null;
	date_added: string; // ISO-дата 'YYYY-MM-DD'
	created_by: number | null; // id пользователя, создавшего запись
	updated_at: string | null; // ISO-datetime последнего изменения
	deleted_at: string | null; // ISO-datetime мягкого удаления (null = активен)
	min_quantity: number; // порог для сигнала «мало на остатке» (0 = не отслеживается)
}

/** Данные для создания/обновления товара (без id и date_added). */
export type ItemInput = {
	name: string;
	category: string;
	quantity: number;
	location: string;
	description?: string;
	min_quantity?: number;
};

/** DDL — создание таблицы. created_by/updated_at/deleted_at — аудит и soft-delete (без FK). */
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    description TEXT,
    date_added DATE NOT NULL,
    created_by INTEGER,
    updated_at TEXT,
    deleted_at TEXT,
    min_quantity INTEGER NOT NULL DEFAULT 0
);
`;

/** Индексы для ускорения фильтрации/сортировки. */
export const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_location ON items(location);
CREATE INDEX IF NOT EXISTS idx_items_date_added ON items(date_added);
`;

/** Справочники категорий и локаций (нормализация вместо свободного текста). */
export const CREATE_CATEGORIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
`;

export const CREATE_LOCATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
`;

/** Запись справочника (категория или локация). */
export interface CatalogEntry {
	id: number;
	name: string;
}

/**
 * Полнотекстовый индекс FTS5 над items (external content table).
 * tokenize='unicode61 remove_diacritics 1' корректно токенизирует и приводит
 * к нижнему регистру кириллицу (решает проблему, что встроенная LOWER() — ASCII-only).
 */
export const CREATE_ITEMS_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    name, description,
    content='items', content_rowid='id',
    tokenize = 'unicode61 remove_diacritics 1'
);
`;

/**
 * Триггеры синхронизации items_fts с items (external-content таблица
 * не обновляется автоматически при изменении источника).
 */
export const CREATE_ITEMS_FTS_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
    INSERT INTO items_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
`;

// --- Пользователи и роли -----------------------------------------------------

/** Роли пользователей. */
export type Role = 'admin' | 'editor' | 'viewer';

/**
 * Статус учётной записи.
 * - 'pending' — зарегистрирован, ждёт подтверждения администратора (вход запрещён);
 * - 'active' — подтверждён, вход разрешён.
 */
export type UserStatus = 'pending' | 'active';

/** Полная запись пользователя (включая хеш пароля — только для внутреннего использования). */
export interface User {
	id: number;
	username: string;
	password_hash: string;
	role: Role;
	status: UserStatus;
	created_at: string; // ISO-дата/время
	token_version: number; // bumped для отзыва всех сессий пользователя
}

/** Безопасная форма пользователя для отдачи клиенту (без password_hash). */
export interface PublicUser {
	id: number;
	username: string;
	role: Role;
	status: UserStatus;
	created_at: string;
}

/** Данные для регистрации (новый пользователь всегда получает роль 'viewer'). */
export interface RegisterInput {
	username: string;
	password: string;
}

/** Данные для входа. */
export interface LoginInput {
	username: string;
	password: string;
}

/** Создание пользователя админом (роль задаётся явно). */
export interface CreateUserInput {
	username: string;
	password: string;
	role: Role;
}

/** DDL — таблица пользователей. */
export const CREATE_USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    token_version INTEGER NOT NULL DEFAULT 0
);
`;

/** Индексы таблицы пользователей. */
export const CREATE_USERS_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`;
