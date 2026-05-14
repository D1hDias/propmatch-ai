'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader, Plus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import {
  CLIENT_URGENCY_LABELS,
  CLIENT_CRM_STATUS_LABELS,
  type CreateClientInput,
  type ClientProfile,
} from '@/lib/schemas/client';

interface ClientProfileFormProps {
  clientId?: string; // if set, PATCHes; otherwise POSTs
  defaultValues?: Partial<CreateClientInput & { profile?: ClientProfile }>;
  onSuccess?: (id: string) => void;
}

const MUST_HAVE_SUGGESTIONS = [
  'Varanda', 'Portaria 24h', 'Academia', 'Piscina', 'Pet friendly',
  'Churrasqueira', 'Elevador', 'Área de serviço', 'Ar condicionado',
  'Mobiliado', 'Vaga de garagem', 'Salão de festas',
];

const PROPERTY_TYPE_OPTIONS = [
  'Apartamento', 'Casa', 'Studio', 'Cobertura', 'Terreno', 'Comercial',
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'À vista',
  financing: 'Financiamento',
  fgts: 'FGTS',
  mixed: 'Misto',
};

function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');

  function add(tag: string) {
    const t = tag.trim();
    if (!t || value.includes(t) || value.length >= 20) return;
    onChange([...value, t]);
    setInput('');
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  const filteredSuggestions = suggestions?.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(input.toLowerCase()),
  ) ?? [];

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(input); }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add(input)}
          disabled={disabled || !input.trim()}
          className="gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Suggestions */}
      {input.length > 0 && filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filteredSuggestions.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      {/* Tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary font-medium">
              {tag}
              <button type="button" onClick={() => remove(tag)} disabled={disabled} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClientProfileForm({ clientId, defaultValues, onSuccess }: ClientProfileFormProps) {
  const router = useRouter();
  const isEdit = Boolean(clientId);

  // Basic fields
  const [name, setName] = useState(defaultValues?.name ?? '');
  const [phone, setPhone] = useState(defaultValues?.phone ?? '');
  const [email, setEmail] = useState(defaultValues?.email ?? '');
  const [notes, setNotes] = useState(defaultValues?.notes ?? '');
  const [urgency, setUrgency] = useState<'ativo' | 'prazo' | 'explorando'>(
    defaultValues?.urgency ?? 'explorando',
  );
  const [crmStatus, setCrmStatus] = useState<'ativo' | 'negociacao' | 'fechado' | 'pausado'>(
    defaultValues?.crmStatus ?? 'ativo',
  );
  const [matchThreshold, setMatchThreshold] = useState(defaultValues?.matchThreshold ?? 70);

  // Profile fields
  const p = defaultValues?.profile;
  const [purpose, setPurpose] = useState<'buy' | 'rent'>(p?.purpose ?? 'buy');
  const [neighborhoods, setNeighborhoods] = useState<string[]>(p?.neighborhoods ?? []);
  const [propertyTypes, setPropertyTypes] = useState<string[]>(p?.propertyTypes ?? []);
  const [bedroomsMin, setBedroomsMin] = useState(p?.bedroomsMin?.toString() ?? '');
  const [bedroomsMax, setBedroomsMax] = useState(p?.bedroomsMax?.toString() ?? '');
  const [priceMin, setPriceMin] = useState(p?.priceMin?.toString() ?? '');
  const [priceMax, setPriceMax] = useState(p?.priceMax?.toString() ?? '');
  const [budgetFlexibility, setBudgetFlexibility] = useState(p?.budgetFlexibility ?? 0);
  const [areaMin, setAreaMin] = useState(p?.areaMin?.toString() ?? '');
  const [mustHaves, setMustHaves] = useState<string[]>(p?.mustHaves ?? []);
  const [niceToHaves, setNiceToHaves] = useState<string[]>(p?.niceToHaves ?? []);
  const [deadline, setDeadline] = useState(
    p?.deadline ? p.deadline.slice(0, 10) : '',
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(p?.paymentMethod ?? '');
  const [motivation, setMotivation] = useState<string>(p?.motivation ?? '');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setError('');
    setSubmitting(true);

        const profile: ClientProfile = {
      purpose,
      neighborhoods,
      propertyTypes,
      bedroomsMin: bedroomsMin ? parseInt(bedroomsMin) : null,
      bedroomsMax: bedroomsMax ? parseInt(bedroomsMax) : null,
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      budgetFlexibility,
      areaMin: areaMin ? parseFloat(areaMin) : null,
      mustHaves,
      niceToHaves,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      paymentMethod: (paymentMethod as ClientProfile['paymentMethod']) || null,
      motivation: (motivation as ClientProfile['motivation']) || null,
    };

    const payload = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
      urgency,
      crmStatus,
      matchThreshold,
      profile,
    };

    try {
      const url = isEdit ? `/api/v1/clients/${clientId}` : '/api/v1/clients';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: { userMessage?: string } };
        throw new Error(data.error?.userMessage ?? 'Erro ao salvar cliente.');
      }

      const data = (await res.json()) as { client?: { id: string } };
      const id = clientId ?? data.client?.id ?? '';

      if (onSuccess) {
        onSuccess(id);
      } else {
        router.push(`/clients/${id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
      setSubmitting(false);
    }
  }

  const inputCls = 'w-full h-10 px-3 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';
  const labelCls = 'block text-sm font-medium text-foreground mb-1.5';
  const sectionCls = 'space-y-4 rounded-xl border border-border bg-card p-5';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Dados básicos ── */}
      <div className={sectionCls}>
        <h2 className="text-sm font-semibold text-foreground">Dados do cliente</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="name">Nome <span className="text-destructive">*</span></label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="João da Silva" maxLength={200} disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="phone">Telefone</label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511987654321" disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="email">E-mail</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@email.com" disabled={submitting} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="notes">Observações gerais</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Histórico, particularidades, contatos anteriores…" rows={2} maxLength={2000} disabled={submitting} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 resize-none" />
        </div>
      </div>

      {/* ── Status de CRM ── */}
      <div className={sectionCls}>
        <h2 className="text-sm font-semibold text-foreground">Status e urgência</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Urgência</label>
            <div className="flex flex-col gap-1.5">
              {(['ativo', 'prazo', 'explorando'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  disabled={submitting}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50 ${urgency === u ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                >
                  {CLIENT_URGENCY_LABELS[u]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Status no pipeline</label>
            <div className="flex flex-col gap-1.5">
              {(['ativo', 'negociacao', 'fechado', 'pausado'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setCrmStatus(s)}
                  disabled={submitting}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50 ${crmStatus === s ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                >
                  {CLIENT_CRM_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className={labelCls}>Threshold de match para alertas: <strong>{matchThreshold}%</strong></label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={matchThreshold}
            onChange={(e) => setMatchThreshold(Number(e.target.value))}
            disabled={submitting}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>0% — todos</span>
            <span>100% — match perfeito</span>
          </div>
        </div>
      </div>

      {/* ── Perfil de busca ── */}
      <div className={sectionCls}>
        <h2 className="text-sm font-semibold text-foreground">Perfil de busca</h2>

        {/* Objetivo */}
        <div>
          <label className={labelCls}>Objetivo</label>
          <div className="flex gap-2">
            {(['buy', 'rent'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setPurpose(v)}
                disabled={submitting}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${purpose === v ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
              >
                {v === 'buy' ? 'Compra' : 'Aluguel'}
              </button>
            ))}
          </div>
        </div>

        {/* Bairros desejados */}
        <div>
          <label className={labelCls}>Bairros de interesse</label>
          <TagInput value={neighborhoods} onChange={setNeighborhoods} placeholder="Ex: Vila Mariana, Moema…" disabled={submitting} />
        </div>

        {/* Tipos de imóvel */}
        <div>
          <label className={labelCls}>Tipo de imóvel</label>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPE_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={submitting}
                onClick={() => setPropertyTypes((prev) => prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t])}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${propertyTypes.includes(t) ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Quartos e preço */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelCls} htmlFor="bedrooms-min">Quartos mín.</label>
            <input id="bedrooms-min" type="number" min={0} max={20} value={bedroomsMin} onChange={(e) => setBedroomsMin(e.target.value)} placeholder="0" disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="bedrooms-max">Quartos máx.</label>
            <input id="bedrooms-max" type="number" min={0} max={20} value={bedroomsMax} onChange={(e) => setBedroomsMax(e.target.value)} placeholder="—" disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="price-min">Preço mín. (R$)</label>
            <input id="price-min" type="number" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="0" disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="price-max">Preço máx. (R$)</label>
            <input id="price-max" type="number" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="—" disabled={submitting} className={inputCls} />
          </div>
        </div>

        {/* Flexibilidade e área */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Flexibilidade de orçamento: <strong>+{budgetFlexibility}%</strong></label>
            <input type="range" min={0} max={50} step={5} value={budgetFlexibility} onChange={(e) => setBudgetFlexibility(Number(e.target.value))} disabled={submitting} className="w-full accent-primary" />
          </div>
          <div>
            <label className={labelCls} htmlFor="area-min">Área mínima (m²)</label>
            <input id="area-min" type="number" min={0} value={areaMin} onChange={(e) => setAreaMin(e.target.value)} placeholder="0" disabled={submitting} className={inputCls} />
          </div>
        </div>

        {/* Must-haves */}
        <div>
          <label className={labelCls}>Indispensáveis</label>
          <TagInput value={mustHaves} onChange={setMustHaves} suggestions={MUST_HAVE_SUGGESTIONS} placeholder="Ex: Varanda, Pet friendly…" disabled={submitting} />
        </div>

        {/* Nice-to-haves */}
        <div>
          <label className={labelCls}>Desejáveis (mas não obrigatórios)</label>
          <TagInput value={niceToHaves} onChange={setNiceToHaves} suggestions={MUST_HAVE_SUGGESTIONS.filter((s) => !mustHaves.includes(s))} placeholder="Ex: Piscina, Academia…" disabled={submitting} />
        </div>

        {/* Timeline e motivação */}
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls} htmlFor="deadline">Prazo para fechar</label>
            <input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={submitting} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="payment">Forma de pagamento</label>
            <select id="payment" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={submitting} className={inputCls}>
              <option value="">Não informado</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="motivation">Motivação</label>
            <select id="motivation" value={motivation} onChange={(e) => setMotivation(e.target.value)} disabled={submitting} className={inputCls}>
              <option value="">Não informado</option>
              <option value="moradia">Moradia</option>
              <option value="investimento">Investimento</option>
              <option value="comercial">Comercial</option>
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!name.trim() || submitting} className="gap-2 min-w-[140px]">
          {submitting ? <Loader className="w-4 h-4 animate-spin" /> : null}
          {isEdit ? 'Salvar alterações' : 'Criar cliente'}
        </Button>
      </div>
    </form>
  );
}
