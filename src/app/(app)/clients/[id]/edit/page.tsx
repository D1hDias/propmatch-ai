'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Loader } from 'lucide-react';
import { ClientProfileForm } from '@/components/clients/ClientProfileForm';
import type { CreateClientInput, ClientProfile } from '@/lib/schemas/client';

interface ClientDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  urgency: 'ativo' | 'prazo' | 'explorando';
  crmStatus: 'ativo' | 'negociacao' | 'fechado' | 'pausado';
  matchThreshold: number;
  profile: ClientProfile | null;
}

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    fetch(`/api/v1/clients/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data: { client?: ClientDetail }) => {
        if (!data.client) { setError('Cliente não encontrado.'); }
        else { setClient(data.client); }
      })
      .catch(() => setError('Erro ao carregar cliente.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-muted-foreground">{error || 'Cliente não encontrado.'}</p>
      </div>
    );
  }

  const defaultValues: Partial<CreateClientInput & { profile?: ClientProfile }> = {
    name: client.name,
    phone: client.phone ?? '',
    email: client.email ?? '',
    notes: client.notes ?? '',
    urgency: client.urgency,
    crmStatus: client.crmStatus,
    matchThreshold: client.matchThreshold,
    profile: client.profile ?? undefined,
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/clients/${id}`)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Editar cliente</h1>
          <p className="text-sm text-muted-foreground">{client.name}</p>
        </div>
      </div>

      <ClientProfileForm
        clientId={id}
        defaultValues={defaultValues}
        onSuccess={() => router.push(`/clients/${id}`)}
      />
    </div>
  );
}
