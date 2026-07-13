/**
 * Сервисный слой: вся бизнес-логика работы с товарами.
 *
 * В отличие от оригинального app.py (где фильтрация/сортировка/пагинация
 * выполнялись в Python над полным списком), здесь всё делается в SQL —
 * быстрее и безопаснее. Все запросы — параметризованные.
 */
import { getDb } from '../db/client.ts';
import type { Item, ItemInput } from '../db/schema.ts';
import { BadRequest, NotFound } from '../utils/httpErrors.ts';
import {
	buildPagination,
	DEFAULT_PAGE,
	DEFAULT_PER_PAGE,
	type PaginationMeta,
	parsePositiveInt,
} from '../utils/pagination.ts';
import { catalogExists, listCatalog } from './catalogService.ts';

/** Поля, по которым разрешена сортировка (whitelist против SQL-инъекций). */
const SORTABLE_FIELDS = new Set(['id', 'name', 'category', 'quantity', 'location', 'date_added']);

/** Лимиты длины текстовых полей товара (защита от безлимитной записи). */
const ITEM_NAME_MAX = 200;
const ITEM_CATEGORY_MAX = 100;
const ITEM_LOCATION_MAX = 100;
const ITEM_DESCRIPTION_MAX = 2000;

export interface ItemListQuery {
	page?: string;
	per_page?: string;
	category?: string;
	location?: string;
	min_quantity?: string;
	search?: string;
	sort?: string;
	order?: string;
}

export interface CategoryStat {
	category: string;
	count: number;
	total_quantity: number;
}

export interface Stats {
	total_items: number;
	total_quantity: number;
	categories: CategoryStat[];
}

export interface ItemListResult {
	items: Item[];
	pagination: PaginationMeta;
	stats: Stats; // статистика по ВСЕМ товарам (как в оригинале)
}

/** Приводит параметр сортировки к безопасному виду. */
function resolveSort(sort?: string, order?: string): { field: string; direction: 'ASC' | 'DESC' } {
	const field = sort && SORTABLE_FIELDS.has(sort) ? sort : 'date_added';
	const direction = order?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
	return { field, direction };
}

/**
 * Превращает поисковую строку в безопасный FTS5-запрос: разбивает по пробелам,
 * каждое слово оборачивает в кавычки (внутренние кавычки удваиваются) и добавляет
 * суффикс '*' для prefix-матча. Токены объединяются неявным AND.
 * Пример: 'ноутбук lenovo' → '"ноутбук"* "lenovo"*'.
 * Возвращает пустую строку, если полезных токенов нет.
 */
function buildFtsQuery(search: string): string {
	return search
		.split(/\s+/)
		.filter(Boolean)
		.map((tok) => `"${tok.replace(/"/g, '""')}"*`)
		.join(' ');
}

/**
 * Список товаров с фильтрами, сортировкой и пагинацией — всё на уровне SQL.
 */
export function listItems(query: ItemListQuery): ItemListResult {
	const page = parsePositiveInt(query.page, DEFAULT_PAGE, 1, 1_000_000);
	const perPage = parsePositiveInt(query.per_page, DEFAULT_PER_PAGE, 1, 100);
	const offset = (page - 1) * perPage;
	const { field, direction } = resolveSort(query.sort, query.order);

	const db = getDb();

	// Динамически собираем WHERE только для переданных фильтров.
	// Базовое условие: исключаем архив (soft-delete).
	const conditions: string[] = ['items.deleted_at IS NULL'];
	const params: Record<string, string | number | null> = {};

	if (query.category) {
		conditions.push('category = $category');
		params.$category = query.category;
	}
	if (query.location) {
		conditions.push('location = $location');
		params.$location = query.location;
	}
	if (query.min_quantity) {
		const minQ = Number.parseInt(query.min_quantity, 10);
		if (!Number.isNaN(minQ) && minQ >= 0) {
			conditions.push('quantity >= $minQuantity');
			params.$minQuantity = minQ;
		}
	}

	const search = query.search?.trim() ?? '';

	// Текстовый поиск — через полнотекстовый индекс items_fts (FTS5, unicode61):
	// корректно работает с кириллицей и регистром, в отличие от встроенной LOWER().
	// При наличии поиска добавляем MATCH-условие и JOIN к items_fts; фильтры
	// (category/location/min_quantity) объединяются тем же WHERE.
	let fromClause = 'items';
	const fts = search ? buildFtsQuery(search) : '';
	if (fts) {
		conditions.push('items_fts MATCH $fts');
		params.$fts = fts;
		fromClause = 'items JOIN items_fts ON items_fts.rowid = items.id';
	}
	const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

	// Поле сортировки берётся из whitelist, поэтому безопасно подставлять в SQL напрямую.
	// Квалифицируем items.field, чтобы избежать неоднозначности при JOIN с items_fts.
	const itemsSql = `SELECT items.* FROM ${fromClause} ${whereSql} ORDER BY items.${field} ${direction} LIMIT $limit OFFSET $offset`;
	const totalSql = `SELECT COUNT(*) as n FROM ${fromClause} ${whereSql}`;

	const items = db.prepare(itemsSql).all({ ...params, $limit: perPage, $offset: offset }) as Item[];
	const totalRow = db.prepare(totalSql).get(params) as { n: number };

	return {
		items,
		pagination: buildPagination(page, perPage, totalRow.n),
		// Статистика всегда по всем товарам (поведение оригинального app.py).
		stats: getStats(),
	};
}

