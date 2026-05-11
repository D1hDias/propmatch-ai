'use client';

import { X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradeModalProps {
  requiredPlan: 'starter' | 'pro';
  featureName: string;
  onClose: () => void;
}

const PLAN_DETAILS = {
  starter: {
    label: 'Starter',
    price: 'R$ 79/mês',
    perks: [
      'Até 3 buscas simultâneas',
      'Histórico completo de briefings',
      'Mensagens WhatsApp personalizadas',
      'Gestão de clientes ilimitada',
    ],
  },
  pro: {
    label: 'Pro',
    price: 'R$ 199/mês',
    perks: [
      'Buscas simultâneas ilimitadas',
      'Acesso antecipado a novos portais',
      'Relatórios de performance',
      'Suporte prioritário',
    ],
  },
};

export function UpgradeModal({ requiredPlan, featureName, onClose }: UpgradeModalProps) {
  const plan = PLAN_DETAILS[requiredPlan];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="relative bg-primary px-6 py-8 text-center">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1 text-white/70 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Faça upgrade para {plan.label}</h2>
          <p className="mt-1 text-sm text-white/80">
            "{featureName}" está disponível no plano {plan.label} ou superior.
          </p>
        </div>

        {/* Perks */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            O que você ganha
          </p>
          <ul className="space-y-2">
            {plan.perks.map((perk) => (
              <li key={perk} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 text-primary font-bold">✓</span>
                {perk}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 space-y-3">
          <Button asChild className="w-full" size="lg">
            <a href="/plano">
              Assinar {plan.label} por {plan.price}
            </a>
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Continuar no plano atual
          </Button>
        </div>
      </div>
    </div>
  );
}
