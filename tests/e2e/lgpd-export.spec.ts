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
        lgpd_consent: true,
      },
    });
    expect(signupRes.status()).toBe(201);
    const { access_token: token } = await signupRes.json() as { access_token: string };

    // Request export
    const exportRes = await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportRes.status()).toBe(202);

    const exportData = await exportRes.json() as { job_id: string; message: string };
    expect(exportData.job_id).toBeTruthy();
    expect(exportData.message).toContain('e-mail');

    // Duplicate request: 409 se o worker ainda não processou, 202 se já completou/falhou.
    // Em dev o worker pode completar muito rápido — qualquer um dos dois é válido.
    const dupRes = await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([202, 409]).toContain(dupRes.status());
  });

  test('GET /api/v1/lgpd/export retorna status do último job', async ({ request }) => {
    const email = `qa8_status_${Date.now()}@test.propmatch.ai`;

    const signupRes = await request.post('/api/v1/auth/signup', {
      data: { name: 'QA Status User', email, password: 'QaTest123!', lgpd_consent: true },
    });
    expect(signupRes.status()).toBe(201);
    const { access_token: token } = await signupRes.json() as { access_token: string };

    // No job yet
    const noneRes = await request.get('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(noneRes.status()).toBe(200);
    const noneData = await noneRes.json() as { status: string };
    expect(noneData.status).toBe('none');

    // Create a job
    await request.post('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Check status — should be requested or in_progress
    const statusRes = await request.get('/api/v1/lgpd/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.status()).toBe(200);
    const statusData = await statusRes.json() as { status: string; job_id: string };
    expect(['requested', 'in_progress', 'completed']).toContain(statusData.status);
    expect(statusData.job_id).toBeTruthy();
  });
});
