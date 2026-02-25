import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export function createLogger(level = 'info') {
  return pino({
    level,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
