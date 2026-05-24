// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before any dynamic imports of the module under test)
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
const mockCount = vi.fn();
const mockUpdate = vi.fn();
const mockFindMany = vi.fn();

vi.mock('@/server/db/client', () => ({
  withRlsContext: vi.fn(
    async (_userId: string, _role: string, fn: (tx: unknown) => Promise<unknown>) => fn({
      briefing: {
        findFirst: mockFindFirst,
        count: mockCount,
        update: mockUpdate,
      },
    }),
  ),
  prisma: {
    partnerSite: { findMany: mockFindMany },
  },
}));

const mockEnqueueSiteSync = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/partners/sync-queue', () => ({
  enqueueSiteSync: mockEnqueueSiteSync,
}));

const mockSearchQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('@/server/search/queue', () => ({
  searchQueue: { add: mockSearchQueueAdd },
}));

vi.mock('@/server/auth/context', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    sub: 'user-123',
    role: 'broker',
    plan: 'pro',
  }),
}));

vi.mock('@/server/briefings/criteria-transform', () => ({
  toSearchCriteria: vi.fn().mockReturnValue({ city: 'São Paulo', purpose: 'buy' }),
}));

vi.mock('@/server/lib/response', () => ({
  apiSuccess: vi.fn((data: unknown, status: number) =>
    new Response(JSON.stringify(data), { status }),
  ),
  apiError: vi.fn((err: unknown) => {
    const status = (err instanceof Error && 'statusCode' in err)
      ? (err as { statusCode: number }).statusCode
      : 500;
    return new Response(JSON.stringify({ error: String(err) }), { status });
  }),
}));

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are in place)
// ---------------------------------------------------------------------------

const { POST } = await import('@/app/api/v1/briefings/[id]/search/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(briefingId: string) {
  return new Request(`http://localhost/api/v1/briefings/${briefingId}/search`, {
    method: 'POST',
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const baseBriefing = {
  id: 'briefing-1',
  userId: 'user-123',
  status: 'ready',
  extractedCriteria: { intent: 'buy', hard_filters: {}, location: {} },
  selectedPortals: [] as string[],
  customUrls: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/briefings/[id]/search — auto-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(baseBriefing);
    mockCount.mockResolvedValue(0);
    mockUpdate.mockResolvedValue({});
    mockFindMany.mockResolvedValue([]);
  });

  it('retorna 202 com jobId quando briefing é válido', async () => {
    const res = await POST(makeRequest('briefing-1'), makeParams('briefing-1'));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toBe('job-1');
  });

  it('não chama enqueueSiteSync quando não há portais selecionados', async () => {
    mockFindFirst.mockResolvedValue({ ...baseBriefing, selectedPortals: [] });
    await POST(makeRequest('briefing-1'), makeParams('briefing-1'));
    expect(mockEnqueueSiteSync).not.toHaveBeenCalled();
  });

  it('não chama enqueueSiteSync quando todos os portais já têm estoque indexado', async () => {
    mockFindFirst.mockResolvedValue({
      ...baseBriefing,
      selectedPortals: ['site-a', 'site-b'],
    });
    // findMany retorna vazio → nenhum site sem indexação
    mockFindMany.mockResolvedValue([]);

    await POST(makeRequest('briefing-1'), makeParams('briefing-1'));
    expect(mockEnqueueSiteSync).not.toHaveBeenCalled();
  });

  it('chama enqueueSiteSync para cada site sem estoque indexado', async () => {
    mockFindFirst.mockResolvedValue({
      ...baseBriefing,
      selectedPortals: ['site-a', 'site-b', 'site-c'],
    });
    mockFindMany.mockResolvedValue([
      { id: 'site-a', domain: 'imobiliaria-a.com.br' },
      { id: 'site-b', domain: 'imobiliaria-b.com.br' },
    ]);

    await POST(makeRequest('briefing-1'), makeParams('briefing-1'));

    expect(mockEnqueueSiteSync).toHaveBeenCalledTimes(2);
    expect(mockEnqueueSiteSync).toHaveBeenCalledWith('site-a');
    expect(mockEnqueueSiteSync).toHaveBeenCalledWith('site-b');
    expect(mockEnqueueSiteSync).not.toHaveBeenCalledWith('site-c');
  });

  it('a query de findMany usa os filtros corretos (listingCount=0, não rodando, sem falhas excessivas)', async () => {
    mockFindFirst.mockResolvedValue({
      ...baseBriefing,
      selectedPortals: ['site-x'],
    });
    mockFindMany.mockResolvedValue([]);

    await POST(makeRequest('briefing-1'), makeParams('briefing-1'));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listingCount: 0,
          syncStatus: { not: 'running' },
          consecutiveFailures: { lt: 5 },
          active: true,
        }),
      }),
    );
  });

  it('retorna 404 quando briefing não existe', async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest('nao-existe'), makeParams('nao-existe'));
    expect(res.status).toBe(404);
  });

  it('retorna 422 quando briefing não tem extractedCriteria', async () => {
    mockFindFirst.mockResolvedValue({ ...baseBriefing, extractedCriteria: null });
    const res = await POST(makeRequest('briefing-1'), makeParams('briefing-1'));
    expect(res.status).toBe(422);
  });

  it('retorna 429 quando limite de concorrência é atingido', async () => {
    mockCount.mockResolvedValue(10); // pro limit = 10, já há 10 ativos
    const res = await POST(makeRequest('briefing-1'), makeParams('briefing-1'));
    expect(res.status).toBe(429);
  });
});
