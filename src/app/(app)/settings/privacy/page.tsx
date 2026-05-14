'use client';

import { useState, useEffect } from 'react';
import { Shield, Download, Trash2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-fetch';

interface ExportStatus {
  status: 'none' | 'requested' | 'in_progress' | 'completed' | 'failed';
  job_id?: string;
  requested_at?: string;
  completed_at?: string;
}

export default function PrivacyPage() {
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      const res = await apiFetch('/api/v1/lgpd/export', {
      });
      if (res.ok) {
        const data = await res.json() as { data: ExportStatus };
        setExportStatus(data.data);
      }
    }
    void fetchStatus();
  }, []);

  async function requestExport() {
    setExportLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/v1/lgpd/export', {
        method: 'POST',
      });
      const data = await res.json() as { data: { job_id: string; message: string } };
      if (res.ok) {
        setExportStatus({ status: 'requested', job_id: data.data.job_id });
        setMessage({ type: 'success', text: data.data.message });
      } else {
        throw new Error((data as unknown as { error: { userMessage: string } }).error.userMessage);
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erro ao solicitar exportação.' });
    } finally {
      setExportLoading(false);
    }
  }

  async function requestDeletion() {
    setDeleteLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/v1/lgpd/delete', {
        method: 'POST',
      });
      const data = await res.json() as {
        data: { cancellation_token: string; grace_period_ends_at: string; message: string };
        error?: { userMessage: string };
      };
      if (res.ok) {
        setDeleteToken(data.data.cancellation_token);
        setDeleteConfirm(false);
        setMessage({ type: 'success', text: data.data.message });
      } else {
        throw new Error(data.error?.userMessage ?? 'Erro ao solicitar exclusão.');
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erro desconhecido.' });
    } finally {
      setDeleteLoading(false);
    }
  }

  const exportPending = exportStatus?.status === 'requested' || exportStatus?.status === 'in_progress';

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Privacidade e LGPD</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus dados pessoais conforme a LGPD.</p>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
          message.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-destructive/30 bg-destructive/5 text-destructive'
        }`}>
          {message.type === 'success' ? <Check className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          {message.text}
        </div>
      )}

      {/* Export section */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Download className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold">Exportar meus dados</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Receba um arquivo ZIP com todos os seus dados (perfil, briefings, clientes, mensagens e log de atividade).
              O link de download expira em 72 horas.
            </p>
          </div>
        </div>

        {exportStatus?.status === 'completed' && exportStatus.completed_at && (
          <p className="text-sm text-muted-foreground">
            Última exportação concluída em{' '}
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(exportStatus.completed_at),
            )}
            . Verifique seu e-mail para o link de download.
          </p>
        )}

        <Button
          onClick={requestExport}
          disabled={exportLoading || exportPending}
          variant={exportPending ? 'outline' : 'default'}
          className="gap-2"
        >
          {exportLoading || exportPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {exportPending ? 'Exportação em andamento…' : 'Solicitando…'}</>
          ) : (
            <><Download className="h-4 w-4" /> Solicitar exportação</>
          )}
        </Button>
      </section>

      {/* Deletion section */}
      <section className="rounded-xl border border-destructive/30 bg-card p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Trash2 className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold text-destructive">Excluir minha conta</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Solicita a exclusão permanente de todos os seus dados. Você terá 7 dias para cancelar antes que a exclusão seja executada.
              Dados de audit_log são mantidos por 24 meses conforme exigência legal.
            </p>
          </div>
        </div>

        {deleteToken && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Solicitação enviada.</strong> Para cancelar, guarde este token de cancelamento:{' '}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">{deleteToken}</code>
          </div>
        )}

        {!deleteToken && (
          <>
            {!deleteConfirm ? (
              <Button variant="destructive" onClick={() => setDeleteConfirm(true)} className="gap-2">
                <Trash2 className="h-4 w-4" /> Solicitar exclusão de conta
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">
                  Tem certeza? Esta ação iniciará a exclusão de todos os seus dados.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setDeleteConfirm(false)} className="flex-1">
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={requestDeletion}
                    disabled={deleteLoading}
                    className="flex-1 gap-2"
                  >
                    {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirmar exclusão
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
