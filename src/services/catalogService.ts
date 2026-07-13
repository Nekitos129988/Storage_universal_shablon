/**
 * Сервис управления справочниками категорий и локаций.
 *
 * items.category/items.location — TEXT, валидируемый против этих таблиц при
 * записи (см. itemsService.validateInput). Управление (CRUD) — здесь.
 *
 * Таблица параметризуется: 'categories' (колонка items.category) или 'locations'
 * (items.location). Имя таблицы/колонки выбирается из фиксированного whitelist'а,
 * поэтому SQL-инъекции нет.
 */

import { getDb } from '../db/client.ts';
import type { CatalogEntry } from '../db/schema.ts';
import { BadRequest, Conflict, NotFound } from '../utils/httpErrors.ts';

export type CatalogTable = 'categories' | 'locations';

const ITEMS_COLUMN: Record<CatalogTable, string> = {
	categories: 'category',
	locations: 'location',
};

const CATALOG_NAME_MAX = 100;

/** Whitelist-проверка имени таблицы (защита от инъекции в интерполяции). */
function tableOf(table: CatalogTable): CatalogTable {
	if (table !== 'categories' && table !== 'locations') throw BadRequest('Недопустимый справочник');
	return table;
}

function validateName(name: string): string {
	const trimmed = name.trim();
	if (trimmed === '') throw BadRequest('Название обязательно');
	if (trimmed.length > CATALOG_NAME_MAX) {
		throw BadRequest(`Слишком длинное название (макс. ${CATALOG_NAME_MAX} символов)`);
	}
	return trimmed;
}

/** Список записей справочника (отсортирован по имени). */
export function listCatalog(table: CatalogTable): CatalogEntry[] {
	const db = getDb();
	return db.prepare(`SELECT id, name FROM ${tableOf(table)} ORDER BY name`).all() as CatalogEntry[];
}

/** Существует ли запись с таким именем (используется валидацией товаров). */
export function catalogExists(table: CatalogTable, name: string): boolean {
	const db = getDb();
	const row = db.prepare(`SELECT 1 as ok FROM ${tableOf(table)} WHERE name = $name`).get({ $name: name }) as {
		ok: number;
	} | null;
	return row !== null;
}

/** Создать запись (дубликат имени → Conflict). */
export function createCatalogEntry(table: CatalogTable, name: string): CatalogEntry {
	const t = tableOf(table);
	const clean = validateName(name);
	const db = getDb();
	try {
		db.prepare(`INSERT INTO ${t} (name) VALUES ($name)`).run({ $name: clean });
	} catch (err) {
		if (err instanceof Error && err.message.includes('UNIQUE')) throw Conflict('Такое название уже есть');
		throw err;
	}
	return db.prepare(`SELECT id, name FROM ${t} WHERE name = $name`).get({ $name: clean }) as CatalogEntry;
}

/** Найти запись по id (бросает NotFound). */
function getEntry(table: CatalogTable, id: number): CatalogEntry {
	const db = getDb();
	const row = db
		.prepare(`SELECT id, name FROM ${tableOf(table)} WHERE id = $id`)
		.get({ $id: id }) as CatalogEntry | null;
	if (!row) throw NotFound(`Запись с id=${id} не найдена`);
	return row;
}

/**
 * Переименовать запись. Транзакционно обновляет справочник и ВСЕ товары,
 * использующие старое название (глобальное переименование).
 */
export function renameCatalogEntry(table: CatalogTable, id: number, newName: string): CatalogEntry {
	const t = tableOf(table);
	const col = ITEMS_COLUMN[t];
	const clean = validateName(newName);
	const existing = getEntry(t, id);
	if (existing.name === clean) return existing;

	const db = getDb();
	const rename = db.transaction(() => {
		db.prepare(`UPDATE items SET ${col} = $new WHERE ${col} = $old`).run({ $new: clean, $old: existing.name });
		db.prepare(`UPDATE ${t} SET name = $new WHERE id = $id`).run({ $new: clean, $id: id });
	});
	try {
		rename();
	} catch (err) {
		if (err instanceof Error && err.message.includes('UNIQUE')) throw Conflict('Такое название уже есть');
		throw err;
	}
	return getEntry(t, id);
}

/** Удалить запись. Нельзя, если есть активные товары с этим значением (→ Conflict). */
export function deleteCatalogEntry(table: CatalogTable, id: number): void {
	const t = tableOf(table);
	const col = ITEMS_COLUMN[t];
	const existing = getEntry(t, id);
	const db = getDb();
	const { n } = db
		.prepare(`SELECT COUNT(*) as n FROM items WHERE ${col} = $name AND deleted_at IS NULL`)
		.get({ $name: existing.name }) as { n: number };
	if (n > 0) throw Conflict(`Нельзя удалить: используется в ${n} запис${n === 1 ? 'и' : 'ях'} товаров`);
	db.prepare(`DELETE FROM ${t} WHERE id = $id`).run({ $id: id });
}
