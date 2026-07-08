# Инвентарь офиса — сервер на Bun

Серверная часть приложения учёта офисного инвентаря, переписанная с Python/Flask на
**[Bun](https://bun.sh)** + **[Elysia](https://elysiajs.com)** + **SQLite** (`bun:sqlite`).

Это порт исходного `app.py` (Flask) с улучшениями: REST API, TypeScript, фильтрация/
сортировка/пагинация на уровне SQL, валидация запросов, автодокументация Swagger.

> **Примечание:** статику отдаёт собственный маршрут (через `Bun.file`), а не
> `@elysiajs/static` — в Elysia 1.4 плагин конфликтует с response-валидацией для
> файловых ответов. Встроенный `Bun.file` быстрее и не имеет этой проблемы.

> Оригинальные Python-файлы (`app.py`, `requirements.txt`, `templates/`) сохранены
> в корне репозитория как референс.

## Возможности

- 📦 CRUD товаров (создание, чтение, обновление, удаление)
- 🔍 Фильтрация по категории, местоположению, минимальному количеству, поиск по тексту
- ↕️ Сортировка по всем полям
- 📄 Пагинация
- 📊 Статистика (всего позиций/единиц, разбивка по категориям)
- 📚 Автодокументация API (Swagger UI)
- ✅ Валидация входных данных (TypeBox)

## Требования

- [Bun](https://bun.sh) ≥ 1.1.0

## Установка

```bash
bun install
```

## Запуск

```bash
bun run start        # продакшен-режим
# или
bun run dev          # разработка с hot-reload (--watch)
```

При первом старте база данных создаётся автоматически и наполняется
10 тестовыми позициями (если пуста).

- **Сайт:** http://127.0.0.1:3000
- **API:** http://127.0.0.1:3000/api/items
- **Swagger:** http://127.0.0.1:3000/swagger
- **Healthcheck:** http://127.0.0.1:3000/health

## Конфигурация

Через файл `.env` (скопируйте `.env.example`):

| Переменная     | По умолчанию          | Описание                                  |
|----------------|-----------------------|-------------------------------------------|
| `PORT`         | `3000`                | Порт HTTP-сервера                         |
| `HOST`         | `127.0.0.1`           | Хост привязки                             |
| `DB_PATH`      | `data/database.db`    | Путь к файлу SQLite                       |
| `CORS_ORIGIN`  | `*`                   | Разрешённые источники (через запятую)     |
| `API_PREFIX`   | `/api`                | Префикс REST API                          |

## REST API

| Метод   | Путь                       | Описание                                        |
|---------|----------------------------|-------------------------------------------------|
| `GET`   | `/api/items`               | Список (фильтры, сортировка, пагинация, стат.) |
| `GET`   | `/api/items/:id`           | Один товар                                      |
| `POST`  | `/api/items`               | Создать                                         |
| `PUT`   | `/api/items/:id`           | Обновить                                        |
| `DELETE`| `/api/items/:id`           | Удалить                                         |
| `GET`   | `/api/stats`               | Статистика                                      |
| `GET`   | `/api/categories`          | Уникальные категории                            |
| `GET`   | `/api/locations`           | Уникальные местоположения                       |

### Параметры запроса `GET /api/items`

`page`, `per_page`, `category`, `location`, `min_quantity`, `search`, `sort`, `order` (`asc`/`desc`).

`sort` ∈ `id | name | category | quantity | location | date_added`.

Пример:
```
GET /api/items?category=Техника&sort=name&order=asc&page=1&per_page=10
```

## Структура проекта

```
.
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── data/                   # файл SQLite (создаётся автоматически)
├── src/
│   ├── index.ts            # точка входа: Elysia-приложение
│   ├── config.ts           # конфигурация из .env
│   ├── db/
│   │   ├── client.ts       # подключение bun:sqlite (singleton)
│   │   ├── schema.ts       # DDL и типы
│   │   └── seed.ts         # тестовые данные
│   ├── services/
│   │   └── itemsService.ts # бизнес-логика (SQL-запросы)
│   ├── routes/
│   │   ├── items.ts        # CRUD /items
│   │   ├── stats.ts        # /stats
│   │   └── meta.ts         # /categories, /locations
│   └── utils/
│       ├── pagination.ts
│       └── httpErrors.ts
└── public/                 # фронтенд (vanilla JS + Bootstrap)
    ├── index.html
    ├── app.js
    └── styles.css
```
