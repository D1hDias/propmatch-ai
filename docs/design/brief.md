# Design Brief — PropMatch AI

**Status:** Esqueleto. Será preenchido quando o `.zip` do template comprado chegar.

**Personalidade visual:** rápido, preciso, profissional.
**Densidade:** média (Stripe-style).
**Tema padrão:** light mode primeiro; dark mode em fase 2.
**Foundation técnica:** shadcn/ui + Tailwind, tokens vindos do `design.md` na raiz do repo.

## O que vai sair daqui depois do .zip

Quando você me enviar o template, eu vou:

1. Extrair o `.zip` num diretório de trabalho.
2. Identificar e catalogar:
   - Paleta de cores (primárias, secundárias, neutras, semânticas — success/warning/error/info)
   - Sistema tipográfico (família, escala, pesos, line-heights)
   - Sistema de espaçamento (escala 4px ou 8px-baseada)
   - Border-radius scale
   - Sombras (elevations)
   - Animações (durações, easings, keyframes)
   - Breakpoints responsivos
   - Componentes-chave usados (que mapeiem em shadcn/ui equivalents)
3. Gerar o `design.md` na raiz do repo (formato Google Labs, com explicação markdown do *porquê* de cada token).
4. Atualizar `tailwind.config.ts` com os tokens.
5. Atualizar `src/app/globals.css` com CSS variables para temas runtime.
6. Customizar 3-5 componentes shadcn/ui chave para validar a aplicação dos tokens (Button, Card, Input, Dialog, Badge).
7. Preencher as seções abaixo deste documento.

## Páginas e seções (a preencher)

A lista abaixo enumera as telas que o MVP precisa, mapeadas em rotas Next.js. Cada uma vai virar uma subseção neste briefing com: layout, componentes, estados (loading/empty/error), copy PT-BR, considerações de acessibilidade.

### Auth (route group `(auth)`)
- `/signup` — formulário com checkbox LGPD separado, link para login
- `/login` — email + senha + "esqueci a senha", link para signup
- `/forgot-password` — solicita link de reset
- `/reset-password` — recebe token via link, redefine senha

### App (route group `(app)`)
- `/` — dashboard inicial: últimos briefings, atalho para novo briefing, contador de uso vs tier
- `/briefings/new` — textarea principal, seletor de cliente, submit
- `/briefings/{id}` — extração mostrada, grid de resultados streamando, modo de seleção, modal de gerar WhatsApp
- `/briefings` — histórico de briefings, filtros, paginação
- `/clients` — lista de clientes, com tabs Active / Soft-archived
- `/clients/{id}` — detalhe do cliente + histórico de briefings
- `/settings/profile` — nome, telefone, troca de senha
- `/settings/billing` — plano atual, upgrade, downgrade, histórico de cobranças
- `/settings/privacy` — solicitar export, solicitar deleção, ver consentimentos
- `/settings/team` (Phase 2) — gestão de seats por agency owner

### Public (sem auth, fora do `(app)`)
- `/` (marketing) — hero, demo de 30s, pricing, login/signup CTAs
- `/privacy` — política de privacidade
- `/terms` — termos de uso
- `/status` (linka para BetterStack)

### Internal / admin (Phase 2)
- `/admin/users`, `/admin/audit-log`, etc. — fora do MVP escopo público

## Componentes (a mapear depois do .zip)

Lista preliminar dos componentes que o MVP precisa. Cada um vira um arquivo em `src/components/`:

### Primitivos (vêm do shadcn/ui, customizados)
- Button (variants: primary, secondary, ghost, destructive, outline, link)
- Input, Textarea, Select, Checkbox, RadioGroup, Switch
- Label, Form (react-hook-form integration)
- Card
- Dialog (modal)
- Sheet (drawer lateral)
- Tooltip
- Popover
- Toast (notifications)
- Tabs
- Badge
- Avatar
- Separator
- Skeleton (loading states)
- DropdownMenu
- Command (search palette se necessário)

### Domínio
- `BriefingCard` — preview de um briefing no histórico
- `PropertyCard` — card no grid de resultados (foto, preço, fit_score, ações)
- `ResultsGrid` — wrapper que conecta com SSE
- `BriefingForm` — textarea + cliente selector + submit
- `ExtractedCriteria` — visualização do output da extração
- `HitlBadge` — badge "Em revisão humana" com animação sutil
- `AutoWidenOffer` — banner com mensagem PT-BR + ações
- `WhatsAppPreview` — modal preview da mensagem antes de copiar
- `ClientSelector` — search combobox para escolher cliente ou criar guest
- `GuestArchiveBanner` — alerta de cliente em arquivamento iminente
- `TierGateModal` — modal de upgrade ao bater feature gate
- `Onboarding` — tour interativo (4 steps)
- `EmptyState` — componente reutilizável para estados vazios
- `ErrorBoundary` — fallback estilizado para falhas

## Estilo visual (a detalhar depois do .zip)

