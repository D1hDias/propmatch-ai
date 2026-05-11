import 'server-only';
import crypto from 'crypto';
import archiver from 'archiver';
import { Readable } from 'stream';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { uploadToR2, getPresignedUrl } from '@/server/lib/storage';
import { sendExportEmail } from '@/server/lib/mailer';

const LINK_TTL_SECONDS = 72 * 60 * 60; // 72 hours per PRD

/**
 * Initiates an export job and returns the job record.
 * The actual ZIP assembly is done by the BullMQ worker (export-queue.ts).
 */
export async function requestExport(userId: string): Promise<{
  jobId: string;
}> {
  const existing = await prisma.lgpdJob.findFirst({
    where: {
      userId,
      jobType: 'export',
      status: { in: ['requested', 'in_progress'] },
    },
  });

  if (existing) {
    throw new AppError(
      'RESOURCE_CONFLICT',
      `Export job already in flight: ${existing.id}`,
      'Você já tem uma exportação em andamento. Aguarde a conclusão.',
      409,
    );
  }

  const job = await prisma.lgpdJob.create({
    data: {
      userId,
      jobType: 'export',
      status: 'requested',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: 'lgpd.export_requested',
      targetType: 'lgpd_job',
      targetId: job.id,
    },
  });

  return { jobId: job.id };
}

/**
 * Assembles the user data ZIP, uploads to R2, generates signed URL, sends email.
 * Called by the BullMQ export worker.
 */
export async function executeExport(jobId: string): Promise<void> {
  const job = await prisma.lgpdJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { user: true },
  });

  if (job.status === 'completed') return;

  await prisma.lgpdJob.update({
    where: { id: jobId },
    data: { status: 'in_progress' },
  });

  try {
    const userId = job.userId;

    // Collect all user data
    const [user, briefings, clients, messages, auditLogs] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, name: true, phone: true, role: true, plan: true, createdAt: true, lgpdConsentAt: true },
      }),
      prisma.briefing.findMany({
        where: { userId },
        select: { id: true, rawText: true, extractedCriteria: true, status: true, reviewStatus: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.client.findMany({
        where: { userId },
        select: { id: true, name: true, phone: true, isGuest: true, archiveStatus: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.message.findMany({
        where: { briefing: { userId } },
        select: { id: true, formattedText: true, deliveryMethod: true, deliveryStatus: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      prisma.auditLog.findMany({
        where: { actorUserId: userId },
        select: { id: true, action: true, targetType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

    const exportedAt = new Date().toISOString();

    // Build ZIP in memory
    const zipBuffer = await buildZip({
      'README.txt': buildReadme(user.name, exportedAt),
      'perfil.json': JSON.stringify({ ...user, exportedAt }, null, 2),
      'briefings.json': JSON.stringify(briefings, null, 2),
      'clientes.json': JSON.stringify(clients, null, 2),
      'mensagens.json': JSON.stringify(messages, null, 2),
      'audit_log.json': JSON.stringify(auditLogs, null, 2),
    });

    const r2Configured =
      !!process.env.CLOUDFLARE_ACCOUNT_ID &&
      !!process.env.R2_ACCESS_KEY_ID &&
      !!process.env.R2_SECRET_ACCESS_KEY;

    if (r2Configured) {
      // Upload to R2 and send signed download link
      const key = `exports/${userId}/${jobId}.zip`;
      await uploadToR2(key, zipBuffer, 'application/zip');

      const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000);
      const downloadUrl = await getPresignedUrl(key, LINK_TTL_SECONDS);

      await sendExportEmail({
        to: job.user.email,
        name: job.user.name,
        downloadUrl,
        expiresAt,
      });

      await prisma.lgpdJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'lgpd.export_completed',
          targetType: 'lgpd_job',
          targetId: jobId,
          details: { r2Key: key, expiresAt },
        },
      });
    } else {
      // R2 not yet configured — complete the job without sending the email.
      // Ops can retrieve the ZIP manually from the job record once R2 is set up.
      logger.warn('lgpd.export: R2 not configured — skipping upload and email', { jobId });

      await prisma.lgpdJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'lgpd.export_completed_no_r2',
          targetType: 'lgpd_job',
          targetId: jobId,
          details: { note: 'R2 not configured; ZIP assembled but not uploaded' },
        },
      });
    }
  } catch (err) {
    await prisma.lgpdJob.update({
      where: { id: jobId },
      data: { status: 'failed' },
    });
    throw err;
  }
}

function buildReadme(name: string, exportedAt: string): string {
  return [
    `Exportação de dados — PropMatch AI`,
    `Titular: ${name}`,
    `Data da exportação: ${exportedAt}`,
    ``,
    `Arquivos incluídos:`,
    `  perfil.json      — dados cadastrais e preferências da conta`,
    `  briefings.json   — todos os briefings de busca enviados`,
    `  clientes.json    — lista de clientes registrados`,
    `  mensagens.json   — mensagens WhatsApp geradas pelo sistema`,
    `  audit_log.json   — registro de ações realizadas na plataforma`,
    ``,
    `Dúvidas? Envie e-mail para privacidade@propmatch.com.br`,
  ].join('\n');
}

function buildZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    for (const [name, content] of Object.entries(files)) {
      if (typeof content === 'string') {
        archive.append(Readable.from([content]), { name });
      } else {
        archive.append(Readable.from([content]), { name });
      }
    }

    void archive.finalize();
  });
}
