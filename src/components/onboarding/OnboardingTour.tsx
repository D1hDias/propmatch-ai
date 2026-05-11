'use client';

import { useState, useEffect } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'propmatch_onboarding_done';

interface Step {
  title: string;
  description: string;
  emoji: string;
}

const STEPS: Step[] = [
  {
    emoji: '📋',
    title: 'Crie um briefing',
    description:
      'Cole a mensagem do seu cliente — em qualquer formato. Nossa IA extrai automaticamente os critérios de busca: localização, quartos, preço e mais.',
  },
  {
    emoji: '🔍',
    title: 'Busca em tempo real',
    description:
      'Consultamos múltiplos portais em paralelo e exibimos os resultados conforme chegam. Você vê o fit score de cada imóvel para o perfil do cliente.',
  },
  {
    emoji: '✅',
    title: 'Selecione e personalize',
    description:
      'Escolha os melhores imóveis, adicione uma nota pessoal para cada um e gere uma mensagem WhatsApp completa com um clique.',
  },
  {
    emoji: '👥',
    title: 'Gerencie seus clientes',
    description:
      'Salve clientes com nome e telefone para manter histórico de buscas. Clientes sem cadastro são criados como convidados e preservados por 18 meses.',
  },
];

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) setVisible(true);
  }, []);

  function close() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  if (!visible) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-background shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-1 bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="px-6 py-8 space-y-4 text-center">
          <button
            onClick={close}
            className="absolute top-4 right-4 rounded-md p-1 hover:bg-muted text-muted-foreground"
            aria-label="Pular tour"
          >
            <X className="h-5 w-5" />
          </button>

          <p className="text-5xl">{current.emoji}</p>

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Passo {step + 1} de {STEPS.length}
            </p>
            <h2 className="text-xl font-bold mt-2">{current.title}</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {current.description}
            </p>
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
                aria-label={`Passo ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          {step > 0 && (
            <Button variant="outline" onClick={back} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          )}
          <Button onClick={next} className="flex-1 gap-1.5">
            {isLast ? 'Começar' : (<>Próximo <ArrowRight className="h-4 w-4" /></>)}
          </Button>
        </div>
      </div>
    </div>
  );
}
