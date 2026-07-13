/**
 * Утилиты пагинации: парсинг и ограничение параметров page/per_page.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 10;
export const MAX_PER_PAGE = 100;

export interface PaginationMeta {
	page: number;
	per_page: number;
	total_items: number;
	total_pages: number;
	has_prev: boolean;
	has_next: boolean;
}

/** Безопасно парсит целое из строки запроса с ограничениями. */
export function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
	const n = Number.parseInt(value ?? '', 10);
	if (Number.isNaN(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}

/** Собирает метаданные пагинации из общего количества. */
export function buildPagination(page: number, perPage: number, totalItems: number): PaginationMeta {
	const totalPages = totalItems > 0 ? Math.ceil(totalItems / perPage) : 1;
	return {
		page,
		per_page: perPage,
		total_items: totalItems,
		total_pages: totalPages,
		has_prev: page > 1,
		has_next: page < totalPages,
	};
}