### O que sabemos antes do .zip

- **Personalidade:** rápido, preciso, profissional. Stripe-style.
- **Densidade média:** mais informação por tela que Notion, menos que Linear. Card-based mas com bom whitespace.
- **Light mode primeiro:** branco/quase-branco como base, com acentos. Dark mode é Phase 2.
- **Tipografia:** sans-serif moderna, provavelmente Inter ou similar. A família virá do template.
- **Cor primária:** virá do template. Provavelmente uma cor de "trust" (azul, verde-azulado, ou roxo). Se o template não definir bem, vamos para `#0F62FE`-ish (IBM Carbon blue) ou similar — cor que sinalize confiança, profissional.
- **Cores semânticas:** verde para sucesso, vermelho para erro, amarelo para warning, azul-claro para info.
- **Border radius:** moderado (6-8px). Não chip-only (Linear), nem chapado (Brutalist).
- **Sombras:** sutis. Card com sombra leve (similar a Stripe), elevações maiores apenas em modais.
- **Animações:** rápidas (150-250ms), easings padrão (ease-out para entrada, ease-in para saída).

### O que precisa do .zip para fechar

- Paleta exata (com hex codes para tudo)
- Família tipográfica e escala
- Escala de espaçamento (4px ou 8px base)
- Border-radius scale específica
- Estilo de sombras (rgba values, blur, spread)
- Tokens de animação (transition-duration, timing-function)

## Conteúdo necessário (a planejar)

Lista de copywriting, fotos e assets necessários:

### Copy PT-BR
- Hero da landing — proposta de valor em 1 frase
- 3-5 features destacadas com headline + descrição curta
- Depoimentos do pilot (após Sprint 8)
- FAQ (5-10 perguntas)
- Email de welcome
- Email de confirmação de deletion
- Email de export pronto
- Email de upgrade confirmado
- Mensagens broker-facing do PRD §7.4 (já catalogadas em `docs/api-conventions.md`)

### Imagens / vídeos
- Logo PropMatch (vetorial — SVG)
- Favicon e icon set (192x192, 512x512, apple-touch-icon)
- Print de hero da landing (tela do app real ou mockup)
- Vídeo demo de 30-60s (Phase 2; landing inicial pode ser estático)
- Avatar placeholder
- Empty state illustrations (2-3) — broker sem briefings, briefing sem resultados, etc.
- Imagens de referência para property cards (placeholder durante dev)

### Assets do app
- Loading spinner (componente, não imagem)
- Confirmação visual de "copiado para clipboard"
- Ícones (lucide-react cobre quase tudo; suplemento se faltar específico)

## Acessibilidade (princípios fixos)

- Contraste WCAG AA mínimo. Stripe-style permite contraste alto sem parecer agressivo.
- Todos os formulários com labels visíveis (não placeholder-only).
- Foco visível em qualquer elemento interativo.
- ARIA roles em componentes customizados.
- Suporte a navegação por teclado em 100% dos fluxos.
- Anúncios para screen readers em estados que mudam dinamicamente (resultados streamando).
- Texto alternativo em imagens de propriedade (tag-derivada do imóvel).

## Mobile e responsivo

- **Breakpoints (preliminares; ajustar com o template):** sm 640px, md 768px, lg 1024px, xl 1280px, 2xl 1536px.
- **Mobile-first** para landing e onboarding. Mobile-second para o app — brokers usam desktop majoritariamente, mas mobile precisa funcionar.
- **Touch targets** mínimo 44x44px conforme HIG/Material.
- **Grid de resultados** colapsa para 1 coluna em mobile, 2 em tablet, 3-4 em desktop.

## Próximos passos

1. **Você me envia o `.zip`** do template adquirido.
2. Eu extraio e analiso (1-2 horas de trabalho).
3. Gero o `design.md` v1, atualizo Tailwind, mostro 3 telas de referência customizadas (login, dashboard, briefing detail).
4. Você valida o sentido — se gostou, segue. Se não, iteramos no `design.md`.
5. Em paralelo, este `brief.md` é preenchido com todas as seções acima.
6. Componentes shadcn/ui são copiados e customizados para herdar os tokens.
7. Páginas começam a ser implementadas no Sprint 1 (FE-1, FE-2) já com a identidade aplicada.

## Anexos (a adicionar)

- [ ] `design.md` na raiz do repo (gerado a partir do .zip)
- [ ] Screenshots das 3 telas de referência customizadas
- [ ] Lista final de tokens (cor, tipo, espaçamento) versionada
- [ ] Mapping shadcn/ui → tokens custom

## Aprovações

- [ ] Founder/Product — sign-off na direção visual após mockups das 3 telas
- [ ] Tech Lead — sign-off na implementação dos tokens em Tailwind/CSS
- [ ] Frontend dev — sign-off na customização dos componentes shadcn/ui

Atualizações no design system pós-launch passam pelo mesmo processo (proposal → mockup → sign-off → implementação).
