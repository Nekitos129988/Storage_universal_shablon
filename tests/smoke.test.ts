/**
 * Smoke-тесты критических путей (без HTTP — на уровне сервисов и гвардов).
 *
 * Окружение (DB_PATH, ADMIN_PASSWORD, …) задаётся ДО динамического импорта
 * исходников, чтобы config.ts подхватил их при первом вычислении. БД — временный
 * файл, очищается между группами тестов.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_DB = join(tmpdir(), `inv-smoke-${process.pid}.db`);

// Модули подтягиваются после настройки env (динамический импорт обходит hoisting).
let client: typeof import('../src/db/client.ts');
let auth: typeof import('../src/services/authService.ts');
let items: typeof import('../src/services/itemsService.ts');
let users: typeof import('../src/services/usersService.ts');
let guards: typeof import('../src/plugins/auth.ts');
let errors: typeof import('../src/utils/httpErrors.ts');
let typeSchema: typeof import('../src/db/schema.ts');

beforeAll(async () => {
	process.env.DB_PATH = TMP_DB;
	process.env.ADMIN_PASSWORD = 'admin123456';
	process.env.SESSION_SECRET = 'test-secret-fixed';
	process.env.NODE_ENV = 'development';
	rmSync(TMP_DB, { force: true });

	client = await import('../src/db/client.ts');
	auth = await import('../src/services/authService.ts');
	items = await import('../src/services/itemsService.ts');
	users = await import('../src/services/usersService.ts');
	guards = await import('../src/plugins/auth.ts');
	errors = await import('../src/utils/httpErrors.ts');
	typeSchema = await import('../src/db/schema.ts');

	client.getDb(); // инициализация схемы + FTS
	await auth.bootstrapAdminIfEmpty();
});

afterAll(() => {
	// Очистка best-effort: на Windows файл БД может быть ещё недоступен для удаления
	// сразу после close() — это не должно валить набор тестов.
	try {
		client.closeDb();
	} catch {
		/* noop */
	}
	for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) {
		try {
			rmSync(f, { force: true });
		} catch {
			/* noop */
		}
	}
});

// Хелперы очистки состояния между тестами.
const clearItems = () => client.getDb().exec('DELETE FROM items');
const clearNonAdminUsers = () => client.getDb().exec("DELETE FROM users WHERE role != 'admin'");

const adminUser = (): typeSchema.PublicUser => ({
	id: 1,
	username: 'admin',
	role: 'admin',
	status: 'active',
	created_at: '2026-01-01 00:00:00',
});

// --- Аутентификация ---------------------------------------------------------
describe('auth: bootstrap, login, register, токены', () => {
	test('bootstrap создал администратора', () => {
		const u = auth.getUserByUsername('admin');
		expect(u).not.toBeNull();
		expect(u?.role).toBe('admin');
		expect(u?.status).toBe('active');
	});

	test('вход с верным паролем возвращает пользователя и токен', async () => {
		const res = await auth.login({ username: 'admin', password: 'admin123456' });
		expect(res.user.username).toBe('admin');
		expect(res.token).toBeTruthy();
	});

	test('вход с неверным паролем бросает Unauthorized', async () => {
		expect(auth.login({ username: 'admin', password: 'wrong' })).rejects.toThrow();
		try {
			await auth.login({ username: 'admin', password: 'wrong' });
		} catch (e) {
			expect((e as errors.HttpError).status).toBe(401);
		}
	});

	test('регистрация создаёт пользователя в статусе pending', async () => {
		const u = await auth.register({ username: 'newviewer', password: 'pass1234' });
		expect(u.role).toBe('viewer');
		expect(u.status).toBe('pending');
		const raw = auth.getUserByUsername('newviewer');
		expect(raw?.status).toBe('pending');
	});

	test('токен проверяется и возвращает публичного пользователя', async () => {
		const { token } = await auth.login({ username: 'admin', password: 'admin123456' });
		const pub = auth.verifySessionToken(token);
		expect(pub?.username).toBe('admin');
	});

	test('поддельный/чужой токен отклоняется (→ null)', () => {
		expect(auth.verifySessionToken('garbage.token')).toBeNull();
		expect(auth.verifySessionToken(undefined)).toBeNull();
	});

	test('пароль > 1000 символов отклоняется', async () => {
		const long = 'x'.repeat(1001);
		expect(auth.register({ username: 'longpw', password: long })).rejects.toThrow();
	});
});

