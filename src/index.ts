/**
 * Точка входа приложения инвентаря офиса (Bun + Elysia + SQLite).
 *
 * Запуск:  bun run src/index.ts   (или bun run dev для hot-reload)
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Elysia, status as setStatus } from 'elysia';

/** Минимальная таблица MIME для раздачи статики. */
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.ico': 'image/x-icon',
};

function mimeFor(filePath: string): string {
	const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
	return MIME[ext] ?? 'application/octet-stream';
}

import { config } from './config.ts';
import { closeDb, getDb } from './db/client.ts';
import { seedIfEmpty } from './db/seed.ts';
import { globalRateLimit } from './plugins/rateLimit.ts';
import { requestLogger } from './plugins/requestLogger.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { itemsRoutes } from './routes/items.ts';
import { metaRoutes } from './routes/meta.ts';
import { statsRoutes } from './routes/stats.ts';
import { bootstrapAdminIfEmpty } from './services/authService.ts';
import { HttpError } from './utils/httpErrors.ts';
import { logger } from './utils/logger.ts';

// --- Инициализация БД при старте -------------------------------------------
getDb();
const seeded = seedIfEmpty();
if (seeded) logger.info('БД инициализирована тестовыми данными');

// --- Приложение -------------------------------------------------------------
// Абсолютный корень статики: все отдаваемые файлы обязаны лежать внутри него.
const PUBLIC_ROOT = resolve(process.cwd(), 'public');

const app = new Elysia()
	// Регистрируем кастомный класс ошибки, чтобы Elysia его распознавал.
	.error({ HTTP_ERROR: HttpError })
	// Единый формат ошибок. Ставится ПЕРВЫМ, чтобы перехватывать всё.
	.onError(({ code, error }) => {
		// Наши доменные ошибки — отдаём как есть с их статусом.
		if (error instanceof HttpError) {
			return setStatus(error.status, { error: { code: error.code, message: error.message } });
		}
		// Ошибки валидации Elysia/TypeBox — 400 с понятным описанием.
		if (code === 'VALIDATION') {
			const detail = (error as Error).message;
			return setStatus(400, {
				error: { code: 'VALIDATION_ERROR', message: 'Ошибка валидации данных', details: detail },
			});
		}
		// Всё прочее — 500.
		logger.error({ err: error }, 'необработанная ошибка');
		return setStatus(500, {
			error: {
				code: 'INTERNAL_ERROR',
				message: config.isProd ? 'Внутренняя ошибка сервера' : (error as Error).message,
			},
		});
	})
	// Логирование всех запросов (requestId + тайминг).
	.use(requestLogger)
	// CORS
	.use(
		cors({
			origin: config.corsOrigin,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		}),
	);

// Swagger только вне production: не светим структуру API публично.
if (!config.isProd) {
	app.use(swagger({ path: '/swagger', documentation: { info: { title: 'Инвентарь офиса API', version: '1.0.0' } } }));
}

app
	// Мягкая глобальная защита REST API от злоупотреблений (только для /api/*).
	.use(globalRateLimit)
	// Healthcheck
	.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }), {
		detail: { tags: ['Служебное'], summary: 'Проверка работоспособности' },
	})
	// REST API под общим префиксом
	.group(
		config.apiPrefix,
		(grp) =>
			grp
				.use(authRoutes) // /api/auth/*   (публичные: register/login/logout; me — по cookie)
				.use(statsRoutes) // /api/stats   (требует вход — guard внутри файла)
				.use(metaRoutes) // /api/categories, /api/locations (требует вход)
				.use(itemsRoutes) // /api/items/*  (GET — любая роль; POST/PUT/DELETE — editor/admin)
				.use(adminRoutes), // /api/admin/*  (только admin — guard внутри файла)
	)
	// Фронтенд: отдаём файлы из public/ вручную (staticPlugin в Elysia 1.4
	// конфликтует с response-валидацией для Bun.file, поэтому обходимся простым роутом).
	.get('*', ({ set, path }) => {
		// Нормализуем путь запроса (декодируем %XX, убираем query/fragment, схлопываем слеши).
		const clean = decodeURIComponent(path)
			.replace(/[?#].*$/, '')
			.replace(/\/+/g, '/');
		const rel = clean === '/' ? 'index.html' : clean;
		// resolve схлопывает любые '..' и нормализует сепараторы (включая обратные
		// слеши на Windows). Далее обязательная проверка, что итог внутри PUBLIC_ROOT —
		// это и есть защита от path traversal (независимо от кодировок и платформы).
		const resolved = resolve(PUBLIC_ROOT, '.' + rel);
		const inside = resolved === PUBLIC_ROOT || resolved.startsWith(PUBLIC_ROOT + sep);

		// Проверяем существование файла через fs (Bun.file().exists() бросает
		// исключение ENOENT на «директорию-подобных» путях, поэтому не используем его).
		if (inside && existsSync(resolved) && statSync(resolved).isFile()) {
			set.headers['content-type'] = mimeFor(resolved);
			return Bun.file(resolved);
		}
		// SPA-fallback: любой незнакомый GET отдаёт index.html.
		set.headers['content-type'] = 'text/html; charset=utf-8';
		return Bun.file(resolve(PUBLIC_ROOT, 'index.html'));
	});

// --- Запуск (async — argon2-хеширование при bootstrap админа асинхронно) -------
async function main() {
	// Первый администратор создаётся, если пользователей ещё нет.
	await bootstrapAdminIfEmpty();

	app.listen({ port: config.port, hostname: config.host }, (server) => {
		logger.info(
			{
				host: server.hostname,
				port: server.port,
				mode: config.isProd ? 'production' : 'development',
				apiPrefix: config.apiPrefix,
				swagger: !config.isProd,
				db: config.dbPath,
			},
			'сервер запущен',
		);

		// Корректная остановка по сигналу: перестаём принимать запросы и закрываем БД.
		const shutdown = (sig: string) => {
			logger.info({ signal: sig }, 'корректная остановка по сигналу');
			server.stop();
			closeDb();
			process.exit(0);
		};
		process.on('SIGTERM', () => shutdown('SIGTERM'));
		process.on('SIGINT', () => shutdown('SIGINT'));
	});
}

if (import.meta.main) main();
