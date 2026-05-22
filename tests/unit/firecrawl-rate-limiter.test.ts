// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// server-only mocked in setup.ts
// @mendable/firecrawl-js not needed for rate-limiter tests
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { acquireRateLimit } from '@/server/search/firecrawl-client';

describe('acquireRateLimit — rate limiter 5 req/s por hostname', () => {
  it('libera o primeiro token imediatamente (sem espera)', async () => {
    const start = Date.now();
    await acquireRateLimit('https://zapimoveis.com.br/busca?quartos=2');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // deve ser quasi-imediato
  });

  it('hostnames diferentes não compartilham bucket', async () => {
    // Drenar o bucket do host A com 5 chamadas
    const urlA = 'https://vivareal.com.br/busca';
    const urlB = 'https://outro-portal.com.br/busca';

    await Promise.all(Array.from({ length: 5 }, () => acquireRateLimit(urlA)));

    // Host B ainda deve ter tokens disponíveis
    const start = Date.now();
    await acquireRateLimit(urlB);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('respeita o limite de 5 req/s — 7 chamadas demoram >= 150ms', async () => {
    const url = 'https://host-limite-test.com.br/imoveis';
    const start = Date.now();

    // 7 tokens simultâneos: burst=5 esgota imediatamente.
    // Os 2 tokens extras calculam waitMs=200ms cada um mas esperam em paralelo
    // (Promise.all), portanto o tempo total é ~200ms, não 400ms.
    await Promise.all(Array.from({ length: 7 }, () => acquireRateLimit(url)));

    const elapsed = Date.now() - start;
    // Deve ter aguardado ao menos 150ms (prova que o throttle atuou)
    expect(elapsed).toBeGreaterThanOrEqual(150);
    // Mas nunca mais que 500ms (não enfileirou sequencialmente)
    expect(elapsed).toBeLessThan(500);
  }, 5000);

  it('normaliza URL para extrair hostname corretamente', async () => {
    // URLs com path e query string diferentes no mesmo host compartilham bucket
    const start = Date.now();
    await Promise.all([
      acquireRateLimit('https://kenlo-site.com.br/imoveis/a-venda'),
      acquireRateLimit('https://kenlo-site.com.br/imoveis?quartos=3'),
      acquireRateLimit('https://kenlo-site.com.br/'),
    ]);
    // 3 tokens do mesmo host: deve funcionar dentro do burst de 5
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
