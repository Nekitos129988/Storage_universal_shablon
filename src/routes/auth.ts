/**
 * Маршруты аутентификации: /auth
 *
 * register / login / logout — публичные (гвардов нет).
 * /me — возвращает текущего пользователя по сессионной cookie (или null).
 *
 * Токен устанавливается в httpOnly-cookie, поэтому фронтенду не нужно его
 * читать/хранить — достаточно дёрнуть GET /auth/me для определения состояния.
 */
import { Elysia, t } from 'elysia';
import { authPlugin } from '../plugins/auth.ts';
import { loginRateLimit } from '../plugins/rateLimit.ts';
import { login, register } from '../services/authService.ts';
import { config } from '../config.ts';

/** Общие атрибуты сессионной cookie. */
function sessionCookieAttrs() {
	return {
		httpOnly: true,
		path: '/',
		sameSite: 'lax' as const,
		secure: config.cookieSecure,
	};
}

export const authRoutes = new Elysia()
	.use(authPlugin)
	.group('/auth', (app) =>
		// Защита от перебора: жёсткий лимит на login/register (me/logout пропускаются через skip).
		app.use(loginRateLimit)
			// POST /auth/register — публичная регистрация (роль 'viewer', статус 'pending').
			// Авто-входа НЕТ: учётная запись ждёт подтверждения администратора.
			.post(
				'/register',
				async ({ body }) => {
					const publicUser = await register(body);
					return { user: publicUser };
				},
				{
					body: t.Object({
						username: t.String({ minLength: 3, error: 'Имя пользователя — минимум 3 символа' }),
						password: t.String({ minLength: 6, error: 'Пароль — минимум 6 символов' }),
					}),
					detail: { tags: ['Аутентификация'], summary: 'Регистрация нового пользователя (требует подтверждения)' },
				},
			)
			// POST /auth/login — вход, установка сессионной cookie.
			.post(
				'/login',
				async ({ body, set }) => {
					const { user, token } = await login(body);
					set.cookie!.session = { value: token, ...sessionCookieAttrs(), maxAge: config.sessionTtlHours * 3600 };
					return { user };
				},
				{
					body: t.Object({
						username: t.String({ minLength: 1, error: 'Укажите имя пользователя' }),
						password: t.String({ minLength: 1, error: 'Укажите пароль' }),
					}),
					detail: { tags: ['Аутентификация'], summary: 'Вход в систему' },
				},
			)
			// POST /auth/logout — очистка сессионной cookie (тот же path, иначе браузер не удалит).
			.post(
				'/logout',
				({ set }) => {
					set.cookie!.session = { value: '', ...sessionCookieAttrs(), maxAge: 0 };
					return { ok: true };
				},
				{ detail: { tags: ['Аутентификация'], summary: 'Выход из системы' } },
			)
			// GET /auth/me — текущий пользователь или null (200 всегда, чтобы фронт мог опросить без ошибки).
			.get(
				'/me',
				({ currentUser }) => ({ user: currentUser ?? null }),
				{ detail: { tags: ['Аутентификация'], summary: 'Текущий пользователь' } },
			),
	);
