import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { ExtractionResult } from '@/components/briefings/ExtractionResult';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Briefing — PropMatch AI' };

// Fetch server-side — cookies are forwarded automatically in Next.js 15 server components
async function fetchBriefing(id: string) {
  // In a real implementation this would use the internal service directly.
  // For now we call the API route to keep the auth/RLS path consistent.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/briefings/${id}`, {
    // Revalidate every 2 seconds while the briefing may be processing
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
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

      <div className="bg-card rounded-xl shadow-card p-6 lg:p-8">
        <ExtractionResult briefingId={id} initialData={briefing} />
      </div>
    </div>
  );
}
