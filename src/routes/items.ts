/**
 * Маршруты CRUD для товаров: /items
 * Валидация тела запроса — через TypeBox (встроено в Elysia).
 */
import { Elysia, t } from 'elysia';
import type { ItemInput } from '../db/schema.ts';
import { authPlugin, requireAuth, requireRole } from '../plugins/auth.ts';
import { createItem, deleteItem, getItemById, listItems, updateItem } from '../services/itemsService.ts';

/** TypeBox-схема тела запроса для create/update. */
const itemBodySchema = t.Object({
	name: t.String({ minLength: 1, maxLength: 200, error: 'Название товара обязательно (до 200 символов)' }),
	category: t.String({ minLength: 1, maxLength: 100, error: 'Категория обязательна (до 100 символов)' }),
	quantity: t.Integer({ minimum: 0, error: 'Количество должно быть целым неотрицательным числом' }),
	location: t.String({ minLength: 1, maxLength: 100, error: 'Местоположение обязательно (до 100 символов)' }),
	description: t.Optional(t.String({ maxLength: 2000 })),
});

/** TypeBox-схема query-параметров для списка. */
const listQuerySchema = t.Object({
	page: t.Optional(t.String()),
	per_page: t.Optional(t.String()),
	category: t.Optional(t.String()),
	location: t.Optional(t.String()),
	min_quantity: t.Optional(t.String()),
	search: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	order: t.Optional(t.String()),
});

export const itemsRoutes = new Elysia().use(authPlugin).group('/items', (app) =>
	app
		// GET /items — список с фильтрами/сортировкой/пагинацией/статистикой (любая роль)
		.get('', ({ query }) => listItems(query), {
			query: listQuerySchema,
			beforeHandle: requireAuth,
			detail: { tags: ['Товары'], summary: 'Список товаров с фильтрами и пагинацией' },
		})
		// GET /items/:id — один товар (любая роль)
		.get('/:id', ({ params }) => getItemById(Number(params.id)), {
			beforeHandle: requireAuth,
			detail: { tags: ['Товары'], summary: 'Получить товар по id' },
		})
		// POST /items — создать (editor/admin)
		.post(
			'',
			({ body, set, currentUser }) => {
				// requireRole выше гарантирует currentUser; created_by — для аудита.
				const item = createItem(body as ItemInput, currentUser!.id);
				set.status = 201;
				return item;
			},
			{
				body: itemBodySchema,
				beforeHandle: requireRole('editor', 'admin'),
				detail: { tags: ['Товары'], summary: 'Создать товар' },
			},
		)
		// PUT /items/:id — обновить (editor/admin)
		.put('/:id', ({ params, body }) => updateItem(Number(params.id), body as ItemInput), {
			body: itemBodySchema,
			beforeHandle: requireRole('editor', 'admin'),
			detail: { tags: ['Товары'], summary: 'Обновить товар' },
		})
		// DELETE /items/:id — удалить (editor/admin)
		.delete(
			'/:id',
			({ params, set }) => {
				deleteItem(Number(params.id));
				set.status = 204;
				return null;
			},
			{ beforeHandle: requireRole('editor', 'admin'), detail: { tags: ['Товары'], summary: 'Удалить товар' } },
		),
);
