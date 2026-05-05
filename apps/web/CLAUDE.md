# CLAUDE.md — apps/web

Service-specific operating manual for `apps/web`. Read this in addition to the root [CLAUDE.md](../../CLAUDE.md).

## App responsibility

`apps/web` is the broker-facing single-page application. It is the only frontend surface in MVP. It is responsible for:

- All UI for signup, login, briefing creation, results, client management, settings, billing.
- Real-time updates via WebSocket for briefing status and result streaming.
- Form validation that mirrors backend zod schemas (shared via `packages/shared-types`).
- Clipboard delivery of formatted WhatsApp messages.
- Accessibility and PT-BR localization.

What this app does **not** own:
- Server-side rendering. We are a Vite SPA. Brokers expect a logged-in workspace tool, not a public marketing page.
- Marketing site. Lives in a separate repo (or eventually a separate Next.js project).
- Admin tools. Admin operations are CLI/API only in MVP.

## Tech stack

- **Build:** Vite 5
- **Framework:** React 18
- **Language:** TypeScript 5 (strict)
- **Routing:** TanStack Router (file-based) — see ADR-0002
- **Server state:** TanStack Query
- **Forms:** react-hook-form + zod (schemas imported from `packages/shared-types`)
- **Styling:** Tailwind CSS + shadcn/ui primitives
- **Icons:** lucide-react
- **Charts (Phase 2):** Recharts
- **Test:** Vitest + React Testing Library
- **E2E:** Playwright
- **Error capture:** Sentry browser SDK with source maps

## Directory layout

```
apps/web/
├── src/
│   ├── main.tsx               App entry
│   ├── routes/                File-based routes (TanStack Router)
│   │   ├── __root.tsx         Root layout
│   │   ├── (auth)/            Routes that don't require auth
│   │   │   ├── signup.tsx
│   │   │   └── login.tsx
│   │   ├── _app/              Routes that require auth
│   │   │   ├── dashboard.tsx
│   │   │   ├── briefings/
│   │   │   ├── clients/
│   │   │   └── settings/
│   ├── components/
│   │   ├── ui/                shadcn/ui primitives (generated; minor edits OK)
│   │   ├── briefings/         Domain components
│   │   ├── clients/
│   │   └── shared/            Cross-domain shared components
│   ├── hooks/                 Reusable hooks (useAuth, useBriefing, useDebounce, etc.)
│   ├── lib/                   Utilities (api client, formatters, helpers)
│   ├── api/                   API client functions, organized by domain
│   ├── features/              Larger feature modules with their own state and logic
│   ├── styles/                Tailwind config, global CSS
│   └── i18n/                  PT-BR strings (centralized for future localization)
├── e2e/                       Playwright tests
│   ├── pages/                 Page Object Model
│   └── tests/                 Spec files
├── public/                    Static assets
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── components.json            shadcn/ui config
```

## Conventions specific to this app

### Components

Function components only. Hooks only. No class components.

```tsx
type Props = {
  briefing: Briefing;
  onSelect: (id: string) => void;
};

export function BriefingCard({ briefing, onSelect }: Props) {
  return (
    <article className="rounded-lg border p-4 hover:bg-muted/50">
      {/* ... */}
    </article>
  );
}
```

- Default-exported components are reserved for route files (TanStack Router convention).
- Everything else is a named export.
- Component files match the component name in PascalCase: `BriefingCard.tsx`.

### State

- **Server state:** TanStack Query. Always. Don't put server data in `useState` or React Context for caching.
- **Form state:** react-hook-form. Always. Don't roll your own.
- **UI state (open/closed, hovered, expanded):** `useState` or `useReducer` local to the component.
- **Auth state:** `useAuth` hook backed by TanStack Query (the user profile is just another query). Avoid Context for auth.
- **Cross-cutting client state (rare):** Zustand. Only after a clear case for it; we do not have one in MVP.

### Forms

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@propmatch/shared-types';

export function SignupForm() {
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', name: '', phone: '', password: '', lgpdConsent: false },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    // ...
  });

  return <form onSubmit={onSubmit}>{/* ... */}</form>;
}
```

The schema is imported from `packages/shared-types` so that frontend and backend agree on validation rules. Never duplicate schemas.

### Styling

Tailwind utility classes only. No CSS modules, no styled-components, no inline styles except for genuinely dynamic values (e.g., a progress bar width).

shadcn/ui components are the building blocks. Compose, don't replace. If a shadcn component doesn't fit a need, propose an addition rather than introducing a parallel component library.

Design tokens live in `tailwind.config.ts` and are sourced from `packages/design-tokens`. Don't hardcode hex values in component code.

### Routing

File-based via TanStack Router. The `src/routes/` tree mirrors the URL structure.

- Route files default-export a route component.
- Loaders use TanStack Query's `prefetchQuery` so that navigating into a route warms the cache.
- Search params validate via zod schemas attached to the route definition.

```tsx
// src/routes/_app/briefings/$briefingId.tsx
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

