import { test, expect } from '@playwright/test';

/**
 * S11-5: E2E — busca com portais pré-selecionados e URL customizada.
 *
 * Cobre:
 * - Toggle de portal (desativar Viva Real, manter ZAP)
 * - Adição de URL customizada
 * - Remoção de URL customizada
 * - Validação de URL inválida
 * - Submissão do briefing com portais e URLs
 */

test.describe('Busca com fontes customizadas', () => {
  test.beforeEach(async ({ page }) => {
    // Assume usuário já autenticado via storage state
    await page.goto('/briefings/new');
    await page.waitForLoadState('networkidle');
  });

  test('portais pré-selecionados aparecem ativos por padrão', async ({ page }) => {
    const zapBtn = page.getByRole('button', { name: /ZAP Imóveis/i });
    const vivarealBtn = page.getByRole('button', { name: /Viva Real/i });

    await expect(zapBtn).toHaveClass(/border-primary/);
    await expect(vivarealBtn).toHaveClass(/border-primary/);
  });

  test('desativar Viva Real remove da seleção', async ({ page }) => {
    const vivarealBtn = page.getByRole('button', { name: /Viva Real/i });

    // Desativar
    await vivarealBtn.click();
    await expect(vivarealBtn).not.toHaveClass(/border-primary/);

    // Reativar
    await vivarealBtn.click();
    await expect(vivarealBtn).toHaveClass(/border-primary/);
  });

  test('bloqueia desativar todos os portais', async ({ page }) => {
    const zapBtn = page.getByRole('button', { name: /ZAP Imóveis/i });
    const vivarealBtn = page.getByRole('button', { name: /Viva Real/i });

    await zapBtn.click();
    await vivarealBtn.click();

    // Mensagem de validação deve aparecer
    await expect(page.getByText('Selecione pelo menos um portal')).toBeVisible();

    // Botão de submit deve estar desabilitado
    await expect(page.getByRole('button', { name: /Analisar briefing/i })).toBeDisabled();
  });

  test('adiciona e remove URL customizada', async ({ page }) => {
    const urlInput = page.getByPlaceholder(/Cole o link de uma imobiliária/i);
    const addBtn = page.getByRole('button', { name: /Adicionar/i });

    // Adicionar URL válida
    await urlInput.fill('https://www.minhaImobiliaria.com.br/imoveis');
    await addBtn.click();

    // Chip deve aparecer com o hostname
    await expect(page.getByText('www.minhaimobiliaria.com.br')).toBeVisible();

    // Input limpo
    await expect(urlInput).toHaveValue('');

    // Remover o chip
    await page.getByRole('button', { name: /Remover/ }).first().click();
    await expect(page.getByText('www.minhaimobiliaria.com.br')).not.toBeVisible();
  });

  test('Enter adiciona URL customizada', async ({ page }) => {
    const urlInput = page.getByPlaceholder(/Cole o link de uma imobiliária/i);

    await urlInput.fill('https://vendas.imobiliaria-exemplo.com.br');
    await urlInput.press('Enter');

    await expect(page.getByText('vendas.imobiliaria-exemplo.com.br')).toBeVisible();
  });

  test('URL inválida não é adicionada', async ({ page }) => {
    const urlInput = page.getByPlaceholder(/Cole o link de uma imobiliária/i);
    const addBtn = page.getByRole('button', { name: /Adicionar/i });

    await urlInput.fill('nao-e-uma-url');
    await addBtn.click();

    // Nenhum chip deve aparecer
    await expect(page.locator('[class*="rounded-full"][class*="bg-secondary"]')).not.toBeVisible();
  });

  test('submissão inclui portais e custom_urls no payload', async ({ page }) => {
    const requests: unknown[] = [];

    page.on('request', (req) => {
      if (req.url().includes('/api/v1/briefings') && req.method() === 'POST') {
        requests.push(JSON.parse(req.postData() ?? '{}'));
      }
    });

    // Desativar Viva Real
    await page.getByRole('button', { name: /Viva Real/i }).click();

    // Adicionar URL customizada
    await page.getByPlaceholder(/Cole o link de uma imobiliária/i).fill('https://exemplo.com.br/imoveis');
    await page.getByRole('button', { name: /Adicionar/i }).click();

    // Preencher texto mínimo
    await page.getByRole('textbox', { name: /Mensagem do cliente/i }).fill(
      'Cliente quer apto 2 quartos em Moema até R$ 900k',
    );

    // Submeter
    await page.getByRole('button', { name: /Analisar briefing/i }).click();

    // Aguardar request
    await page.waitForTimeout(1000);

    const payload = requests[0] as Record<string, unknown> | undefined;
    expect(payload?.portals).toEqual(['zap']);
    expect(payload?.custom_urls).toContain('https://exemplo.com.br/imoveis');
  });
});
