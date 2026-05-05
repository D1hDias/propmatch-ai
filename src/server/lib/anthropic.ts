import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Circuit breaker state (in-process, resets on restart)
// ---------------------------------------------------------------------------

const FAILURE_THRESHOLD = 5;   // open after N consecutive failures
const RECOVERY_TIMEOUT_MS = 60_000; // try again after 1 minute

type CircuitState = 'closed' | 'open' | 'half-open';

let state: CircuitState = 'closed';
let consecutiveFailures = 0;
let openedAt: number | null = null;

function recordSuccess() {
  consecutiveFailures = 0;
  state = 'closed';
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = 'open';
    openedAt = Date.now();
  }
}

function isOpen(): boolean {
  if (state === 'open') {
    if (openedAt && Date.now() - openedAt > RECOVERY_TIMEOUT_MS) {
      state = 'half-open';
      return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Public wrapper
// ---------------------------------------------------------------------------

export interface AnthropicRequestOptions {
  system?: string;
  /** Simple string prompt — convenience wrapper that creates a single user message */
  prompt?: string;
  /** Full messages array — use when you need multi-turn or explicit roles */
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  max_tokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string }>;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function callAnthropic(opts: AnthropicRequestOptions): Promise<AnthropicResponse> {
  const {
    system,
    prompt,
    messages: explicitMessages,
    model = 'claude-sonnet-4-6',
    maxTokens,
    max_tokens,
    timeoutMs = 10_000,
    maxAttempts = 3,
  } = opts;

  const resolvedMaxTokens = maxTokens ?? max_tokens ?? 1024;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
    explicitMessages ?? [{ role: 'user', content: prompt ?? '' }];

  if (isOpen()) {
    throw new Error('Anthropic circuit breaker is open — API temporarily unavailable');
  }

  const start = Date.now();

  try {
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          return await getClient().messages.create(
            {
              model,
              max_tokens: resolvedMaxTokens,
              ...(system ? { system } : {}),
              messages,
            },
            { signal: controller.signal },
          );
        } finally {
          clearTimeout(timer);
        }
      },
      maxAttempts,
      200,
    );

    recordSuccess();

    return {
      content: response.content
        .filter((c) => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: (c as { type: 'text'; text: string }).text })),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    recordFailure();
    throw err;
  }
}
