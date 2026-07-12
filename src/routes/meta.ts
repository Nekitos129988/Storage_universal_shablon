/**
 * Справочные маршруты: /categories, /locations (требуют входа — любая роль)
 * Нужны для заполнения выпадающих списков фильтров на фронтенде.
 */
import { Elysia } from 'elysia';
import { authPlugin, requireAuth } from '../plugins/auth.ts';
import { getCategories, getLocations } from '../services/itemsService.ts';

export const metaRoutes = new Elysia()
	.use(authPlugin)
	.get('/categories', () => ({ categories: getCategories() }), {
		beforeHandle: requireAuth,
		detail: { tags: ['Справочники'], summary: 'Уникальные категории' },
	})
	.get('/locations', () => ({ locations: getLocations() }), {
		beforeHandle: requireAuth,
		detail: { tags: ['Справочники'], summary: 'Уникальные местоположения' },
	});
