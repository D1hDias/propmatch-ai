import 'server-only';
import type { SearchCriteria } from './types';

/**
 * SRC-11: Auto-widen — proposes relaxed criteria when result count < 5.
 *
 * Strategy (broker-confirmed via FE-7 before applying):
 *   1. Price max +10%
 *   2. Radius +1km (represented as bairros adjacentes — Sprint 4 stub)
 *   3. Both combined (stack)
 *
 * Returns a list of widen proposals in order of least-to-most permissive.
 * The broker sees these as one-click options on the UI.
 */

export interface WidenProposal {
  label: string;             // PT-BR label shown to broker
  description: string;       // short explanation
  criteria: SearchCriteria;  // the widened criteria to re-run
}

export function proposeWidens(
  original: SearchCriteria,
  resultCount: number,
): WidenProposal[] {
  if (resultCount >= 5) return [];

  const proposals: WidenProposal[] = [];

  // Option 1: loosen price by 10%
  if (original.priceMax != null) {
    const newMax = Math.round(original.priceMax * 1.1);
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(newMax);

    proposals.push({
      label: `Aumentar preço até ${formatted}`,
      description: `Ampliar o teto de preço em 10% pode revelar mais opções próximas ao seu orçamento.`,
      criteria: { ...original, priceMax: newMax },
    });
  }

  // Option 2: remove neighborhood constraint (broaden to whole city)
  if (original.neighborhood) {
    proposals.push({
      label: `Buscar em toda ${original.city}`,
      description: `Remover o filtro de bairro (${original.neighborhood}) e buscar em toda a cidade.`,
      criteria: { ...original, neighborhood: undefined },
    });
  }

  // Option 3: stack both
  if (original.priceMax != null && original.neighborhood) {
    const newMax = Math.round(original.priceMax * 1.1);
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(newMax);

    proposals.push({
      label: `Ampliar bairro + preço até ${formatted}`,
      description: `Combinar as duas ampliações para maximizar o número de resultados.`,
      criteria: { ...original, neighborhood: undefined, priceMax: newMax },
    });
  }

  return proposals;
}

export const AUTO_WIDEN_THRESHOLD = 5;
