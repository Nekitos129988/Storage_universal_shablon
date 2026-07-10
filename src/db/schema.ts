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
}

/** Данные для создания/обновления товара (без id и date_added). */
export type ItemInput = {
	name: string;
	category: string;
	quantity: number;
	location: string;
	description?: string;
};

/** DDL — создание таблицы, идентичное оригинальному app.py. */
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    location TEXT NOT NULL,
    description TEXT,
    date_added DATE NOT NULL
);
`;

/** Индексы для ускорения фильтрации/сортировки. */
export const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_location ON items(location);
CREATE INDEX IF NOT EXISTS idx_items_date_added ON items(date_added);
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Индексы таблицы пользователей. */
export const CREATE_USERS_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`;
