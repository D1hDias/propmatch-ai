import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { NewClientForm } from '@/components/clients/NewClientForm';

export const metadata = { title: 'Novo Cliente — PropMatch AI' };

export default function NewClientPage() {
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Link
        href="/clients"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Todos os clientes
      </Link>

      <div className="bg-card rounded-xl shadow-card p-6 lg:p-8 space-y-4">
        <h1 className="text-xl font-bold text-foreground">Novo cliente</h1>
        <NewClientForm />
      </div>
    </div>
  );
}
