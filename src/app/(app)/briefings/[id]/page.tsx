import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { ExtractionResult } from '@/components/briefings/ExtractionResult';
import { SearchTrigger } from '@/components/search/SearchTrigger';
import { SearchResults } from '@/components/search/SearchResults';
import { GuestArchiveBanner } from '@/components/clients/GuestArchiveBanner';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Briefing — PropMatch AI' };

async function fetchBriefing(id: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/briefings/${id}`, {
    next: { revalidate: 2 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch briefing');
  return res.json();
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BriefingDetailPage({ params }: Props) {
  const { id } = await params;
  const briefing = await fetchBriefing(id);

  if (!briefing) notFound();

  const isReady = briefing.status === 'ready';
  const isSearching = briefing.status === 'searching';

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Breadcrumb / nav */}
      <div className="flex items-center justify-between">
        <Link
          href="/briefings"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Todos os briefings
        </Link>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link href="/briefings/new">
            <Plus className="w-4 h-4" />
            Novo briefing
          </Link>
        </Button>
      </div>

      {/* Guest archive warning — FE-11 */}
      {briefing.client?.isGuest && (
        <GuestArchiveBanner
          clientId={briefing.client.id}
          clientName={briefing.client.name}
          createdAt={briefing.client.createdAt}
          softArchivedAt={briefing.client.softArchivedAt}
        />
      )}

      {/* Extraction result */}
      <div className="bg-card rounded-xl shadow-card p-6 lg:p-8">
        <ExtractionResult briefingId={id} initialData={briefing} />
      </div>

      {/* Search section — shown after extraction is done */}
      {briefing.extractedCriteria && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Imóveis encontrados</h2>
            {/* Only show Buscar button if not already searching/ready */}
            {!isSearching && !isReady && (
              <SearchTrigger briefingId={id} />
            )}
          </div>

          {(isSearching || isReady) && <SearchResults briefingId={id} />}
        </section>
      )}
    </div>
  );
}
