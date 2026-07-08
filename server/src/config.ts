/**
 * Конфигурация приложения.
 * Читается из переменных окружения (.env) со значениями по умолчанию.
 * Валидируется при первом импорте, чтобы «упасть громко и сразу».
 */

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

export const config = {
	port: parseInt(env.PORT ?? '3000', 3000, 1, 65535),
	host: env.HOST?.trim() || '127.0.0.1',
	dbPath: env.DB_PATH?.trim() || 'data/database.db',
	corsOrigin: (env.CORS_ORIGIN?.trim() || '*')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),
	apiPrefix: env.API_PREFIX?.trim() || '/api',
	isProd: (env.NODE_ENV ?? 'development').trim() === 'production',
} as const;
