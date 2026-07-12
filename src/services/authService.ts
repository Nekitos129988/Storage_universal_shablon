/**
 * Сервис аутентификации: регистрация, вход, выпуск и проверка сессионных токенов,
 * а также bootstrap первого администратора при пустой базе.
 *
 * Механизм: cookie-сессии с подписанным HMAC-SHA256 токеном; пароли — argon2id
 * через встроенный Bun.password. Без внешних зависимостей.
 *
 * Контракт: verifySessionToken НИКОГДА не бросает — при любой проблеме возвращает null.
 * Единственное место, где бросаются ошибки аутентификации — гвард requireAuth/requireRole.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';
import { getDb } from '../db/client.ts';
import type { LoginInput, PublicUser, RegisterInput, User } from '../db/schema.ts';
import { BadRequest, Conflict, Forbidden, Unauthorized } from '../utils/httpErrors.ts';

/**
 * Валидный argon2id-хеш мусорной строки — нужен, чтобы при отсутствии
 * пользователя выполнить честный Bun.password.verify (выровнять тайминг ответа).
 * Любой введённый пароль против него даст false. Если строка окажется невалидной —
 * ничего страшного: проверка обёрнута в try/catch в login().
 */
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$RfalGZmT8nTpYwi0jFvL6d+Z4DqA9KZQ7xqF2QyKjOA';

/** Лимиты учётных данных (защита от безлимитной записи и злоупотреблений). */
export const USERNAME_MAX = 50;
export const PASSWORD_MAX = 1000;

// --- base64url helpers ------------------------------------------------------

const b64urlEncode = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const b64urlDecode = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

// --- Преобразование в безопасную форму --------------------------------------

/** Убирает password_hash — отдаём клиентам только PublicUser. */
export function toPublicUser(user: User): PublicUser {
	return { id: user.id, username: user.username, role: user.role, status: user.status, created_at: user.created_at };
}

// --- Выпуск и проверка сессионного токена -----------------------------------

interface SessionPayload {
	uid: number;
	exp: number; // Unix-секунды
}

/** Подписывает payload секретом и возвращает HMAC в base64url. */
function sign(payloadB64: string): string {
	return createHmac('sha256', config.sessionSecret).update(payloadB64).digest('base64url');
}

/** Постоянное по времени сравнение (с защитой от разной длины). */
function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/** Создаёт подписанный сессионный токен: `<payloadB64>.<hmacB64>`. */
export function createSessionToken(user: User): string {
	const now = Math.floor(Date.now() / 1000);
	const payload: SessionPayload = { uid: user.id, exp: now + config.sessionTtlHours * 3600 };
	const payloadB64 = b64urlEncode(JSON.stringify(payload));
	return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Проверяет токен и возвращает пользователя либо null.
 * НИКОГДА не бросает — все ошибки (формат, подпись, срок, отсутствие пользователя) → null.
 */
export function verifySessionToken(token: string | undefined | null): PublicUser | null {
	if (!token || typeof token !== 'string') return null;
	try {
		const dot = token.lastIndexOf('.');
		if (dot <= 0) return null;
		const payloadB64 = token.slice(0, dot);
		const sig = token.slice(dot + 1);
		// Проверка подписи до разбора payload (чтобы не доверять «чужому» содержимому).
		if (!safeEqual(sig, sign(payloadB64))) return null;

		const payload = JSON.parse(b64urlDecode(payloadB64)) as SessionPayload;
		if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
		if (typeof payload.uid !== 'number') return null;

		const user = getUserById(payload.uid);
		// Если аккаунт деактивирован/ещё не подтверждён — сессия недействительна.
		return user && user.status === 'active' ? toPublicUser(user) : null;
	} catch {
		return null;
	}
}

// --- Доступ к пользователям -------------------------------------------------

export function getUserById(id: number): User | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM users WHERE id = $id').get({ $id: id }) as User | null;
	return row ?? null;
}

export function getUserByUsername(username: string): User | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM users WHERE username = $username').get({ $username: username }) as User | null;
	return row ?? null;
}

// --- Валидация --------------------------------------------------------------