// --- Товары: CRUD, FTS, лимиты ---------------------------------------------
describe('items: CRUD, FTS-поиск, лимиты', () => {
	beforeEach(clearItems);

	test('создание и получение по id', () => {
		const created = items.createItem({
			name: 'Тестовый стул',
			category: 'Мебель',
			quantity: 4,
			location: 'Офис 101',
			description: 'Тест',
		});
		const got = items.getItemById(created.id);
		expect(got.name).toBe('Тестовый стул');
		expect(got.quantity).toBe(4);
	});

	test('FTS-поиск регистронезависим для кириллицы', () => {
		items.createItem({ name: 'Ноутбук Lenovo', category: 'Техника', quantity: 3, location: 'Склад А' });
		items.createItem({ name: 'НОУТБУК Asus', category: 'Техника', quantity: 2, location: 'Склад А' });
		items.createItem({ name: 'Бумага А4', category: 'Расходники', quantity: 500, location: 'Склад Б' });

		const lower = items.listItems({ search: 'ноутбук', per_page: '50' });
		expect(lower.pagination.total_items).toBe(2);
		const upper = items.listItems({ search: 'НОУТБУК', per_page: '50' });
		expect(upper.pagination.total_items).toBe(2);
	});

	test('поиск + фильтр по категории вместе', () => {
		items.createItem({ name: 'Ноутбук X', category: 'Техника', quantity: 1, location: 'А' });
		items.createItem({ name: 'Ноутбук Y', category: 'Мебель', quantity: 1, location: 'А' });
		const r = items.listItems({ search: 'ноутбук', category: 'Техника', per_page: '50' });
		expect(r.pagination.total_items).toBe(1);
		expect(r.items[0].category).toBe('Техника');
	});

	test('пагинация: per_page ограничивает выдачу', () => {
		for (let i = 0; i < 5; i++) items.createItem({ name: `Товар ${i}`, category: 'X', quantity: 1, location: 'Y' });
		const r = items.listItems({ per_page: '2', page: '1' });
		expect(r.items.length).toBe(2);
		expect(r.pagination.total_items).toBe(5);
		expect(r.pagination.total_pages).toBe(3);
		expect(r.pagination.has_next).toBe(true);
	});

	test('обновление меняет поля', () => {
		const it = items.createItem({ name: 'Старое', category: 'C', quantity: 1, location: 'L' });
		const updated = items.updateItem(it.id, { name: 'Новое', category: 'C', quantity: 9, location: 'L' });
		expect(updated.name).toBe('Новое');
		expect(updated.quantity).toBe(9);
	});

	test('удаление приводит к NotFound при повторном запросе', () => {
		const it = items.createItem({ name: 'Удаляемое', category: 'C', quantity: 1, location: 'L' });
		items.deleteItem(it.id);
		expect(() => items.getItemById(it.id)).toThrow();
	});

	test('getStats считает позиции и единицы', () => {
		items.createItem({ name: 'A', category: 'Техника', quantity: 3, location: 'L' });
		items.createItem({ name: 'B', category: 'Техника', quantity: 7, location: 'L' });
		const s = items.getStats();
		expect(s.total_items).toBe(2);
		expect(s.total_quantity).toBe(10);
		expect(s.categories.find((c) => c.category === 'Техника')?.total_quantity).toBe(10);
	});

	test('имя длиннее 200 символов отклоняется', () => {
		expect(() => items.createItem({ name: 'я'.repeat(201), category: 'C', quantity: 1, location: 'L' })).toThrow();
	});
});

// --- Пользователи: бизнес-правила администрирования ------------------------
describe('users: правила ролей и защиты последнего админа', () => {
	beforeEach(clearNonAdminUsers);

	test('админ создаёт подтверждённого пользователя с заданной ролью', async () => {
		const u = await users.createUser({ username: 'editor1', password: 'pass1234', role: 'editor' });
		expect(u.role).toBe('editor');
		expect(u.status).toBe('active');
	});

	test('подтверждение переводит pending → active', async () => {
		await auth.register({ username: 'pending1', password: 'pass1234' });
		const raw = auth.getUserByUsername('pending1');
		expect(raw?.status).toBe('pending');
		const approved = users.approveUser(raw!.id);
		expect(approved.status).toBe('active');
	});

	test('нельзя изменить свою собственную роль', () => {
		const adminId = auth.getUserByUsername('admin')!.id;
		expect(() => users.updateUserRole(adminId, 'viewer', adminId)).toThrow();
	});

	test('нельзя удалить самого себя', () => {
		const adminId = auth.getUserByUsername('admin')!.id;
		expect(() => users.deleteUser(adminId, adminId)).toThrow();
	});

	test('нельзя понизить последнего администратора', () => {
		const adminId = auth.getUserByUsername('admin')!.id;
		expect(() => users.updateUserRole(adminId, 'viewer', 999)).toThrow();
	});

	test('нельзя удалить последнего администратора', () => {
		const adminId = auth.getUserByUsername('admin')!.id;
		expect(() => users.deleteUser(adminId, 999)).toThrow();
	});
});

// --- Гварды авторизации ----------------------------------------------------
describe('guards: requireAuth / requireRole', () => {
	test('requireAuth бросает Unauthorized без пользователя', () => {
		expect(() => guards.requireAuth({ currentUser: null })).toThrow();
		try {
			guards.requireAuth({ currentUser: null });
		} catch (e) {
			expect((e as errors.HttpError).status).toBe(401);
		}
	});

	test('requireAuth пропускает аутентифицированного', () => {
		expect(() => guards.requireAuth({ currentUser: adminUser() })).not.toThrow();
	});

	test('requireRole бросает Forbidden для чужой роли', () => {
		const viewer = { ...adminUser(), role: 'viewer' as const };
		expect(() => guards.requireRole('admin')({ currentUser: viewer })).toThrow();
		try {
			guards.requireRole('admin')({ currentUser: viewer });
		} catch (e) {
			expect((e as errors.HttpError).status).toBe(403);
		}
	});

	test('requireRole пропускает подходящую роль', () => {
		expect(() => guards.requireRole('admin', 'editor')({ currentUser: adminUser() })).not.toThrow();
	});
});
