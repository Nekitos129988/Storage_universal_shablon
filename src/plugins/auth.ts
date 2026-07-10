/**
 * Плагин аутентификации и гварды авторизации для Elysia.
 *
 * authPlugin (derive, scoped) читает сессионную cookie и кладёт в контекст
 * currentUser (PublicUser | null). Scoped, а не global — иначе проверка токена
 * (HMAC + запрос к БД) будет выполняться на КАЖДОМ запросе, включая /health,
 * /swagger и раздачу статики.
 *
 * Гварды requireAuth / requireRole используются как beforeHandle. Брошенные ими
 * HttpError(401/403) всплывают к корневому onError в index.ts и сериализуются
 * в единый формат { error: { code, message } }.
 *
 * ВАЖНО: нигде не объявляем TypeBox-схему для cookie — иначе запрос без cookie
 * упадёт в 400 VALIDATION до того, как гвард успеет вернуть чистый 401.
 */
import { Elysia } from 'elysia';
import { verifySessionToken } from '../services/authService.ts';
import type { PublicUser, Role } from '../db/schema.ts';
import { Forbidden, Unauthorized } from '../utils/httpErrors.ts';

/**
 * Контекст аутентификации для внешних гвардов (requireAuth/requireRole).
 *
 * currentUser объявлен опциональным, а индекс-сигнатура `[k: string]: unknown`
 * делает тип «не слабым» — иначе при использовании гварда в .guard() Elysia
 * типизационно не видит currentUser из scoped-derive и ругается на несовместимость.
 * В рантайме authPlugin всегда добавляет currentUser в контекст.
 */
export type AuthContext = { currentUser?: PublicUser | null; [k: string]: unknown };

/**
 * derive: достаёт currentUser из сессионной cookie.
 * verifySessionToken никогда не бросает (→ null при любой проблеме).
 */
export const authPlugin = new Elysia({ name: 'app.auth' }).derive({ as: 'scoped' }, ({ cookie }) => {
	const raw = cookie?.session?.value;
	const token = typeof raw === 'string' ? raw : null;
	return { currentUser: verifySessionToken(token) };
});

/** beforeHandle: требует, чтобы пользователь был аутентифицирован. */
export function requireAuth({ currentUser }: AuthContext): void {
	if (!currentUser) throw Unauthorized('Требуется вход в систему');
}

/** Возвращает beforeHandle, допускающий только указанные роли. */
export function requireRole(...roles: Role[]) {
	return ({ currentUser }: AuthContext) => {
		if (!currentUser) throw Unauthorized('Требуется вход в систему');
		if (!roles.includes(currentUser.role)) throw Forbidden('Недостаточно прав для этого действия');
	};
}
