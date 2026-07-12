/**
 * Логирование HTTP-запросов: requestId + длительность + статус.
 *
 * requestId генерируется на onRequest, кладётся в заголовок ответа X-Request-Id
 * и в лог — для связывания записей. Тайминги хранятся в WeakMap по объекту
 * Request (автоочистка после сборки мусора).
 */
import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import { logger } from '../utils/logger.ts';

interface RequestMeta {
	id: string;
	start: number;
}

const meta = new WeakMap<Request, RequestMeta>();

export const requestLogger = new Elysia({ name: 'app.requestLogger' })
	.onRequest(({ request, set }) => {
		const entry: RequestMeta = { id: randomUUID(), start: performance.now() };
		meta.set(request, entry);
		set.headers['x-request-id'] = entry.id;
	})
	.onAfterResponse(({ request, set }) => {
		const entry = meta.get(request);
		if (!entry) return;
		const path = safePath(request.url);
		const status = typeof set.status === 'number' ? set.status : 200;
		logger.info(
			{
				requestId: entry.id,
				method: request.method,
				path,
				status,
				ms: Math.round(performance.now() - entry.start),
			},
			'request',
		);
	});

function safePath(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}