export const Route = createFileRoute('/_app/briefings/$briefingId')({
  parseParams: (params) => ({
    briefingId: z.string().uuid().parse(params.briefingId),
  }),
  loader: ({ params, context: { queryClient } }) =>
    queryClient.ensureQueryData(briefingQuery(params.briefingId)),
  component: BriefingDetailPage,
});
```

### API calls

All API calls go through `src/lib/api/client.ts`, which handles:
- Base URL from env config.
- Bearer token from auth state.
- Refresh on 401 (single-flight; concurrent refresh requests deduplicated).
- Error envelope parsing — converts API error responses into typed `ApiError` instances.
- `X-Request-Id` propagation (read from response headers, attached to Sentry breadcrumbs).

Domain API functions live in `src/api/<domain>.ts` and use the client:

```tsx
// src/api/briefings.ts
export async function createBriefing(input: CreateBriefingInput): Promise<Briefing> {
  return await api.post('/api/v1/briefings', input);
}
```

### Error handling

Three layers:

1. **TanStack Query errors** surface in component code via `error` from the query/mutation. Render an inline error UI using shadcn `Alert`.
2. **Unexpected errors** caught by an `ErrorBoundary` at the route level, showing a recovery action (retry, return to dashboard, contact support).
3. **All errors** are also captured by Sentry (browser SDK auto-instrumented + manual `captureException` in error boundaries).

User-facing error messages come from the API's `error.user_message` field (PT-BR). Do not invent client-side error messages — they will diverge from the backend.

### Accessibility

Non-negotiable. Every form passes axe-core in tests. Every interactive element is keyboard-navigable. Focus management on modal open/close.

shadcn/ui primitives handle most of this for us. Don't strip the built-in ARIA attributes when customizing.

### Localization

PT-BR is the only language in MVP. All user-visible strings live in `src/i18n/pt-BR.ts` keyed by domain:

```tsx
export const t = {
  briefing: {
    submit_button: 'Buscar imóveis',
    empty_results: 'Os critérios são bem específicos e não encontrei nenhum imóvel.',
    auto_widen_offer: 'Quer ampliar a busca em ±10% no preço ou ±1km de raio?',
  },
  // ...
};
```

This is overengineered for one language but centralization makes the future i18n migration trivial. New strings always go into the file; never hardcoded in JSX.

## Testing

### Unit tests (Vitest + RTL) live next to components

```tsx
// BriefingCard.test.tsx
test('shows the price formatted in BRL', () => {
  render(<BriefingCard briefing={makeBriefing({ price: 850000 })} onSelect={vi.fn()} />);
  expect(screen.getByText('R$ 850.000,00')).toBeInTheDocument();
});
```

- Use `screen.getByRole(...)` over `getByTestId` when possible — it tests accessibility implicitly.
- Mock at the network boundary (MSW), not at the component level.

### E2E tests (Playwright) live in `e2e/`

Critical flows that must have E2E coverage by MVP:

1. Signup with LGPD consent → dashboard.
2. Login → submit briefing → see results → copy WhatsApp message.
3. Save briefing under a guest client → return next day → see in history.
4. Trigger auto-widen → result count grows.
5. 0 results → see auto-widen offer.
6. Tier-gated feature attempt as Free user → see upgrade modal.

Use the Page Object Model. Selectors via `data-testid`, never CSS classes.

### Storybook (Phase 2)

Storybook for shadcn customizations and design system components ships in Phase 2. Until then, components are documented via examples in tests.

## Things never to do without asking

- Add a second component library (Material UI, Chakra, etc.).
- Add a CSS-in-JS library.
- Add a state management library beyond what's listed.
- Use `localStorage` or `sessionStorage` for sensitive data (tokens, briefing content). Tokens go in httpOnly cookies; briefing data is server state via TanStack Query.
- Skip form validation on the assumption that the server will validate. Both validate.
- Ship a feature without an E2E smoke test if it's on a critical user flow.
- Render unsanitized user content with `dangerouslySetInnerHTML`.

## Common gotchas

- **Hydration mismatches.** This is an SPA, not SSR. We don't have hydration. If you see a related warning, something else is wrong (e.g., reading `window` during initial render in a way that breaks tests).
- **TanStack Query stale times.** Default is 0 (everything refetches on mount). Tune per query: profile data is stable (5 min), search results are not (always fresh).
- **WebSocket reconnection.** The WS hook reconnects with exponential backoff. After 5 failed reconnects in a row, surface a banner: *"Conexão instável. Atualize a página se os resultados não chegarem."*
- **Briefing text input.** Allow up to 2,000 chars but render a counter from 1,800 onwards. UTF-8 length, not byte length — emoji are multi-byte but should count as one character.
- **Phone formatting.** Display as `(11) 98765-4321` for BR numbers. Store and submit as E.164 (`+5511987654321`). The conversion lives in `src/lib/format/phone.ts`.
- **Money formatting.** `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. Helper in `src/lib/format/money.ts`.
- **Date formatting.** `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ... })`. Always render in São Paulo time.
- **Clipboard API.** `navigator.clipboard.writeText(...)`. Requires HTTPS or localhost. Fall back to a hidden textarea + `execCommand('copy')` if the API is unavailable; surface a friendly error if both fail.

## Performance targets

- First Contentful Paint: < 1.5s on a 4G connection.
- Time to Interactive: < 3s.
- Bundle size: < 500 KB gzipped initial load. Code-split by route.
- Lighthouse Performance score: ≥ 90.

These are tracked in CI via Lighthouse CI; regressions block merge.

## Where to look when stuck

- API conventions and error envelope: `../../docs/api-conventions.md`
- Schema and shared types: `../../docs/data-model.md` and `packages/shared-types`
- Auth flow details: `../../services/auth-svc/CLAUDE.md`
- Routing decision: `../../docs/adr/0002-routing-library.md`
- Test strategy: `../../docs/testing.md`
- shadcn/ui docs: https://ui.shadcn.com (we use the version pinned in `components.json`)
