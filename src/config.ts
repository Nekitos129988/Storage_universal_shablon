/**
 * Конфигурация приложения.
 * Читается из переменных окружения (.env) со значениями по умолчанию.
 * Валидируется при первом импорте, чтобы «упасть громко и сразу».
 */
import { randomBytes } from 'node:crypto';

/** Парсит целое из строки env с clamping-ом в [min, max]; при неудаче — fallback. */
function parseClampedInt(value: string, fallback: number, min = 1, max = 65535): number {
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

/**
 * Учётные данные первого администратора (создаётся при пустой БД).
 * В production ADMIN_PASSWORD обязателен; в dev, если не задан — генерируется
 * случайный (выводится в консоль при первом старте, чтобы не было фиксированного слабого пароля).
 * `generated` показывает, был ли пароль сгенерирован (нужно для логирования).
 */
function resolveAdminCredentials(): { username: string; password: string; generated: boolean } {
	const username = env.ADMIN_USERNAME?.trim() || 'admin';
	const pwd = env.ADMIN_PASSWORD?.trim();
	if (pwd) return { username, password: pwd, generated: false };
	if (isProd) throw new Error('Не задана обязательная переменная окружения: ADMIN_PASSWORD');
	return { username, password: randomBytes(16).toString('hex'), generated: true };
}

const adminCredentials = resolveAdminCredentials();

export const config = {
	port: parseClampedInt(env.PORT ?? '3000', 3000, 1, 65535),
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
	sessionTtlHours: parseClampedInt(env.SESSION_TTL_HOURS ?? '12', 12, 1, 24 * 30),
	cookieSecure: isProd && host !== '127.0.0.1' && host !== 'localhost',
	// Первый администратор (создаётся при пустой БД)
	adminUsername: adminCredentials.username,
	adminPassword: adminCredentials.password,
	adminPasswordGenerated: adminCredentials.generated,
	// Ограничение частоты запросов (rate-limit)
	rateLimitLoginMax: parseClampedInt(env.RATE_LOGIN_MAX ?? '5', 5, 1, 1000),
	rateLimitLoginWindowMs: parseClampedInt(env.RATE_LOGIN_WINDOW_SEC ?? '60', 60, 1, 3600) * 1000,
	rateLimitGlobalMax: parseClampedInt(env.RATE_GLOBAL_MAX ?? '300', 300, 1, 100_000),
	rateLimitGlobalWindowMs: parseClampedInt(env.RATE_GLOBAL_WINDOW_SEC ?? '60', 60, 1, 3600) * 1000,
} as const;
