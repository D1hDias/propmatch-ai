import 'server-only';
import * as Sentry from '@sentry/nextjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const BETTERSTACK_TOKEN = process.env.BETTERSTACK_SOURCE_TOKEN;
const BETTERSTACK_URL = 'https://in.logs.betterstack.com';

async function sendToBetterStack(entry: LogEntry): Promise<void> {
  if (!BETTERSTACK_TOKEN) return;
  try {
    await fetch(BETTERSTACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BETTERSTACK_TOKEN}`,
      },
      body: JSON.stringify({ ...entry, dt: new Date().toISOString(), service: 'propmatch' }),
    });
  } catch {
    // Never let logging failures break the request
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = { level, message, ...context };

  if (process.env.NODE_ENV !== 'test') {
    if (level === 'error') console.error(JSON.stringify(entry));
    else console.warn(JSON.stringify(entry));
    void sendToBetterStack(entry);
  }
}

export const logger = {
  debug: (message: string, ctx?: Record<string, unknown>) => log('debug', message, ctx),
  info: (message: string, ctx?: Record<string, unknown>) => log('info', message, ctx),
  warn: (message: string, ctx?: Record<string, unknown>) => log('warn', message, ctx),
  error: (message: string, ctx?: Record<string, unknown>) => {
    log('error', message, ctx);
    if (ctx?.error instanceof Error) {
      Sentry.captureException(ctx.error, { extra: ctx });
    }
  },
};
