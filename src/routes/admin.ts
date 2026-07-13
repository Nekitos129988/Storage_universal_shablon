/**
 * Маршруты администрирования: /admin (пользователи + справочники).
 * Доступны только роли 'admin' (единый guard на всю группу).
 *
 * Бизнес-правила (невозможно удалить/понизить себя или последнего админа)
 * реализованы в usersService — здесь только валидация и проводка.
 */
import { Elysia, t } from 'elysia';
import type { Role } from '../db/schema.ts';
import { authPlugin, requireRole } from '../plugins/auth.ts';
import {
	type CatalogTable,
	createCatalogEntry,
	deleteCatalogEntry,
	listCatalog,
	renameCatalogEntry,
} from '../services/catalogService.ts';
import { listArchivedItems, restoreItem } from '../services/itemsService.ts';
import { approveUser, createUser, deleteUser, listUsers, updateUserRole } from '../services/usersService.ts';

/** TypeBox-схема роли. */
const roleSchema = t.Union([t.Literal('admin'), t.Literal('editor'), t.Literal('viewer')]);

/** TypeBox-схема названия для справочника (категория/локация). */
const nameSchema = t.String({ minLength: 1, maxLength: 100, error: 'Название — 1–100 символов' });

/**
 * Подмаршруты CRUD для одного справочника (категории или локации).
 * GET / — список; POST / — создать; PUT /:id — переименовать; DELETE /:id — удалить.
 */
function catalogGroup(prefix: '/categories' | '/locations', table: CatalogTable) {
	const label = prefix === '/categories' ? 'категории' : 'локации';
	return new Elysia().group(prefix, (app) =>
		app
			.get('', () => listCatalog(table), {
				detail: { tags: ['Справочники'], summary: `Список: ${label}` },
			})
			.post(
				'',
				({ body, set }) => {
					const entry = createCatalogEntry(table, (body as { name: string }).name);
					set.status = 201;
					return entry;
				},
				{
					body: t.Object({ name: nameSchema }),
					detail: { tags: ['Справочники'], summary: `Создать: ${label}` },
				},
			)
			.put(
				'/:id',
				({ params, body }) => renameCatalogEntry(table, Number(params.id), (body as { name: string }).name),
				{
					body: t.Object({ name: nameSchema }),
					detail: { tags: ['Справочники'], summary: `Переименовать: ${label}` },
				},
			)
			.delete(
				'/:id',
				({ params, set }) => {
					deleteCatalogEntry(table, Number(params.id));
					set.status = 204;
					return null;
				},
				{ detail: { tags: ['Справочники'], summary: `Удалить: ${label}` } },
			),
	);
}

export const adminRoutes = new Elysia()
	.use(authPlugin)
	// Единый guard: вся группа доступна только администратору.
	.guard({ beforeHandle: requireRole('admin') }, (app) =>
		app.group('/admin', (grp) =>
			grp
				// GET /admin/users — список всех пользователей.
				.get('/users', () => ({ users: listUsers() }), {
					detail: { tags: ['Администрирование'], summary: 'Список пользователей' },
				})
				// POST /admin/users — создать пользователя с заданной ролью.
				.post(
					'/users',
					async ({ body, set }) => {
						const user = await createUser(body as { username: string; password: string; role: Role });
						set.status = 201;
						return user;
					},
					{
						body: t.Object({
							username: t.String({ minLength: 3, maxLength: 50, error: 'Имя пользователя — 3–50 символов' }),
							password: t.String({ minLength: 6, maxLength: 1000, error: 'Пароль — 6–1000 символов' }),
							role: roleSchema,
						}),
						detail: { tags: ['Администрирование'], summary: 'Создать пользователя' },
					},
				)
				// PUT /admin/users/:id — сменить роль.
				.put(
					'/users/:id',
					({ params, body, currentUser }) =>
						updateUserRole(Number(params.id), (body as { role: Role }).role, currentUser!.id),
					{
						body: t.Object({ role: roleSchema }),
						detail: { tags: ['Администрирование'], summary: 'Изменить роль пользователя' },
					},
				)
				// POST /admin/users/:id/approve — подтвердить учётную запись (pending → active).
				.post('/users/:id/approve', ({ params }) => approveUser(Number(params.id)), {
					detail: { tags: ['Администрирование'], summary: 'Подтвердить учётную запись' },
				})
				// DELETE /admin/users/:id — удалить.
				.delete(
					'/users/:id',
					({ params, currentUser, set }) => {
						deleteUser(Number(params.id), currentUser!.id);
						set.status = 204;
						return null;
					},
					{ detail: { tags: ['Администрирование'], summary: 'Удалить пользователя' } },
				)
				// Архив товаров (soft-delete): список + восстановление.
				.get('/items/archived', () => ({ items: listArchivedItems() }), {
					detail: { tags: ['Администрирование'], summary: 'Архив товаров' },
				})
				.post('/items/:id/restore', ({ params }) => restoreItem(Number(params.id)), {
					detail: { tags: ['Администрирование'], summary: 'Восстановить товар из архива' },
				})
				// Справочники категорий и локаций (CRUD).
				.use(catalogGroup('/categories', 'categories'))
				.use(catalogGroup('/locations', 'locations')),
		),
	);
