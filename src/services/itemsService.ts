/**
 * Сервисный слой: вся бизнес-логика работы с товарами.
 *
 * В отличие от оригинального app.py (где фильтрация/сортировка/пагинация
 * выполнялись в Python над полным списком), здесь всё делается в SQL —
 * быстрее и безопаснее. Все запросы — параметризованные.
 */
import { getDb } from '../db/client.ts';
import type { Item, ItemInput } from '../db/schema.ts';
import {
	buildPagination,
	DEFAULT_PAGE,
	DEFAULT_PER_PAGE,
	parsePositiveInt,
	type PaginationMeta,
} from '../utils/pagination.ts';
import { BadRequest, NotFound } from '../utils/httpErrors.ts';

/** Поля, по которым разрешена сортировка (whitelist против SQL-инъекций). */
const SORTABLE_FIELDS = new Set(['id', 'name', 'category', 'quantity', 'location', 'date_added']);

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
	const conditions: string[] = [];
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

/** Один товар по id. */
export function getItemById(id: number): Item {
	const db = getDb();
	const item = db.prepare('SELECT * FROM items WHERE id = $id').get({ $id: id }) as Item | null;
	if (!item) throw NotFound(`Товар с id=${id} не найден`);
	return item;
}

/** Создание товара. Возвращает созданную запись. */
export function createItem(input: ItemInput): Item {
	validateInput(input);
	const db = getDb();
	const dateAdded = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
	const result = db
		.prepare(
			`INSERT INTO items (name, category, quantity, location, description, date_added)
			 VALUES ($name, $category, $quantity, $location, $description, $dateAdded)`,
		)
		.run({
			$name: input.name,
			$category: input.category,
			$quantity: input.quantity,
			$location: input.location,
			$description: input.description ?? null,
			$dateAdded: dateAdded,
		});

	return getItemById(Number(result.lastInsertRowid));
}

/** Обновление товара. */
export function updateItem(id: number, input: ItemInput): Item {
	// Проверяем существование — выбросит NotFound если нет.
	getItemById(id);
	validateInput(input);

	const db = getDb();
	db.prepare(
		`UPDATE items
		 SET name = $name, category = $category, quantity = $quantity,
		     location = $location, description = $description
		 WHERE id = $id`,
	).run({
		$id: id,
		$name: input.name,
		$category: input.category,
		$quantity: input.quantity,
		$location: input.location,
		$description: input.description ?? null,
	});

	return getItemById(id);
}

/** Удаление товара. */
export function deleteItem(id: number): void {
	getItemById(id); // NotFound если не существует
	const db = getDb();
	db.prepare('DELETE FROM items WHERE id = $id').run({ $id: id });
}

/** Статистика по всем товарам. */
export function getStats(): Stats {
	const db = getDb();
	const totals = db
		.prepare('SELECT COUNT(*) as total_items, COALESCE(SUM(quantity), 0) as total_quantity FROM items')
		.get() as { total_items: number; total_quantity: number };

	const categories = db
		.prepare(
			`SELECT category, COUNT(*) as count, SUM(quantity) as total_quantity
			 FROM items
			 GROUP BY category
			 ORDER BY total_quantity DESC`,
		)
		.all() as CategoryStat[];

	return { ...totals, categories };
}

/** Уникальные категории (для выпадающих списков фильтров). */
export function getCategories(): string[] {
	const db = getDb();
	const rows = db
		.prepare('SELECT DISTINCT category FROM items ORDER BY category')
		.all() as { category: string }[];
	return rows.map((r) => r.category);
}

/** Уникальные локации. */
export function getLocations(): string[] {
	const db = getDb();
	const rows = db
		.prepare('SELECT DISTINCT location FROM items ORDER BY location')
		.all() as { location: string }[];
	return rows.map((r) => r.location);
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
}
