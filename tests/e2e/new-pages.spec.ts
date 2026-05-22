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
  await page.getByRole('textbox', { name: /nome/i }).fill(user.name);
  await page.getByRole('textbox', { name: /e-mail/i }).fill(user.email);
  await page.getByRole('textbox', { name: /telefone/i }).fill(user.phone);
  await page.getByRole('textbox', { name: /senha/i }).fill(user.password);
  const consentCheck = page.getByRole('checkbox', { name: /concordo|lgpd|termos/i });
  if (await consentCheck.isVisible()) await consentCheck.check();
  await page.getByRole('button', { name: /criar conta|cadastrar/i }).click();

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
      // Novo usuário não tem briefings — EmptyState deve aparecer
      await expect(page.getByText(/nenhum briefing ainda|nenhuma busca/i)).toBeVisible({ timeout: 5000 });
    });

    test('botão "Nova busca" aponta para /busca', async ({ page }) => {
      await page.goto('/historico');
      const btn = page.getByRole('link', { name: /nova busca/i });
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
      page.on('pageerror', (err) => jsErrors.push(err.message));
      await page.goto('/briefings');
      await page.waitForLoadState('networkidle');
      expect(jsErrors).toHaveLength(0);
    });

    test('exibe EmptyState ou card de Nova Busca quando sem briefings ativos', async ({ page }) => {
      await page.goto('/briefings');
      // Deve mostrar o card de quick-start OU o EmptyState
      const hasQuickStart = await page.getByText(/nova busca|iniciar busca/i).isVisible().catch(() => false);
      const hasEmpty = await page.getByText(/nenhum briefing|sem buscas ativas/i).isVisible().catch(() => false);
      expect(hasQuickStart || hasEmpty).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // /mensagens
  // -------------------------------------------------------------------------
  test.describe('/mensagens', () => {
    test('carrega com EmptyState quando sem mensagens', async ({ page }) => {
      await page.goto('/mensagens');
      await expect(page.getByText(/nenhuma mensagem|histórico vazio|ainda não enviou/i)).toBeVisible({
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
    expect(body.data?.ok).toBe(true);
    expect(body.data?.db).toBe('up');
  });

  test('inclui status do firecrawl no response', async ({ request }) => {
    const res = await request.get('/api/v1/internal/health');
    const body = await res.json();
    // firecrawl pode ser "up" ou "degraded" — ambos são válidos em dev
    expect(['up', 'degraded']).toContain(body.data?.firecrawl);
  });
});
