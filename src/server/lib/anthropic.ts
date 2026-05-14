import 'server-only';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Circuit breaker state (in-process, resets on restart)
// ---------------------------------------------------------------------------

const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 60_000;

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
// Public interface (unchanged — callers don't need to be updated)
// ---------------------------------------------------------------------------

export interface AnthropicRequestOptions {
  system?: string;
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** OpenRouter model string, e.g. "anthropic/claude-haiku-4-5" or "google/gemini-flash-1.5" */
  model?: string;
  maxTokens?: number;
  max_tokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** When true, instructs the model to respond with valid JSON only (json_object mode). */
  jsonMode?: boolean;
}

export interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string }>;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is not set');
    _client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'PropMatch AI',
      },
    });
  }
  return _client;
}

// Default model — barato e rápido para extração/parsing
const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';

export async function callAnthropic(opts: AnthropicRequestOptions): Promise<AnthropicResponse> {
  const {
    system,
    prompt,
    messages: explicitMessages,
    model = DEFAULT_MODEL,
    maxTokens,
    max_tokens,
    timeoutMs = 15_000,
    maxAttempts = 3,
    jsonMode = false,
  } = opts;

  const resolvedMaxTokens = maxTokens ?? max_tokens ?? 1024;

  const userMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
    explicitMessages?.map((m) => ({ role: m.role, content: m.content })) ??
    [{ role: 'user', content: prompt ?? '' }];

  const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = system
    ? [{ role: 'system', content: system }, ...userMessages]
    : userMessages;

  if (isOpen()) {
    throw new Error('LLM circuit breaker is open — API temporarily unavailable');
  }

  const start = Date.now();

  try {
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          return await getClient().chat.completions.create(
            {
              model,
              max_tokens: resolvedMaxTokens,
              messages: allMessages,
              ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
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

    const text = response.choices[0]?.message?.content ?? '';
    return {
      content: [{ type: 'text', text }],
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    recordFailure();
    throw err;
  }
}
