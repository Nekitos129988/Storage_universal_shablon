/**
 * Справочные маршруты: /categories, /locations
 * Нужны для заполнения выпадающих списков фильтров на фронтенде.
 */
import { Elysia } from 'elysia';
import { getCategories, getLocations } from '../services/itemsService.ts';

export const metaRoutes = new Elysia()
	.get(
		'/categories',
		() => ({ categories: getCategories() }),
		{ detail: { tags: ['Справочники'], summary: 'Уникальные категории' } },
	)
	.get(
		'/locations',
		() => ({ locations: getLocations() }),
		{ detail: { tags: ['Справочники'], summary: 'Уникальные местоположения' } },
	);
