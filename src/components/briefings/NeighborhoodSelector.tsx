'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import { RIO_NEIGHBORHOODS, ZONES, type Neighborhood } from '@/lib/constants/rio-neighborhoods';
import { cn } from '@/lib/utils';

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

export function NeighborhoodSelector({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered: Neighborhood[] = query.length >= 2
    ? RIO_NEIGHBORHOODS.filter((n) =>
        n.name.toLowerCase().includes(query.toLowerCase()),
      )
    : activeZone
      ? RIO_NEIGHBORHOODS.filter((n) => n.zone === activeZone)
      : [];

  function toggle(name: string) {
    onChange(
      value.includes(name) ? value.filter((v) => v !== name) : [...value, name],
    );
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'w-full flex items-center justify-between rounded-lg border border-border bg-muted/30',
          'px-3 py-2.5 text-sm text-left transition-colors',
          'hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          open && 'border-primary/40 ring-2 ring-primary/20',
        )}
      >
        <span className={value.length === 0 ? 'text-muted-foreground' : 'text-foreground'}>
          {value.length === 0
            ? 'Selecionar bairros…'
            : `${value.length} bairro${value.length > 1 ? 's' : ''} selecionado${value.length > 1 ? 's' : ''}`}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                disabled={disabled}
                className="hover:text-destructive transition-colors ml-0.5"
                aria-label={`Remover ${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                placeholder="Buscar bairro…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveZone(null); }}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Zone tabs (shown when no search query) */}
          {query.length < 2 && (
            <div className="flex gap-1 p-2 overflow-x-auto border-b border-border">
              {ZONES.map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setActiveZone(activeZone === zone ? null : zone)}
                  className={cn(
                    'shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
                    activeZone === zone
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-primary/10 hover:text-primary',
                  )}
                >
                  {zone}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          <div className="max-h-52 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">
                {query.length >= 2
                  ? 'Nenhum bairro encontrado'
                  : 'Selecione uma zona ou busque um bairro'}
              </p>
            )}
            {filtered.map((n) => (
              <button
                key={n.name}
                type="button"
                onClick={() => toggle(n.name)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between',
                  value.includes(n.name)
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted/60 text-foreground',
                )}
              >
                <span>{n.name}</span>
                {query.length >= 2 && (
                  <span className="text-xs text-muted-foreground ml-2">{n.zone}</span>
                )}
                {value.includes(n.name) && (
                  <span className="ml-auto text-primary">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
