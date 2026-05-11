import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ClientProfileForm } from '@/components/clients/ClientProfileForm';

export const metadata = { title: 'Novo Cliente — PropMatch AI' };

export default function NewClientPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        href="/clients"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Todos os clientes
      </Link>

      <div>
        <h1 className="text-xl font-bold text-foreground">Novo cliente</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Preencha o perfil completo para melhores resultados de match.
        </p>
      </div>

      <ClientProfileForm />
    </div>
  );
}
