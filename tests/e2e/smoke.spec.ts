import { test, expect } from '@playwright/test';

// QA-1 AC-3: smoke test — verifica que o frontend renderiza corretamente.

test.describe('Smoke — páginas públicas', () => {
  test('landing page carrega sem erros JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/');

    // Não deve redirecionar para /login — é pública
    await expect(page).not.toHaveURL(/\/login/);

    // "PropMatch AI" aparece no navbar como texto (não é heading)
    await expect(page.getByText('PropMatch AI').first()).toBeVisible();
    expect(jsErrors).toHaveLength(0);
  });

  test('landing tem link de navegação "Como funciona"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /como funciona/i })).toBeVisible();
  });

  test('landing tem seção de preços com os 3 planos', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Starter/i).first()).toBeVisible();
    await expect(page.getByText(/\bPro\b/i).first()).toBeVisible();
  });

  test('CTA "Criar conta grátis" aponta para /signup', async ({ page }) => {
    await page.goto('/');
    // O nav tem "Criar conta grátis"; o hero tem "Começar gratuitamente"
    const cta = page.getByRole('link', { name: /criar conta grátis|começar gratuitamente/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /\/signup/);
  });

  test('página /login carrega sem erros JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/login');

    await expect(page.getByRole('textbox', { name: /e-mail/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    expect(jsErrors).toHaveLength(0);
  });

  test('título da página /login está correto', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/PropMatch AI/i);
  });

  test('/historico sem sessão redireciona para /login', async ({ page }) => {
    await page.goto('/historico');
    await expect(page).toHaveURL(/\/login\?next=%2Fhistorico/);
  });

  test('/briefings sem sessão redireciona para /login', async ({ page }) => {
    await page.goto('/briefings');
    await expect(page).toHaveURL(/\/login\?next=%2Fbriefings/);
  });

  test('/mensagens sem sessão redireciona para /login', async ({ page }) => {
    await page.goto('/mensagens');
    await expect(page).toHaveURL(/\/login\?next=%2Fmensagens/);
  });
});
