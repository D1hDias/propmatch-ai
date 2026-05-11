'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Building2 } from 'lucide-react';

const signupSchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(10, 'Senha deve ter ao menos 10 caracteres'),
  lgpd_consent: z.literal(true, {
    errorMap: () => ({ message: 'Você deve aceitar os termos para continuar' }),
  }),
});

type SignupValues = z.infer<typeof signupSchema>;


export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '', lgpd_consent: undefined },
  });

  async function onSubmit(values: SignupValues) {
    setServerError('');
    try {
      const res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password,
          lgpd_consent: values.lgpd_consent,
        }),
      });
      const data = (await res.json()) as { access_token?: string; error?: { userMessage?: string } };
      if (!res.ok) {
        setServerError(data.error?.userMessage ?? 'Erro ao criar conta. Tente novamente.');
        return;
      }
      if (data.access_token) {
        sessionStorage.setItem('access_token', data.access_token);
      }
      router.push('/dashboard');
    } catch {
      setServerError('Erro de conexão. Verifique sua internet e tente novamente.');
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-primary p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full bg-white" />
          <div className="absolute bottom-[-120px] right-[-60px] w-[500px] h-[500px] rounded-full bg-white" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-white font-bold text-xl">PropMatch AI</span>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-bold text-white leading-tight mb-6">
            Comece a fechar
            <br />
            mais negócios
            <br />
            hoje mesmo.
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-sm">
            Configure sua conta em menos de 2 minutos e comece a usar a IA para encontrar imóveis para seus clientes.
          </p>
        </div>
        <div className="relative flex gap-10">
          {[
            { value: '10s', label: 'briefing → WhatsApp' },
            { value: '3+', label: 'fontes de imóveis' },
            { value: 'Grátis', label: 'para começar' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-white font-bold text-2xl">{stat.value}</p>
              <p className="text-white/60 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground">PropMatch AI</span>
          </div>

          <h1 className="text-3xl font-bold text-foreground mb-2">Criar conta grátis</h1>
          <p className="text-muted-foreground mb-10">
            Sem cartão de crédito. Cancele quando quiser.
          </p>

          {serverError && (
            <div className="mb-6 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="name">
                Nome completo
              </label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Seu nome"
                className="h-12"
                {...register('name')}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="email">
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email.com"
                className="h-12"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="password">
                Senha
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Mínimo 10 caracteres"
                  className="h-12 pr-12"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <div className="flex items-start gap-3 pt-1">
              <input
                id="lgpd_consent"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                {...register('lgpd_consent')}
              />
              <label htmlFor="lgpd_consent" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                Li e aceito os{' '}
                <Link href="/terms" className="text-primary hover:underline font-medium">
                  Termos de Uso
                </Link>{' '}
                e a{' '}
                <Link href="/privacy" className="text-primary hover:underline font-medium">
                  Política de Privacidade
                </Link>
                , incluindo o tratamento dos meus dados conforme a LGPD.
              </label>
            </div>
            {errors.lgpd_consent && (
              <p className="text-xs text-destructive">{errors.lgpd_consent.message}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold text-base"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Criando conta…' : 'Criar conta grátis'}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Já tem conta?{' '}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
