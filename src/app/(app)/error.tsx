'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry already captures via instrumentation.ts — no need to call captureException here
    console.error('[AppError]', error.message);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] px-4 text-center space-y-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Algo inesperado aconteceu</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Não se preocupe — seus dados estão seguros. Tente novamente ou entre em contato se o problema persistir.
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.history.back()}>
          Voltar
        </Button>
        <Button onClick={reset}>Tentar novamente</Button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Código: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
