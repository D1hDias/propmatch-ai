import 'server-only';
import { Resend } from 'resend';

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  return new Resend(key);
}

const FROM = process.env.EMAIL_FROM ?? 'PropMatch AI <noreply@propmatch.com.br>';

export interface SendExportEmailParams {
  to: string;
  name: string;
  downloadUrl: string;
  expiresAt: Date;
}

export async function sendExportEmail({
  to,
  name,
  downloadUrl,
  expiresAt,
}: SendExportEmailParams): Promise<void> {
  const resend = getResend();
  const expiresFormatted = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(expiresAt);

  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Seus dados do PropMatch AI estão prontos para download',
    html: `
      <p>Olá, ${name}!</p>
      <p>Sua solicitação de exportação de dados (LGPD) foi processada com sucesso.</p>
      <p>
        <a href="${downloadUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">
          Baixar meus dados
        </a>
      </p>
      <p style="color:#6b7280;font-size:14px;">
        Este link expira em <strong>${expiresFormatted}</strong>.<br/>
        Se você não solicitou a exportação, entre em contato com nosso suporte.
      </p>
      <p style="color:#6b7280;font-size:12px;">PropMatch AI — LGPD Data Export</p>
    `,
  });
}
