import { test, expect } from '@playwright/test';

// QA-1 AC-3: smoke test — verifica que o frontend renderiza corretamente.
test.describe('Smoke — páginas públicas', () => {
  test('homepage redireciona para /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('página /login carrega sem erros JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/login');

    // Formulário de login presente
    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();

    expect(jsErrors).toHaveLength(0);
  });

  test('título da página está correto', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/PropMatch AI/i);
  });
});
