import { Suspense } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientList } from '@/components/clients/ClientList';

export const metadata = { title: 'Clientes — PropMatch AI' };

export default function ClientsPage() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie sua carteira de clientes salvos.
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/clients/new">
            <UserPlus className="w-4 h-4" />
            Novo cliente
          </Link>
        </Button>
      </div>

      <Suspense fallback={<ClientListSkeleton />}>
        <ClientList />
      </Suspense>
    </div>
  );
}

function ClientListSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-16 bg-muted rounded-xl" />
      ))}
    </div>
  );
}
