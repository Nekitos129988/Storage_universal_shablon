/**
 * Точка входа приложения инвентаря офиса (Bun + Elysia + SQLite).
 *
 * Запуск:  bun run src/index.ts   (или bun run dev для hot-reload)
 */
import { Elysia, status as setStatus } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { existsSync, statSync } from 'node:fs';

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
import { getDb } from './db/client.ts';
import { seedIfEmpty } from './db/seed.ts';
import { itemsRoutes } from './routes/items.ts';
import { metaRoutes } from './routes/meta.ts';
import { statsRoutes } from './routes/stats.ts';
import { authRoutes } from './routes/auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { globalRateLimit } from './plugins/rateLimit.ts';
import { bootstrapAdminIfEmpty } from './services/authService.ts';
import { HttpError } from './utils/httpErrors.ts';

// --- Инициализация БД при старте -------------------------------------------
getDb();
const seeded = seedIfEmpty();
if (seeded) console.log('✅ БД инициализирована тестовыми данными');

// --- Приложение -------------------------------------------------------------
const app = new Elysia()
	// Регистрируем кастомный класс ошибки, чтобы Elysia его распознавала.
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
		console.error('[ERROR]', error);
		return setStatus(500, {
			error: { code: 'INTERNAL_ERROR', message: config.isProd ? 'Внутренняя ошибка сервера' : (error as Error).message },
		});
	})
	// CORS
	.use(
		cors({
			origin: config.corsOrigin,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		}),
	)
	// Документация API: http://host:port/swagger
	.use(swagger({ path: '/swagger', documentation: { info: { title: 'Инвентарь офиса API', version: '1.0.0' } } }))
		// Мягкая глобальная защита REST API от злоупотреблений (только для /api/*).
		.use(globalRateLimit)
	// Healthcheck
	.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }), {
		detail: { tags: ['Служебное'], summary: 'Проверка работоспособности' },
	})
	// REST API под общим префиксом
	.group(config.apiPrefix, (grp) =>
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
		// Нормализуем путь и защищаемся от выхода за пределы public/.
		const clean = decodeURIComponent(path).replace(/[?#].*$/, '').replace(/\/+/g, '/');
		const safe = clean.replace(/^(\.\.)+/, '').replace(/\.\.\//g, '');
		const filePath = `public${safe === '/' ? '/index.html' : safe}`;

		// Проверяем существование файла через fs (Bun.file().exists() бросает
		// исключение ENOENT на «директорию-подобных» путях, поэтому не используем его).
		if (existsSync(filePath) && statSync(filePath).isFile()) {
			set.headers['content-type'] = mimeFor(filePath);
			return Bun.file(filePath);
		}
		// SPA-fallback: любой незнакомый GET отдаёт index.html.
		set.headers['content-type'] = 'text/html; charset=utf-8';
		return Bun.file('public/index.html');
	});

// --- Запуск (async — argon2-хеширование при bootstrap админа асинхронно) -------
async function main() {
	// Первый администратор создаётся, если пользователей ещё нет.
	await bootstrapAdminIfEmpty();

	app.listen({ port: config.port, hostname: config.host }, (server) => {
		console.log('═══════════════════════════════════════════════');
		console.log('  📦 Инвентарь офиса — сервер запущен');
		console.log('═══════════════════════════════════════════════');
		console.log(`  Сайт:        http://${server.hostname}:${server.port}`);
		console.log(`  API:         http://${server.hostname}:${server.port}${config.apiPrefix}/items`);
		console.log(`  Документация: http://${server.hostname}:${server.port}/swagger`);
		console.log(`  Health:      http://${server.hostname}:${server.port}/health`);
		console.log('───────────────────────────────────────────────');
		console.log(`  Режим: ${config.isProd ? 'production' : 'development'} | БД: ${config.dbPath}`);
		console.log('═══════════════════════════════════════════════');
	});
}

main();
