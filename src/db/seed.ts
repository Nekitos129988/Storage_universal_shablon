/**
 * Заполнение БД тестовыми данными (10 позиций из оригинального app.py).
 * Запускается скриптом `bun run seed` либо автоматически при первом старте,
 * если таблица пуста.
 */

import { logger } from '../utils/logger.ts';
import { getDb } from './client.ts';
import type { Item } from './schema.ts';

const SEED_ITEMS: Omit<Item, 'id'>[] = [
	{
		name: 'Ноутбук Lenovo',
		category: 'Техника',
		quantity: 5,
		location: 'Склад А',
		description: 'Рабочие ноутбуки для сотрудников',
		date_added: '2026-01-15',
	},
	{
		name: 'Офисный стул',
		category: 'Мебель',
		quantity: 12,
		location: 'Офис 101',
		description: 'Черные, тканевые, кокразябра',
		date_added: '2026-01-20',
	},
	{
		name: 'Бумага А4',
		category: 'Расходники',
		quantity: 50,
		location: 'Склад Б',
		description: 'Пачка 500 листов',
		date_added: '2026-01-25',
	},
	{
		name: 'Клавиатура Logitech',
		category: 'Техника',
		quantity: 8,
		location: 'Склад А',
		description: 'USB проводные, кокразябра',
		date_added: '2026-02-01',
	},
	{
		name: 'Шкаф для документов',
		category: 'Мебель',
		quantity: 3,
		location: 'Офис 202',
		description: 'Металлический',
		date_added: '2026-02-05',
	},
	{
		name: 'Ручки шариковые',
		category: 'Канцелярия',
		quantity: 100,
		location: 'Склад Б',
		description: 'Синие, 0.7 мм',
		date_added: '2026-02-10',
	},
	{
		name: 'Монитор 24"',
		category: 'Техника',
		quantity: 6,
		location: 'Склад А',
		description: 'Full HD, HDMI, кокразябра',
		date_added: '2026-02-15',
	},
	{
		name: 'Степлер',
		category: 'Канцелярия',
		quantity: 15,
		location: 'Офис 101',
		description: 'Красный',
		date_added: '2026-02-20',
	},
	{
		name: 'Офисный стол',
		category: 'Мебель',
		quantity: 4,
		location: 'Офис 202',
		description: 'Деревянный',
		date_added: '2026-03-01',
	},
	{
		name: 'Тонер для принтера',
		category: 'Расходники',
		quantity: 7,
		location: 'Склад Б',
		description: 'HP 85A',
		date_added: '2026-03-05',
	},
];

/**
 * Добавляет тестовые данные, если таблица items пуста.
 * Безопасно вызывать многократно.
 */
export function seedIfEmpty(): boolean {
	const db = getDb();
	const count = db.query('SELECT COUNT(*) as n FROM items').get() as { n: number };
	if (count.n > 0) return false;

	const insert = db.prepare(
		`INSERT INTO items (name, category, quantity, location, description, date_added)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	);
	for (const item of SEED_ITEMS) {
		insert.run(item.name, item.category, item.quantity, item.location, item.description, item.date_added);
	}
	return true;
}

// Если файл запущен напрямую (`bun run src/db/seed.ts`) — заполняем БД.
if (import.meta.main) {
	const seeded = seedIfEmpty();
	logger.info(
		seeded ? { added: SEED_ITEMS.length } : {},
		seeded ? 'тестовые данные добавлены' : 'БД уже содержит данные — сидинг пропущен',
	);
}
