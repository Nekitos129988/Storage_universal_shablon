/**
 * Конфигурация приложения.
 * Читается из переменных окружения (.env) со значениями по умолчанию.
 * Валидируется при первом импорте, чтобы «упасть громко и сразу».
 */
import { randomBytes } from 'node:crypto';

function required(name: string, value: string | undefined): string {
	if (!value || value.trim() === '') {
		throw new Error(`Не задана обязательная переменная окружения: ${name}`);
	}
	return value.trim();
}

function parseInt(value: string, fallback: number, min = 1, max = 65535): number {
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}

const env = process.env;

const host = env.HOST?.trim() || '127.0.0.1';
const isProd = (env.NODE_ENV ?? 'development').trim() === 'production';

/** Секрет для подписи сессионных cookie. В production обязателен, в dev — случайный на процесс. */
function resolveSessionSecret(): string {
	const v = env.SESSION_SECRET?.trim();
	if (v) return v;
	if (isProd) throw new Error('Не задана обязательная переменная окружения: SESSION_SECRET');
	// Эфемерный секрет только для разработки (сессии сбрасываются при перезапуске).
	return 'dev-only-insecure-secret-' + randomBytes(8).toString('hex');
}

export const config = {
	port: parseInt(env.PORT ?? '3000', 3000, 1, 65535),
	host,
	dbPath: env.DB_PATH?.trim() || 'data/database.db',
	corsOrigin: (env.CORS_ORIGIN?.trim() || '*')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),
	apiPrefix: env.API_PREFIX?.trim() || '/api',
	isProd,
	// Сессии / аутентификация
	sessionSecret: resolveSessionSecret(),
	sessionTtlHours: parseInt(env.SESSION_TTL_HOURS ?? '12', 12, 1, 24 * 30),
	cookieSecure: isProd && host !== '127.0.0.1' && host !== 'localhost',
} as const;
