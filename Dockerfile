# Образ приложения инвентаря офиса (Bun + Elysia + SQLite).
# production-режим: NODE_ENV=production, JSON-логи, без Swagger.
FROM oven/bun:1 AS base
WORKDIR /app

# Зависимости (кэшируется отдельным слоем). --production — без devDeps
# (biome/@types/bun/pino-pretty не нужны в рантайме; в prod логи — JSON).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Исходники (без node_modules/.git/tests/data — см. .dockerignore).
COPY src src
COPY public public
COPY tsconfig.json ./

RUN mkdir -p data && chown -R bun:bun /app

ENV NODE_ENV=production
USER bun
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