function validateCredentials(username: string, password: string): void {
	if (!username || username.trim().length < 3) {
		throw BadRequest('Имя пользователя должно содержать минимум 3 символа');
	}
	if (!password || password.length < 6) {
		throw BadRequest('Пароль должен содержать минимум 6 символов');
	}
	if (username.length > USERNAME_MAX) {
		throw BadRequest(`Имя пользователя слишком длинное (макс. ${USERNAME_MAX} символов)`);
	}
	if (password.length > PASSWORD_MAX) {
		throw BadRequest(`Пароль слишком длинный (макс. ${PASSWORD_MAX} символов)`);
	}
}

// --- Регистрация и вход ------------------------------------------------------

/**
 * Регистрация нового пользователя. Новый всегда получает роль 'viewer'.
 * Возвращает безопасную форму пользователя (без хеша).
 */
export async function register(input: RegisterInput): Promise<PublicUser> {
	const username = input.username.trim();
	validateCredentials(username, input.password);

	if (getUserByUsername(username)) {
		throw Conflict('Имя пользователя уже занято');
	}

	const passwordHash = await Bun.password.hash(input.password);
	const db = getDb();
	try {
		// Новый пользователь ждёт подтверждения администратора (status='pending').
		db.prepare(
			`INSERT INTO users (username, password_hash, role, status) VALUES ($username, $hash, 'viewer', 'pending')`,
		).run({ $username: username, $hash: passwordHash });
	} catch (err) {
		// На случай гонки — UNIQUE-нарушение тоже трактуем как конфликт.
		if (err instanceof Error && err.message.includes('UNIQUE')) {
			throw Conflict('Имя пользователя уже занято');
		}
		throw err;
	}

	const created = getUserByUsername(username);
	if (!created) throw Conflict('Не удалось создать пользователя');
	return toPublicUser(created);
}

/**
 * Проверяет учётные данные и возвращает { user, token }.
 * При любой неудаче бросает Unauthorized с одинаковым сообщением (без указания, что именно не так).
 */
export async function login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
	const user = getUserByUsername(input.username.trim());

	// Проверяем пароль; для несуществующего пользователя тоже вызываем verify
	// (фиктивный хеш), чтобы выровнять время ответа. Любая ошибка разбора → не ok.
	let ok = false;
	try {
		ok = user
			? await Bun.password.verify(input.password, user.password_hash)
			: await Bun.password.verify(input.password, DUMMY_HASH);
	} catch {
		ok = false;
	}

	if (!user || !ok) {
		throw Unauthorized('Неверные учётные данные');
	}
	// Учётная запись может быть ещё не подтверждена администратором.
	if (user.status !== 'active') {
		throw Forbidden('Учётная запись ожидает подтверждения администратора');
	}

	return { user: toPublicUser(user), token: createSessionToken(user) };
}

// --- Bootstrap первого администратора ---------------------------------------

/**
 * Если таблица users пуста, создаёт учётную запись администратора.
 * Логин и пароль берутся из конфигурации (env ADMIN_USERNAME / ADMIN_PASSWORD);
 * в dev без ADMIN_PASSWORD пароль генерируется случайно и выводится в консоль.
 * Возвращает true, если администратор был создан.
 */
export async function bootstrapAdminIfEmpty(): Promise<boolean> {
	const db = getDb();
	const { n } = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
	if (n > 0) return false;

	const { adminUsername, adminPassword, adminPasswordGenerated } = config;
	const passwordHash = await Bun.password.hash(adminPassword);
	db.prepare(
		`INSERT INTO users (username, password_hash, role, status) VALUES ($username, $hash, 'admin', 'active')`,
	).run({ $username: adminUsername, $hash: passwordHash });

	console.warn('───────────────────────────────────────────────');
	console.warn('  ⚠️  Создан администратор');
	console.warn(`     Логин: ${adminUsername}`);
	if (adminPasswordGenerated) {
		// dev: пароль сгенерирован случайно — покажем, чтобы можно было войти и сразу сменить.
		console.warn(`     Пароль: ${adminPassword} (сгенерирован случайно)`);
	} else {
		// prod или заданный явно: значение не выводим.
		console.warn('     Пароль: задан через ADMIN_PASSWORD');
	}
	console.warn('     Смените пароль после первого входа!');
	console.warn('───────────────────────────────────────────────');
	return true;
}
