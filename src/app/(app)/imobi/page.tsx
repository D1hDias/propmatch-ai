import { Suspense } from 'react';
import { PartnerSiteList } from '@/components/partners/PartnerSiteList';

export const metadata = { title: 'Imobiliárias — PropMatch AI' };

export default function ImobiPage() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Imobiliárias</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie o estoque de imobiliárias parceiras. Sites indexados retornam resultados instantâneos nas buscas.
        </p>
      </div>

      <Suspense fallback={<ImobiSkeleton />}>
        <PartnerSiteList />
      </Suspense>
    </div>
  );
}

function ImobiSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-[72px] bg-muted rounded-lg" />
      ))}
    </div>
  );
}
