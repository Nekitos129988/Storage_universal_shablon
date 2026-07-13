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
let catalog: typeof import('../src/services/catalogService.ts');
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
	catalog = await import('../src/services/catalogService.ts');
	guards = await import('../src/plugins/auth.ts');
	errors = await import('../src/utils/httpErrors.ts');
	typeSchema = await import('../src/db/schema.ts');

	client.getDb(); // инициализация схемы + FTS
	await auth.bootstrapAdminIfEmpty();

	// Каталог для item-тестов: категории/локации должны существовать в справочниках.
	const db = client.getDb();
	const addCat = db.prepare('INSERT OR IGNORE INTO categories(name) VALUES ($n)');
	for (const c of ['C', 'X', 'Техника', 'Мебель', 'Расходники']) addCat.run({ $n: c });
	const addLoc = db.prepare('INSERT OR IGNORE INTO locations(name) VALUES ($n)');
	for (const l of ['L', 'Y', 'А', 'Склад А', 'Склад Б', 'Офис 101']) addLoc.run({ $n: l });
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

	test('аудит: createItem фиксирует created_by и updated_at', () => {
		const it = items.createItem({ name: 'Аудит', category: 'C', quantity: 1, location: 'L' }, 42);
		expect(it.created_by).toBe(42);
		expect(it.updated_at).not.toBeNull();
	});

	test('аудит: updateItem обновляет updated_at', () => {
		const it = items.createItem({ name: 'Аудит2', category: 'C', quantity: 1, location: 'L' }, 42);
		const before = it.updated_at;
		const updated = items.updateItem(it.id, { name: 'Аудит2!', category: 'C', quantity: 2, location: 'L' });
		expect(updated.updated_at).not.toBeNull();
		expect(updated.updated_at! >= before!).toBe(true);
		expect(updated.created_by).toBe(42); // создатель не меняется при обновлении
	});

	test('удаление приводит к NotFound при повторном запросе', () => {
		const it = items.createItem({ name: 'Удаляемое', category: 'C', quantity: 1, location: 'L' });
		items.deleteItem(it.id);
		expect(() => items.getItemById(it.id)).toThrow();
	});

	test('soft-delete: удаление скрывает товар, но он остаётся в архиве', () => {
		const it = items.createItem({ name: 'Архивное', category: 'C', quantity: 1, location: 'L' });
		items.deleteItem(it.id);
		// в активном списке — нет
		expect(items.listItems({ per_page: '100' }).items.find((x) => x.id === it.id)).toBeUndefined();
		// в архиве — есть
		const archived = items.listArchivedItems();
		expect(archived.find((x) => x.id === it.id)?.name).toBe('Архивное');
	});

	test('soft-delete: восстановление возвращает товар в активный список', () => {
		const it = items.createItem({ name: 'Восстанавливаемое', category: 'C', quantity: 1, location: 'L' });
		items.deleteItem(it.id);
		const restored = items.restoreItem(it.id);
		expect(restored.deleted_at).toBeNull();
		expect(items.getItemById(it.id).name).toBe('Восстанавливаемое');
	});

	test('soft-delete: getStats не учитывает архивные', () => {
		items.createItem({ name: 'Активное', category: 'C', quantity: 5, location: 'L' });
		const toArchive = items.createItem({ name: 'В архив', category: 'C', quantity: 3, location: 'L' });
		items.deleteItem(toArchive.id);
		const s = items.getStats();
		// из двух созданных один в архиве → в статистике только активный
		expect(s.total_quantity).toBe(5);
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

	test('min_quantity сохраняется и по умолчанию 0', () => {
		const a = items.createItem({ name: 'С порогом', category: 'C', quantity: 2, location: 'L', min_quantity: 5 });
		expect(a.min_quantity).toBe(5);
		const b = items.createItem({ name: 'Без порога', category: 'C', quantity: 2, location: 'L' });
		expect(b.min_quantity).toBe(0);
	});

	test('low_stock_count и фильтр low_stock', () => {
		items.createItem({ name: 'Мало', category: 'C', quantity: 2, location: 'L', min_quantity: 5 });
		items.createItem({ name: 'Достаточно', category: 'C', quantity: 10, location: 'L', min_quantity: 5 });
		items.createItem({ name: 'Без порога', category: 'C', quantity: 0, location: 'L' });
		const s = items.getStats();
		expect(s.low_stock_count).toBe(1);
		const low = items.listItems({ low_stock: '1', per_page: '50' });
		expect(low.pagination.total_items).toBe(1);
		expect(low.items[0].name).toBe('Мало');
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

	test('revokeUserSessions инвалидирует ранее выданный токен', () => {
		const adminId = auth.getUserByUsername('admin')!.id;
		const token = auth.createSessionToken(auth.getUserByUsername('admin')!);
		expect(auth.verifySessionToken(token)?.username).toBe('admin');
		users.revokeUserSessions(adminId);
		expect(auth.verifySessionToken(token)).toBeNull();
		// новый токен (с актуальной версией) — валиден
		const fresh = auth.createSessionToken(auth.getUserByUsername('admin')!);
		expect(auth.verifySessionToken(fresh)?.username).toBe('admin');
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

// --- Справочники категорий/локаций -----------------------------------------
describe('catalog: CRUD и валидация', () => {
	test('создание/список/удаление записи', () => {
		const entry = catalog.createCatalogEntry('categories', 'ТестоваяКат');
		expect(entry.id).toBeGreaterThan(0);
		expect(catalog.listCatalog('categories').some((c) => c.id === entry.id)).toBe(true);
		catalog.deleteCatalogEntry('categories', entry.id);
		expect(catalog.listCatalog('categories').some((c) => c.id === entry.id)).toBe(false);
	});

	test('дубликат имени → Conflict', () => {
		const entry = catalog.createCatalogEntry('locations', 'ТестоваяЛок');
		try {
			expect(() => catalog.createCatalogEntry('locations', 'ТестоваяЛок')).toThrow();
			try {
				catalog.createCatalogEntry('locations', 'ТестоваяЛок');
			} catch (e) {
				expect((e as errors.HttpError).status).toBe(409);
			}
		} finally {
			catalog.deleteCatalogEntry('locations', entry.id);
		}
	});

	test('переименование глобально меняет категорию у товаров', () => {
		const cat = catalog.createCatalogEntry('categories', 'ПереименуемаяКат');
		const it = items.createItem({ name: 'Икс', category: 'ПереименуемаяКат', quantity: 1, location: 'L' });
		const renamed = catalog.renameCatalogEntry('categories', cat.id, 'ПереименованнаяКат');
		expect(renamed.name).toBe('ПереименованнаяКат');
		expect(items.getItemById(it.id).category).toBe('ПереименованнаяКат');
		items.deleteItem(it.id);
		catalog.deleteCatalogEntry('categories', cat.id); // теперь не используется
	});

	test('удаление используемой категории → Conflict', () => {
		const cat = catalog.createCatalogEntry('categories', 'ИспользуемаяКат');
		const it = items.createItem({ name: 'Игрек', category: 'ИспользуемаяКат', quantity: 1, location: 'L' });
		try {
			expect(() => catalog.deleteCatalogEntry('categories', cat.id)).toThrow();
			try {
				catalog.deleteCatalogEntry('categories', cat.id);
			} catch (e) {
				expect((e as errors.HttpError).status).toBe(409);
			}
		} finally {
			items.deleteItem(it.id);
			catalog.deleteCatalogEntry('categories', cat.id); // теперь можно
		}
	});

	test('создание товара с неизвестной категорией → BadRequest', () => {
		expect(() => items.createItem({ name: 'Z', category: 'Несуществующая', quantity: 1, location: 'L' })).toThrow();
	});
});
