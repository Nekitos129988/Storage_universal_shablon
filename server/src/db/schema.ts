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
