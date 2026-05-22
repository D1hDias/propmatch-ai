import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { makeUser } from '../factories/user';

// ---------------------------------------------------------------------------
// Helper — cria usuário e autentica via signup flow, retorna contexto com sessão
// ---------------------------------------------------------------------------

async function signupAndGetContext(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  const user = makeUser();

  await page.goto('/signup');
  await page.getByLabel(/nome completo/i).fill(user.name);
  await page.getByLabel(/e-mail/i).fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByLabel(/li e aceito|lgpd|termos/i).check();
  await page.getByRole('button', { name: /criar conta grátis/i }).click();

  // Aguarda redirect para dashboard após signup
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Testes das páginas novas (S8/FE-18)
// ---------------------------------------------------------------------------

test.describe('Páginas autenticadas — S8/FE-18', () => {
  test.beforeEach(async ({ page, context }) => {
    await signupAndGetContext(context, page);
  });

  // -------------------------------------------------------------------------
  // /historico
  // -------------------------------------------------------------------------
  test.describe('/historico', () => {
    test('carrega com título correto', async ({ page }) => {
      await page.goto('/historico');
      await expect(page.getByRole('heading', { name: /histórico de briefings/i })).toBeVisible();
    });

    test('exibe EmptyState quando não há briefings', async ({ page }) => {
      await page.goto('/historico');
      // Novo usuário não tem briefings — EmptyState heading deve aparecer
      await expect(page.getByRole('heading', { name: /nenhum briefing ainda/i })).toBeVisible({ timeout: 5000 });
    });

    test('botão "Nova busca" aponta para /busca', async ({ page }) => {
      await page.goto('/historico');
      // Seleciona o botão na página (não o link da sidebar)
      const btn = page.getByRole('link', { name: 'Nova busca', exact: true }).last();
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('href', /\/busca/);
    });

    test('não tem erros JS', async ({ page }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (err) => jsErrors.push(err.message));
      await page.goto('/historico');
      await page.waitForLoadState('networkidle');
      expect(jsErrors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // /briefings (workspace)
  // -------------------------------------------------------------------------
  test.describe('/briefings', () => {
    test('carrega sem erros JS', async ({ page }) => {
      const jsErrors: string[] = [];
      // Filtrar erros transientes do dev server (middleware-manifest) que não afetam a app
      page.on('pageerror', (err) => {
        if (!err.message.includes('middleware-manifest')) jsErrors.push(err.message);
      });
      await page.goto('/briefings');
      await page.waitForLoadState('networkidle');
      expect(jsErrors).toHaveLength(0);
    });

    test('exibe EmptyState ou card de Nova Busca quando sem briefings ativos', async ({ page }) => {
      await page.goto('/briefings');
      // Quick-start card sempre visível em /briefings
      await expect(page.getByRole('heading', { name: /iniciar nova busca/i })).toBeVisible({ timeout: 5000 });
    });
  });

  // -------------------------------------------------------------------------
  // /mensagens
  // -------------------------------------------------------------------------
  test.describe('/mensagens', () => {
    test('carrega com EmptyState quando sem mensagens', async ({ page }) => {
      await page.goto('/mensagens');
      // EmptyState heading quando não há mensagens
      await expect(page.getByRole('heading', { name: /nenhuma mensagem ainda/i })).toBeVisible({
        timeout: 5000,
      });
    });

    test('não tem erros JS', async ({ page }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (err) => jsErrors.push(err.message));
      await page.goto('/mensagens');
      await page.waitForLoadState('networkidle');
      expect(jsErrors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Toast system — verifica que sonner está funcionando
// ---------------------------------------------------------------------------

test.describe('Toast system (sonner)', () => {
  test('toast de erro aparece quando fetch de /historico falha', async ({ page, context }) => {
    await signupAndGetContext(context, page);

    // Interceptar a chamada à API de briefings e forçar erro
    await page.route('**/api/v1/briefings**', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) }),
    );

    await page.goto('/historico');

    // O toast de erro deve aparecer
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({
      timeout: 5000,
    });
  });
});

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

test.describe('GET /api/v1/internal/health', () => {
  test('retorna 200 com db:up', async ({ request }) => {
    const res = await request.get('/api/v1/internal/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
  });

  test('inclui status do firecrawl no response', async ({ request }) => {
    const res = await request.get('/api/v1/internal/health');
    const body = await res.json();
    // firecrawl pode ser "up" ou "degraded" — ambos são válidos em dev
    expect(['up', 'degraded']).toContain(body.firecrawl);
  });
});
