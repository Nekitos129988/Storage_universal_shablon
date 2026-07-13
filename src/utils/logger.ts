/**
 * Структурированный логгер на pino.
 *
 * В production — JSON в stdout (для сбора лог-агрегаторами). В development —
 * человекочитаемый pretty-вывод через транспорт pino-pretty.
 */
import pino from 'pino';
import { config } from '../config.ts';

export const logger = pino({
	level: config.isProd ? 'info' : 'debug',
	base: { app: 'inventory' },
	...(config.isProd
		? {}
		: {
				transport: {
					target: 'pino-pretty',
					options: { translateTime: 'SYS:HH:MM:ss.l', colorize: true, ignore: 'pid,hostname' },
				},
			}),
});
