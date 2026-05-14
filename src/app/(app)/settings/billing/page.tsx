'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Zap, CreditCard, ArrowUpRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-fetch';

interface PlanInfo {
  id: 'free' | 'starter' | 'pro';
  label: string;
  price: string;
  perks: string[];
}

const PLANS: PlanInfo[] = [
  {
    id: 'free',
    label: 'Free',
    price: 'R$ 0/mês',
    perks: ['1 busca simultânea', 'Histórico de 30 dias', 'Até 10 clientes'],
  },
  {
    id: 'starter',
    label: 'Starter',
    price: 'R$ 79/mês',
    perks: ['3 buscas simultâneas', 'Histórico completo', 'Mensagens WhatsApp', 'Clientes ilimitados'],
  },
  {
    id: 'pro',
    label: 'Pro',
    price: 'R$ 199/mês',
    perks: ['Buscas ilimitadas', 'Portais exclusivos', 'Relatórios de performance', 'Suporte prioritário'],
  },
];

export default function BillingPage() {
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get('checkout');
  const upgradedPlan = searchParams.get('plan');

  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    // Read plan from token — in production decode JWT payload
    // For MVP, read from a /api/v1/auth/me endpoint or session storage
    const raw = typeof window !== 'undefined' ? localStorage.getItem('user_plan') : null;
    setCurrentPlan(raw ?? 'free');
  }, [upgradedPlan]);

  async function startCheckout(plan: 'starter' | 'pro') {
    setLoading(plan);
    try {
      const res = await apiFetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json() as { data: { url: string }; error?: { userMessage: string } };
      if (res.ok && data.data.url) {
        window.location.href = data.data.url;
      } else {
        alert(data.error?.userMessage ?? 'Erro ao iniciar checkout.');
      }
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await apiFetch('/api/v1/billing/portal', {
        method: 'POST',
      });
      const data = await res.json() as { data: { url: string }; error?: { userMessage: string } };
      if (res.ok && data.data.url) {
        window.location.href = data.data.url;
      } else {
        alert(data.error?.userMessage ?? 'Erro ao acessar portal de assinatura.');
      }
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Plano & Billing</h1>
          <p className="text-sm text-muted-foreground">Gerencie sua assinatura e forma de pagamento.</p>
        </div>
      </div>

      {/* Checkout result banners */}
      {checkoutResult === 'success' && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          <span>
            Upgrade para <strong>{upgradedPlan}</strong> realizado com sucesso! Aproveite os novos recursos.
          </span>
        </div>
      )}
      {checkoutResult === 'cancelled' && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Checkout cancelado. Seu plano não foi alterado.</span>
        </div>
      )}

      {/* Current plan */}
      {currentPlan && (
        <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Plano atual</p>
            <p className="text-lg font-bold mt-1 capitalize">{currentPlan}</p>
          </div>
          {currentPlan !== 'free' && (
            <Button variant="outline" onClick={openPortal} disabled={portalLoading} className="gap-2">
              {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              Gerenciar assinatura
            </Button>
          )}
        </div>
      )}

      {/* Plan cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const canUpgrade = plan.id !== 'free' && !isCurrent;

          return (
            <div
              key={plan.id}
              className={`rounded-xl border p-5 space-y-4 flex flex-col ${
                isCurrent ? 'border-primary ring-2 ring-primary/20 bg-card' : 'border-border bg-card'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <Zap className={`h-4 w-4 ${plan.id === 'pro' ? 'text-amber-500' : 'text-primary'}`} />
                  <span className="font-bold">{plan.label}</span>
                  {isCurrent && (
                    <span className="ml-auto text-[11px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      Atual
                    </span>
                  )}
                </div>
                <p className="text-xl font-bold mt-2">{plan.price}</p>
              </div>

              <ul className="space-y-1.5 flex-1">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="text-primary font-bold text-xs">✓</span>
                    {perk}
                  </li>
                ))}
              </ul>

              {canUpgrade && (
                <Button
                  onClick={() => startCheckout(plan.id as 'starter' | 'pro')}
                  disabled={loading === plan.id}
                  className="w-full gap-2"
                  variant={plan.id === 'pro' ? 'default' : 'outline'}
                >
                  {loading === plan.id ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Aguarde…</>
                  ) : (
                    `Assinar ${plan.label}`
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
