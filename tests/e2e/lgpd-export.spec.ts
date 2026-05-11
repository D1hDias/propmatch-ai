import { test, expect } from '@playwright/test';

// QA-8: LGPD export — usuário solicita exportação e recebe confirmação.
// Full ZIP/email validation requires a live environment with R2 + Resend configured.
// This test validates the API contract and status polling.

test.describe('LGPD export', () => {
  test('POST /api/v1/lgpd/export cria job e retorna 202', async ({ request }) => {
    const email = `qa8_export_${Date.now()}@test.propmatch.ai`;

    const signupRes = await request.post('/api/v1/auth/signup', {
      data: {
        name: 'QA Export User',
        email,
        password: 'QaTest123!',
        lgpdConsent: true,
      },
    });
    expect(signupRes.status()).toBe(201);
    const { data } = await signupRes.json() as { data: { accessToken: string } };
    const token = data.accessToken;

    // Request export
    const exportRes = await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportRes.status()).toBe(202);

    const exportData = await exportRes.json() as { data: { job_id: string; message: string } };
    expect(exportData.data.job_id).toBeTruthy();
    expect(exportData.data.message).toContain('e-mail');

    // Duplicate request should return 409
    const dupRes = await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(dupRes.status()).toBe(409);
    const dupData = await dupRes.json() as { error: { code: string } };
    expect(dupData.error.code).toBe('RESOURCE_CONFLICT');
  });

  test('GET /api/v1/lgpd/export retorna status do último job', async ({ request }) => {
    const email = `qa8_status_${Date.now()}@test.propmatch.ai`;

    const signupRes = await request.post('/api/v1/auth/signup', {
      data: { name: 'QA Status User', email, password: 'QaTest123!', lgpdConsent: true },
    });
    expect(signupRes.status()).toBe(201);
    const { data } = await signupRes.json() as { data: { accessToken: string } };
    const token = data.accessToken;

    // No job yet
    const noneRes = await request.get('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(noneRes.status()).toBe(200);
    const noneData = await noneRes.json() as { data: { status: string } };
    expect(noneData.data.status).toBe('none');

    // Create a job
    await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Check status — should be requested or in_progress
    const statusRes = await request.get('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.status()).toBe(200);
    const statusData = await statusRes.json() as { data: { status: string; job_id: string } };
    expect(['requested', 'in_progress', 'completed']).toContain(statusData.data.status);
    expect(statusData.data.job_id).toBeTruthy();
  });
});
