// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// flags.ts uses 'server-only' — mocked in setup.ts
// We reload the module between tests to pick up changed env vars.

function loadFlags() {
  return import('@/server/lib/flags');
}

describe('isSource2Enabled()', () => {
  const original = {
    ENABLE_SOURCE_2: process.env.ENABLE_SOURCE_2,
    FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  };

  afterEach(() => {
    process.env.ENABLE_SOURCE_2 = original.ENABLE_SOURCE_2;
    process.env.FIRECRAWL_API_KEY = original.FIRECRAWL_API_KEY;
  });

  it('retorna false quando ENABLE_SOURCE_2=false', async () => {
    process.env.ENABLE_SOURCE_2 = 'false';
    delete process.env.FIRECRAWL_API_KEY;
    const { isSource2Enabled } = await loadFlags();
    expect(isSource2Enabled()).toBe(false);
  });

  it('retorna false quando ENABLE_SOURCE_2=0', async () => {
    process.env.ENABLE_SOURCE_2 = '0';
    const { isSource2Enabled } = await loadFlags();
    expect(isSource2Enabled()).toBe(false);
  });

  it('retorna true quando ENABLE_SOURCE_2=true', async () => {
    process.env.ENABLE_SOURCE_2 = 'true';
    const { isSource2Enabled } = await loadFlags();
    expect(isSource2Enabled()).toBe(true);
  });

  it('auto-ativa quando FIRECRAWL_API_KEY está definido e flag não está setada', async () => {
    delete process.env.ENABLE_SOURCE_2;
    process.env.FIRECRAWL_API_KEY = 'test-key';
    const { isSource2Enabled } = await loadFlags();
    expect(isSource2Enabled()).toBe(true);
  });

  it('retorna false quando nem flag nem FIRECRAWL_API_KEY estão definidos', async () => {
    delete process.env.ENABLE_SOURCE_2;
    delete process.env.FIRECRAWL_API_KEY;
    const { isSource2Enabled } = await loadFlags();
    expect(isSource2Enabled()).toBe(false);
  });
});

describe('isSource3Enabled()', () => {
  const original = process.env.ENABLE_SOURCE_3;

  afterEach(() => {
    process.env.ENABLE_SOURCE_3 = original;
  });

  it('retorna false por padrão (flag não setada)', async () => {
    delete process.env.ENABLE_SOURCE_3;
    const { isSource3Enabled } = await loadFlags();
    expect(isSource3Enabled()).toBe(false);
  });

  it('retorna false quando ENABLE_SOURCE_3=false', async () => {
    process.env.ENABLE_SOURCE_3 = 'false';
    const { isSource3Enabled } = await loadFlags();
    expect(isSource3Enabled()).toBe(false);
  });

  it('retorna true quando ENABLE_SOURCE_3=true', async () => {
    process.env.ENABLE_SOURCE_3 = 'true';
    const { isSource3Enabled } = await loadFlags();
    expect(isSource3Enabled()).toBe(true);
  });

  it('retorna true quando ENABLE_SOURCE_3=1', async () => {
    process.env.ENABLE_SOURCE_3 = '1';
    const { isSource3Enabled } = await loadFlags();
    expect(isSource3Enabled()).toBe(true);
  });
});