/** Один товар по id (архивные — не возвращаются, выбрасывают NotFound). */
export function getItemById(id: number): Item {
	const db = getDb();
	const item = db.prepare('SELECT * FROM items WHERE id = $id AND deleted_at IS NULL').get({ $id: id }) as Item | null;
	if (!item) throw NotFound(`Товар с id=${id} не найден`);
	return item;
}

/** Создание товара. userId — кто создал (для аудита created_by). Возвращает созданную запись. */
export function createItem(input: ItemInput, userId: number | null = null): Item {
	validateInput(input);
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO items (name, category, quantity, location, description, date_added, created_by, updated_at)
			 VALUES ($name, $category, $quantity, $location, $description, $dateAdded, $createdBy, $updatedAt)`,
		)
		.run({
			$name: input.name,
			$category: input.category,
			$quantity: input.quantity,
			$location: input.location,
			$description: input.description ?? null,
			$dateAdded: now.slice(0, 10), // 'YYYY-MM-DD'
			$createdBy: userId,
			$updatedAt: now,
		});

	return getItemById(Number(result.lastInsertRowid));
}

/** Обновление товара (обновляет updated_at). */
export function updateItem(id: number, input: ItemInput): Item {
	// Проверяем существование — выбросит NotFound если нет.
	getItemById(id);
	validateInput(input);

	const db = getDb();
	db.prepare(
		`UPDATE items
		 SET name = $name, category = $category, quantity = $quantity,
		     location = $location, description = $description, updated_at = $updatedAt
		 WHERE id = $id`,
	).run({
		$id: id,
		$name: input.name,
		$category: input.category,
		$quantity: input.quantity,
		$location: input.location,
		$description: input.description ?? null,
		$updatedAt: new Date().toISOString(),
	});

	return getItemById(id);
}

/** Мягкое удаление товара (перемещение в архив). Восстановление — restoreItem. */
export function deleteItem(id: number): void {
	getItemById(id); // NotFound если не существует (или уже в архиве)
	const db = getDb();
	db.prepare('UPDATE items SET deleted_at = $now WHERE id = $id AND deleted_at IS NULL').run({
		$id: id,
		$now: new Date().toISOString(),
	});
}

/** Архивные товары (для админ-раздела). */
export function listArchivedItems(): Item[] {
	const db = getDb();
	return db.prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as Item[];
}

/** Восстановить товар из архива. */
export function restoreItem(id: number): Item {
	const db = getDb();
	const res = db
		.prepare('UPDATE items SET deleted_at = NULL WHERE id = $id AND deleted_at IS NOT NULL')
		.run({ $id: id });
	if (res.changes === 0) throw NotFound(`Архивная запись с id=${id} не найдена`);
	return getItemById(id);
}

/** Статистика по всем активным товарам (архив исключён). */
export function getStats(): Stats {
	const db = getDb();
	const totals = db
		.prepare(
			'SELECT COUNT(*) as total_items, COALESCE(SUM(quantity), 0) as total_quantity FROM items WHERE deleted_at IS NULL',
		)
		.get() as { total_items: number; total_quantity: number };

	const categories = db
		.prepare(
			`SELECT category, COUNT(*) as count, SUM(quantity) as total_quantity
			 FROM items
			 WHERE deleted_at IS NULL
			 GROUP BY category
			 ORDER BY total_quantity DESC`,
		)
		.all() as CategoryStat[];

	return { ...totals, categories };
}

/** Уникальные категории (для выпадающих списков фильтров). */
export function getCategories(): string[] {
	return listCatalog('categories').map((c) => c.name);
}

/** Уникальные локации. */
export function getLocations(): string[] {
	return listCatalog('locations').map((l) => l.name);
}

/** Валидация ввода (общая для create/update). */
function validateInput(input: ItemInput): void {
	if (!input.name || input.name.trim() === '') {
		throw BadRequest('Название товара обязательно');
	}
	if (!input.category || input.category.trim() === '') {
		throw BadRequest('Категория обязательна');
	}
	if (!input.location || input.location.trim() === '') {
		throw BadRequest('Местоположение обязательно');
	}
	if (!Number.isInteger(input.quantity) || input.quantity < 0) {
		throw BadRequest('Количество должно быть целым неотрицательным числом');
	}
	if (input.name.length > ITEM_NAME_MAX) {
		throw BadRequest(`Название слишком длинное (макс. ${ITEM_NAME_MAX} символов)`);
	}
	if (input.category.length > ITEM_CATEGORY_MAX) {
		throw BadRequest(`Категория слишком длинная (макс. ${ITEM_CATEGORY_MAX} символов)`);
	}
	if (input.location.length > ITEM_LOCATION_MAX) {
		throw BadRequest(`Местоположение слишком длинное (макс. ${ITEM_LOCATION_MAX} символов)`);
	}
	if (input.description && input.description.length > ITEM_DESCRIPTION_MAX) {
		throw BadRequest(`Описание слишком длинное (макс. ${ITEM_DESCRIPTION_MAX} символов)`);
	}
	// Категория/локация должны существовать в справочниках (нормализация).
	if (!catalogExists('categories', input.category)) {
		throw BadRequest('Неизвестная категория');
	}
	if (!catalogExists('locations', input.location)) {
		throw BadRequest('Неизвестное местоположение');
	}
}
