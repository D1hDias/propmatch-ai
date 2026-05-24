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
// Public interface
// ---------------------------------------------------------------------------

export interface LLMRequestOptions {
  system?: string;
  prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** OpenRouter model ID — see src/server/lib/models.ts for the full registry. */
  model: string;
  maxTokens?: number;
  max_tokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /**
   * JSON Schema object for structured output (OpenRouter json_schema mode).
   * When provided, takes precedence over jsonMode.
   * The model will strictly follow this schema — no prefix text, no markdown.
   */
  responseSchema?: object;
  /** When true, instructs the model to respond with valid JSON only (json_object mode). */
  jsonMode?: boolean;
  /**
   * Maximum price per million tokens. Requests only route to providers within budget.
   * Prevents silent cost spikes when a cheap model is temporarily served by a pricier provider.
   */
  maxPrice?: { prompt: number; completion: number };
  /**
   * Fallback model chain (OpenRouter native). When the primary model or its provider fails,
   * OpenRouter tries each model in order without incurring the latency of a failed attempt.
   * Use for provider-level resilience, not quality fallback (quality fallback stays in app code).
   */
  fallbackModels?: string[];
}

export interface LLMResponse {
  content: Array<{ type: 'text'; text: string }>;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from cache (Gemini implicit / Anthropic explicit). 0 when not cached. */
  cachedInputTokens: number;
  durationMs: number;
  /** The model ID that was actually used (for logging). */
  model: string;
}

// ---------------------------------------------------------------------------
// Backwards-compat aliases (callers using the old interface names still compile)
// ---------------------------------------------------------------------------
export type AnthropicRequestOptions = LLMRequestOptions;
export type AnthropicResponse = LLMResponse;

// ---------------------------------------------------------------------------
// OpenRouter client (singleton)
// ---------------------------------------------------------------------------

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

export async function callLLM(opts: LLMRequestOptions): Promise<LLMResponse> {
  const {
    system,
    prompt,
    messages: explicitMessages,
    model,
    maxTokens,
    max_tokens,
    timeoutMs = 15_000,
    maxAttempts = 3,
    responseSchema,
    jsonMode = false,
    maxPrice,
    fallbackModels,
  } = opts;

  const resolvedMaxTokens = maxTokens ?? max_tokens ?? 1024;

  const userMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
    explicitMessages?.map((m) => ({ role: m.role, content: m.content })) ??
    [{ role: 'user', content: prompt ?? '' }];

  const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = system
    ? [{ role: 'system', content: system }, ...userMessages]
    : userMessages;

  // Determine response_format: json_schema > json_object > none
  let responseFormat: OpenAI.Chat.ChatCompletionCreateParams['response_format'];
  if (responseSchema) {
    responseFormat = {
      type: 'json_schema' as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json_schema: { name: 'output', strict: true, schema: responseSchema } as any,
    };
  } else if (jsonMode) {
    responseFormat = { type: 'json_object' as const };
  }

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const modelParam: any = fallbackModels?.length
            ? { models: [model, ...fallbackModels], route: 'fallback' }
            : { model };

          return await getClient().chat.completions.create(
            {
              ...modelParam,
              max_tokens: resolvedMaxTokens,
              messages: allMessages,
              ...(responseFormat ? { response_format: responseFormat } : {}),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(maxPrice ? { provider: { max_price: maxPrice } } as any : {}),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = response.usage as any;
    return {
      content: [{ type: 'text', text }],
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      durationMs: Date.now() - start,
      model,
    };
  } catch (err) {
    recordFailure();
    throw err;
  }
}
