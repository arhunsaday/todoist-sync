import pino from 'pino'

/**
 * Single source of truth for valid log levels — `config.ts` validates
 * `LOG_LEVEL` against this same list. Keeping two copies in step by hand does
 * not work: a level the logger accepted but the schema rejected made every
 * sync operation throw, while silencing the very logs that would have said so.
 */
export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

// Read straight from the environment rather than through config.ts: the logger
// is used while reporting configuration errors, so it must not depend on
// configuration being valid.
const level = LOG_LEVELS.find((candidate) => candidate === process.env.LOG_LEVEL)

export const logger = pino({
  level: level ?? 'info',
  // Never let a token reach the logs, however deeply nested.
  redact: {
    paths: [
      'access_token',
      'refresh_token',
      '*.access_token',
      '*.refresh_token',
      'accessToken',
      'refreshToken',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  transport:
    process.stdout.isTTY === true
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
      : undefined,
})
