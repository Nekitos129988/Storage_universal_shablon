/**
 * Маршруты администрирования пользователей: /admin
 * Доступны только роли 'admin' (единый guard на всю группу).
 *
 * Бизнес-правила (невозможно удалить/понизить себя или последнего админа)
 * реализованы в usersService — здесь только валидация и проводка.
 */
import { Elysia, t } from 'elysia';
import { authPlugin, requireRole } from '../plugins/auth.ts';
import { approveUser, createUser, deleteUser, listUsers, updateUserRole } from '../services/usersService.ts';
import type { Role } from '../db/schema.ts';

/** TypeBox-схема роли. */
const roleSchema = t.Union([t.Literal('admin'), t.Literal('editor'), t.Literal('viewer')]);

export const adminRoutes = new Elysia()
	.use(authPlugin)
	// Единый guard: вся группа доступна только администратору.
	.guard({ beforeHandle: requireRole('admin') }, (app) =>
		app
			.group('/admin', (grp) =>
				grp
					// GET /admin/users — список всех пользователей.
					.get(
						'/users',
						() => ({ users: listUsers() }),
						{ detail: { tags: ['Администрирование'], summary: 'Список пользователей' } },
					)
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
								username: t.String({ minLength: 3, error: 'Имя пользователя — минимум 3 символа' }),
								password: t.String({ minLength: 6, error: 'Пароль — минимум 6 символов' }),
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
					.post(
						'/users/:id/approve',
						({ params }) => approveUser(Number(params.id)),
						{ detail: { tags: ['Администрирование'], summary: 'Подтвердить учётную запись' } },
					)
					// DELETE /admin/users/:id — удалить.
					.delete(
						'/users/:id',
						({ params, currentUser, set }) => {
							deleteUser(Number(params.id), currentUser!.id);
							set.status = 204;
							return null;
						},
						{ detail: { tags: ['Администрирование'], summary: 'Удалить пользователя' } },
					),
			),
	);
