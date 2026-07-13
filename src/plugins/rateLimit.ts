/**
 * Плагины ограничения частоты запросов (rate-limit) для Elysia.
 *
 * loginRateLimit — жёсткий (по умолчанию 5 запросов/мин на IP), защищает от перебора
 * паролей. Применяется только к /auth/login и /auth/register (отбираются через skip),
 * чтобы не ломать GET /auth/me, который фронтенд дёргает на каждой загрузке страницы.
 * scoping:'scoped' — действие ограничено экземпляром/группой, где подключается.
 *
 * globalRateLimit — мягкая защита всего REST API (по умолчанию 300/мин на IP).
 * Применяется только к путям под apiPrefix; статика, /health и /swagger не учитываются.
 *
 * При превышении отдаётся 429 в едином формате ошибок проекта:
 *   { error: { code: 'RATE_LIMITED', message } }
 * Ключ бакета по умолчанию — IP клиента (server.requestIP).
 */
import { rateLimit } from 'elysia-rate-limit';
import { config } from '../config.ts';

/** Тело ответа 429 в едином формате ошибок. Плагин клонирует Response на каждый отказ. */
const RATE_LIMITED_RESPONSE = new Response(
	JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' } }),
	{ status: 429, headers: { 'content-type': 'application/json; charset=utf-8' } },
);

/** pathname из URL запроса (с защитой от нестандартных значений). */
function pathnameOf(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return '';
	}
}

/** Жёсткий лимит на эндпоинты входа/регистрации. Применять внутри группы /auth. */
export const loginRateLimit = rateLimit({
	max: config.rateLimitLoginMax,
	duration: config.rateLimitLoginWindowMs,
	scoping: 'scoped',
	errorResponse: RATE_LIMITED_RESPONSE,
	// Лимитируем только login и register; me/logout пропускаем.
	skip: (req) => {
		const p = pathnameOf(req.url);
		return !(p.endsWith('/auth/login') || p.endsWith('/auth/register'));
	},
});

/** Мягкий глобальный лимит только для REST API (/api/*). */
export const globalRateLimit = rateLimit({
	max: config.rateLimitGlobalMax,
	duration: config.rateLimitGlobalWindowMs,
	scoping: 'global',
	errorResponse: RATE_LIMITED_RESPONSE,
	// Применяем только к путям API; раздачу статики, health и swagger не лимитируем.
	skip: (req) => !pathnameOf(req.url).startsWith(config.apiPrefix),
});
