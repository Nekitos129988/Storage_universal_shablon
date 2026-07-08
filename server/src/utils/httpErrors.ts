/**
 * HTTP-ошибки с единым форматом ответа.
 * В index.ts перехватываются через Elysia onError и сериализуются в JSON.
 */
export class HttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

export const BadRequest = (msg = 'Некорректный запрос') => new HttpError(400, msg, 'BAD_REQUEST');
export const NotFound = (msg = 'Ресурс не найден') => new HttpError(404, msg, 'NOT_FOUND');
export const Conflict = (msg = 'Конфликт') => new HttpError(409, msg, 'CONFLICT');
export const InternalError = (msg = 'Внутренняя ошибка сервера') => new HttpError(500, msg, 'INTERNAL_ERROR');
