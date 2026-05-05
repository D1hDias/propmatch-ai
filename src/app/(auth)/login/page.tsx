'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Building2 } from 'lucide-react';
import { useState } from 'react';

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(_values: LoginValues) {
    // Auth real será implementada na Sprint de Auth
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand / marketing */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-primary p-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full bg-white" />
          <div className="absolute bottom-[-120px] right-[-60px] w-[500px] h-[500px] rounded-full bg-white" />
        </div>

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-white font-bold text-xl">PropMatch AI</span>
        </div>

        {/* Hero copy */}
        <div className="relative">
          <h2 className="text-4xl font-bold text-white leading-tight mb-6">
            Conecte clientes
            <br />
            aos imóveis perfeitos
            <br />
            em segundos.
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-sm">
            Cole o briefing do cliente, deixe a IA extrair os critérios, receba imóveis ranqueados
            e envie no WhatsApp — tudo em menos de 10 segundos.
          </p>
        </div>

        {/* Stats */}
        <div className="relative flex gap-10">
          {[
            { value: '10s', label: 'briefing → WhatsApp' },
            { value: '3+', label: 'fontes de imóveis' },
            { value: '100%', label: 'dados do corretor' },
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
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground">PropMatch AI</span>
          </div>

          <h1 className="text-3xl font-bold text-foreground mb-2">Entrar</h1>
          <p className="text-muted-foreground mb-10">
            Acesse sua conta para continuar
          </p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
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
              {errors.email && (
                <p className="text-xs text-danger">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="password">
                Senha
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
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
              {errors.password && (
                <p className="text-xs text-danger">{errors.password.message}</p>
              )}
            </div>

            <div className="flex justify-end">
              <a href="#" className="text-sm text-primary hover:underline font-medium">
                Esqueceu a senha?
              </a>
            </div>

            <Button
              type="submit"
              className="w-full h-12 bg-primary hover:bg-primary-hover text-white font-semibold text-base"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Não tem conta?{' '}
            <a href="#" className="text-primary font-semibold hover:underline">
              Solicitar acesso
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
