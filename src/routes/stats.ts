/**
 * Маршрут статистики: /stats (требует входа — любая роль)
 */
import { Elysia } from 'elysia';
import { authPlugin, requireAuth } from '../plugins/auth.ts';
import { getStats } from '../services/itemsService.ts';

export const statsRoutes = new Elysia().use(authPlugin).get('/stats', () => getStats(), {
	beforeHandle: requireAuth,
	detail: { tags: ['Аналитика'], summary: 'Статистика по всем товарам' },
});
