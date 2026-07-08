/**
 * Маршруты CRUD для товаров: /items
 * Валидация тела запроса — через TypeBox (встроено в Elysia).
 */
import { Elysia, t } from 'elysia';
import {
	createItem,
	deleteItem,
	getItemById,
	listItems,
	updateItem,
} from '../services/itemsService.ts';

/** TypeBox-схема тела запроса для create/update. */
const itemBodySchema = t.Object({
	name: t.String({ minLength: 1, error: 'Название товара обязательно' }),
	category: t.String({ minLength: 1, error: 'Категория обязательна' }),
	quantity: t.Integer({ minimum: 0, error: 'Количество должно быть целым неотрицательным числом' }),
	location: t.String({ minLength: 1, error: 'Местоположение обязательно' }),
	description: t.Optional(t.String()),
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

export const itemsRoutes = new Elysia()
	.group('/items', (app) =>
		app
			// GET /items — список с фильтрами/сортировкой/пагинацией/статистикой
			.get(
				'',
				({ query }) => listItems(query),
				{ query: listQuerySchema, detail: { tags: ['Товары'], summary: 'Список товаров с фильтрами и пагинацией' } },
			)
			// GET /items/:id — один товар
			.get(
				'/:id',
				({ params }) => getItemById(Number(params.id)),
				{ detail: { tags: ['Товары'], summary: 'Получить товар по id' } },
			)
			// POST /items — создать
			.post(
				'',
				({ body, set }) => {
					const item = createItem(body as t.Static<typeof itemBodySchema>);
					set.status = 201;
					return item;
				},
				{ body: itemBodySchema, detail: { tags: ['Товары'], summary: 'Создать товар' } },
			)
			// PUT /items/:id — обновить
			.put(
				'/:id',
				({ params, body }) => updateItem(Number(params.id), body as t.Static<typeof itemBodySchema>),
				{ body: itemBodySchema, detail: { tags: ['Товары'], summary: 'Обновить товар' } },
			)
			// DELETE /items/:id — удалить
			.delete(
				'/:id',
				({ params, set }) => {
					deleteItem(Number(params.id));
					set.status = 204;
					return null;
				},
				{ detail: { tags: ['Товары'], summary: 'Удалить товар' } },
			),
	);
