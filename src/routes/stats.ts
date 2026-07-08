/**
 * Маршрут статистики: /stats
 */
import { Elysia } from 'elysia';
import { getStats } from '../services/itemsService.ts';

export const statsRoutes = new Elysia().get(
	'/stats',
	() => getStats(),
	{ detail: { tags: ['Аналитика'], summary: 'Статистика по всем товарам' } },
);
