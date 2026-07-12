/**
 * Сервисный слой для управления пользователями (админка).
 * Инкапсулирует бизнес-правила:
 *  - нельзя удалить/изменить роль самого себя;
 *  - нельзя удалить или понизить последнего администратора.
 * Все запросы параметризованы; уникальность username обеспечивается констрейнтом БД.
 */
import { getDb } from '../db/client.ts';
import type { CreateUserInput, PublicUser, Role, User } from '../db/schema.ts';
import { PASSWORD_MAX, toPublicUser, USERNAME_MAX } from './authService.ts';
import { BadRequest, Conflict, Forbidden, NotFound } from '../utils/httpErrors.ts';

const VALID_ROLES: Role[] = ['admin', 'editor', 'viewer'];

/** Список всех пользователей (без хешей паролей). */
export function listUsers(): PublicUser[] {
	const db = getDb();
	const rows = db.prepare('SELECT * FROM users ORDER BY id').all() as User[];
	return rows.map(toPublicUser);
}

/** Один пользователь по id (внутренняя форма с хешем). */
function getRawUserById(id: number): User {
	const db = getDb();
	const row = db.prepare('SELECT * FROM users WHERE id = $id').get({ $id: id }) as User | null;
	if (!row) throw NotFound(`Пользователь с id=${id} не найден`);
	return row;
}

/** Количество администраторов. */
function countAdmins(): number {
	const db = getDb();
	const { n } = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get() as { n: number };
	return n;
}

/** Создание пользователя админом (роль задаётся явно). Возвращает безопасную форму. */
export async function createUser(input: CreateUserInput): Promise<PublicUser> {
	const username = input.username.trim();
	if (username.length < 3) throw BadRequest('Имя пользователя должно содержать минимум 3 символа');
	if (input.password.length < 6) throw BadRequest('Пароль должен содержать минимум 6 символов');
	if (username.length > USERNAME_MAX) throw BadRequest(`Имя пользователя слишком длинное (макс. ${USERNAME_MAX} символов)`);
	if (input.password.length > PASSWORD_MAX) throw BadRequest(`Пароль слишком длинный (макс. ${PASSWORD_MAX} символов)`);
	if (!VALID_ROLES.includes(input.role)) throw BadRequest('Недопустимая роль');

	const passwordHash = await Bun.password.hash(input.password);
	const db = getDb();
	try {
		// Администратор создаёт уже подтверждённого пользователя.
		db.prepare(
			`INSERT INTO users (username, password_hash, role, status) VALUES ($username, $hash, $role, 'active')`,
		).run({ $username: username, $hash: passwordHash, $role: input.role });
	} catch (err) {
		if (err instanceof Error && err.message.includes('UNIQUE')) {
			throw Conflict('Имя пользователя уже занято');
		}
		throw err;
	}

	const created = db.prepare('SELECT * FROM users WHERE username = $username').get({ $username: username }) as User;
	return toPublicUser(created);
}

/**
 * Подтверждение учётной записи администратором (status → 'active').
 * Используется для одобрения самостоятельных регистраций (изначально 'pending').
 */
export function approveUser(id: number): PublicUser {
	getRawUserById(id); // выбросит NotFound, если пользователя нет
	const db = getDb();
	db.prepare("UPDATE users SET status = 'active' WHERE id = $id").run({ $id: id });
	return toPublicUser(getRawUserById(id));
}

/**
 * Смена роли пользователя.
 * @param currentId  id того, кто выполняет действие (нельзя менять свою роль).
 */
export function updateUserRole(id: number, newRole: Role, currentId: number): PublicUser {
	if (!VALID_ROLES.includes(newRole)) throw BadRequest('Недопустимая роль');
	if (id === currentId) throw Forbidden('Нельзя изменить свою собственную роль');

	const target = getRawUserById(id);
	// Запрет понижения последнего администратора.
	if (target.role === 'admin' && newRole !== 'admin' && countAdmins() <= 1) {
		throw Forbidden('Нельзя понизить последнего администратора');
	}

	const db = getDb();
	db.prepare('UPDATE users SET role = $role WHERE id = $id').run({ $role: newRole, $id: id });
	return toPublicUser(getRawUserById(id));
}

/**
 * Удаление пользователя.
 * @param currentId  id того, кто выполняет действие (нельзя удалить себя).
 */
export function deleteUser(id: number, currentId: number): void {
	if (id === currentId) throw Forbidden('Нельзя удалить самого себя');

	const target = getRawUserById(id);
	if (target.role === 'admin' && countAdmins() <= 1) {
		throw Forbidden('Нельзя удалить последнего администратора');
	}

	const db = getDb();
	db.prepare('DELETE FROM users WHERE id = $id').run({ $id: id });
}
