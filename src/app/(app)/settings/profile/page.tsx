'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-fetch';

const profileSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(100),
  phone: z.string().optional(),
});

type ProfileValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const [serverMessage, setServerMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });

  useEffect(() => {
    apiFetch('/api/v1/auth/me')
      .then((r) => r.json())
      .then((d: { name?: string; phone?: string; error?: unknown }) => {
        if (!d.error) reset({ name: d.name ?? '', phone: d.phone ?? '' });
      })
      .catch(() => {})
      .finally(() => setLoadingUser(false));
  }, [reset]);

  async function onSubmit(values: ProfileValues) {
    setServerMessage('');
        const res = await apiFetch('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = (await res.json()) as { error?: { userMessage?: string } };
    if (!res.ok) {
      setIsError(true);
      setServerMessage(data.error?.userMessage ?? 'Erro ao salvar. Tente novamente.');
    } else {
      setIsError(false);
      setServerMessage('Perfil atualizado com sucesso.');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Perfil</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Seus dados pessoais e de contato.</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-7 h-7 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Foto de perfil indisponível nesta versão.</p>
          </div>
        </div>

        {loadingUser ? (
          <div className="space-y-4">
            <div className="h-10 bg-skeleton rounded animate-pulse" />
            <div className="h-10 bg-skeleton rounded animate-pulse" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="name">
                Nome completo
              </label>
              <Input id="name" type="text" className="h-11" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="phone">
                Telefone (opcional)
              </label>
              <Input id="phone" type="tel" placeholder="+55 11 99999-9999" className="h-11" {...register('phone')} />
            </div>

            {serverMessage && (
              <p className={`text-sm ${isError ? 'text-destructive' : 'text-success'}`}>{serverMessage}</p>
            )}

            <Button type="submit" disabled={isSubmitting} className="h-11">
              {isSubmitting ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
