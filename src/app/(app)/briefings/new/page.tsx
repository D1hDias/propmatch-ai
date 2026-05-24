import { Suspense } from 'react';
import { BriefingForm } from '@/components/briefings/BriefingForm';

export const metadata = { title: 'Nova Busca — PropMatch AI' };

export default function NewBriefingPage() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Nova Busca</h2>
        <p className="text-muted-foreground mt-1">
          Preencha os critérios do cliente para iniciar a busca nos parceiros.
        </p>
      </div>

      <Suspense>
        <BriefingForm />
      </Suspense>
    </div>
  );
}
