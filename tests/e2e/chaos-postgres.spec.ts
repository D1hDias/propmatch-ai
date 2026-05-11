import { test, expect } from '@playwright/test';

/**
 * QA-10 — Caos engineering: validar comportamento quando Postgres está indisponível.
 *
 * PRÉ-REQUISITO: rodar em staging com Postgres parado manualmente:
 *   sudo systemctl stop postgresql
 *
 * O objetivo é verificar que o app retorna erros amigáveis (não 500 com stack trace)
 * e que o frontend mostra mensagem de erro tratada, não tela branca.
 *
 * Para rodar localmente:
 *   docker compose -f infra/docker-compose.dev.yml stop db
 *   BASE_URL=http://localhost:3000 pnpm exec playwright test chaos-postgres
 *   docker compose -f infra/docker-compose.dev.yml start db
 */

test.describe('Chaos — Postgres indisponível', () => {
  test('POST /api/v1/auth/login retorna erro amigável sem stack trace', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'test@example.com', password: 'password123' },
    });

    // Deve retornar 503 ou 500 — nunca 200
    expect(res.status()).toBeGreaterThanOrEqual(500);

    const body = await res.json().catch(() => null);

    // Não deve expor stack trace ou mensagem interna
    const raw = JSON.stringify(body ?? '');
    expect(raw).not.toContain('at Object.');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('PrismaClient');

    // Deve ter estrutura de erro da API
    if (body) {
      expect(body).toHaveProperty('error');
    }
  });

  test('GET /api/v1/briefings retorna erro tratado', async ({ request }) => {
    // Tenta autenticar primeiro (vai falhar também, mas verifica o shape do erro)
    const res = await request.get('/api/v1/briefings', {
      headers: { Authorization: 'Bearer fake-token-for-chaos-test' },
    });

    // 401 (token inválido sem DB) ou 500/503 (DB down antes do auth check)
    expect([401, 500, 503]).toContain(res.status());

    const body = await res.json().catch(() => null);
    if (body) {
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('at Object.');
      expect(raw).not.toContain('node_modules');
    }
  });

  test('Página /login não mostra tela branca com DB indisponível', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    // A página de login é estática (não precisa de DB para renderizar)
    await page.goto('/login');

    // Deve renderizar o formulário mesmo sem DB
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible({ timeout: 10000 });

    // Sem erros JS críticos
    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('hydration') && !e.includes('ResizeObserver'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
