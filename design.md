# design.md — PropMatch AI Design System

**Status**: Authoritative. This file is the System Prompt for UI generation.  
**Source template**: React Salero v1.0 (Dexignzone) — adapted for PropMatch AI.  
**Rule**: Never hardcode colors, font sizes, or spacing in components. Use the Tailwind classes or CSS variables defined here.

---

## 1. Brand Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#1921FA` | Primary actions, links, active states, sidebar accent |
| `--primary-hover` | `#050cdb` | Button hover, link hover |
| `--primary-dark` | `#030777` | Pressed states, emphasis |
| `--secondary` | `#FF8D0E` | Secondary actions, badges, highlights |
| `--secondary-dark` | `#da7300` | Secondary hover |
| `--title` | `#374557` | Page titles, heading text |

### Primary opacity scale
```
--rgba-primary-1  rgba(25, 33, 250, 0.1)   ← backgrounds, subtle fills
--rgba-primary-2  rgba(25, 33, 250, 0.2)
--rgba-primary-3  rgba(25, 33, 250, 0.3)
--rgba-primary-4  rgba(25, 33, 250, 0.4)
--rgba-primary-5  rgba(25, 33, 250, 0.5)
--rgba-primary-6  rgba(25, 33, 250, 0.6)
--rgba-primary-7  rgba(25, 33, 250, 0.7)
--rgba-primary-8  rgba(25, 33, 250, 0.8)
--rgba-primary-9  rgba(25, 33, 250, 0.9)
```

### Secondary opacity scale
```
--rgba-secondary-1  rgba(255, 141, 14, 0.1)
--rgba-secondary-2  rgba(255, 141, 14, 0.2)
...
--rgba-secondary-9  rgba(255, 141, 14, 0.9)
```

---

## 2. Semantic / Status Colors

| Token | Value | Usage |
|-------|-------|-------|
| Success | `#4FD66E` | Confirmed matches, delivered, positive delta |
| Info | `#58bad7` | Informational banners, secondary metric |
| Warning | `#FF9F00` | HITL queue alerts, moderate confidence |
| Danger | `#FF5E5E` | Errors, low confidence, failed extraction |

---

## 3. Neutral Palette

| Token | Value | Usage |
|-------|-------|-------|
| Body text | `#666666` | Default paragraph, secondary labels |
| Body bg | `#F8F8F8` | Page background |
| Heading | `#374557` | h1–h6, card titles |
| Muted text | `#89879f` | Table captions, placeholder labels |
| Border | `#CCCCCC` | Dividers, card borders, input borders |
| Gray 100 | `#f8f9fa` | Subtle backgrounds |
| Gray 200 | `#e9ecef` | Disabled inputs, striped table rows |
| Gray 300 | `#dee2e6` | Skeleton loaders |
| Gray 500 | `#adb5bd` | Placeholder text |
| Gray 600 | `#6c757d` | Secondary icons |
| Gray 700 | `#495057` | Active table rows |
| Gray 800 | `#343a40` | Dark nav text |
| Gray 900 | `#212529` | Max contrast text |
| White | `#ffffff` | Card backgrounds, modal backgrounds |

---

## 4. Typography

### Font Stack
```
Primary (body + UI):  Poppins, sans-serif
Fallbacks:            Open Sans, Roboto, Nunito, system-ui
```

### Scale

| Element | Size | Weight | Line Height | Color |
|---------|------|--------|-------------|-------|
| h1 | `2.25rem` (36px) | 600 | 1.2 | `#374557` |
| h2 | `1.875rem` (30px) | 600 | 1.2 | `#374557` |
| h3 | `1.5rem` (24px) | 600 | 1.2 | `#374557` |
| h4 | `1.125rem` (18px) | 600 | 1.2 | `#374557` |
| h5 | `1rem` (16px) | 600 | 1.2 | `#374557` |
| h6 | `0.938rem` (15px) | 600 | 1.2 | `#374557` |
| Body | `0.875rem` (14px) | 400 | 1.5 | `#666666` |
| Small / label | `0.8125rem` (13px) | 400 | 1.4 | `#89879f` |
| Tiny / badge | `0.75rem` (12px) | 600 | 1.0 | varies |

---

## 5. Spacing

Base unit: `0.25rem` (4px). Tailwind default scale applies.

| Common spacing | rem | px |
|----------------|-----|----|
| `xs` | `0.25rem` | 4 |
| `sm` | `0.5rem` | 8 |
| `md` | `1rem` | 16 |
| `lg` | `1.5rem` | 24 |
| `xl` | `1.875rem` | 30 |
| `2xl` | `3rem` | 48 |

Card inner padding: `1.875rem` (30px) on desktop, `1.25rem` (20px) on mobile.

---

## 6. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` / `rounded-xl` | `0.75rem` (12px) | Cards, modals, dialogs |
| `rounded-lg` | `0.5rem` (8px) | Inputs, dropdowns |
| `rounded-md` | `0.25rem` (4px) | Buttons (small), badges |
| `rounded-full` | `50rem` | Pills, avatar rings |

---

## 7. Shadows

```css
/* Card — default */
box-shadow: 0px 12px 23px 0px rgba(62, 73, 84, 0.04);

/* Card — hover */
box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.175);

/* Dropdown / Popover */
box-shadow: 0px 0px 50px 0px rgba(82, 63, 105, 0.15);

/* Modal */
box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);

/* Nav header (sidebar top) */
box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
```

---

## 8. Layout Structure

### Shell dimensions

| Region | Width / Height |
|--------|---------------|
| Sidebar (deznav) | `280px` (17.5rem) — fixed left |
| Sidebar mini | `88px` on icon-only mode |
| Nav header (logo bar) | `280px` wide, `80px` (5rem) tall |
| Top header | full-width, `80px` (5rem) tall — sticky |
| Content area | `calc(100vw - 280px)`, starts at `80px` top |
| Content inner padding | `30px` (1.875rem) all sides |

### Breakpoints (Tailwind defaults apply)

| Name | Width |
|------|-------|
| `sm` | 576px |
| `md` | 768px |
| `lg` | 992px |
| `xl` | 1200px |
| `2xl` | 1400px |

Below `md`: sidebar collapses to an overlay drawer.

---

## 9. Sidebar

```
Background:     var(--primary)  →  #1921FA  (default dark blue)
Text:           #ffffff
Active item bg: rgba(255,255,255, 0.15)
Active text:    #ffffff, bold
Hover item:     rgba(255,255,255, 0.07)
Category label: rgba(255,255,255, 0.4) — uppercase, 0.75rem, letter-spacing 0.1em
Icon size:      1.5rem (24px)
Nav item height: 3rem (48px)
Submenu indent: 1.875rem left padding
```

**PropMatch AI sidebar sections:**
```
YOUR WORKSPACE
  ├── Dashboard
  ├── Briefings
  └── Clientes

FERRAMENTAS
  ├── Nova Busca
  ├── Histórico
  └── Mensagens WhatsApp

CONTA
  ├── Perfil
  ├── Plano & Billing
  └── Configurações
```

---

## 10. Top Header

```
Background:   #ffffff
Height:       5rem (80px)
Border:       1px solid #CCCCCC (bottom)
Shadow:       0 0 15px rgba(0,0,0,0.02)

Left:   search input (accent-insensitive, emoji-tolerant)
Right:  notifications bell, user avatar + name dropdown
```

---

## 11. Cards

```css
.card {
  background:    #ffffff;
  border:        1px solid rgba(0,0,0,0.0625);
  border-radius: 0.75rem;         /* --radius */
  padding:       1.875rem;
  box-shadow:    0px 12px 23px 0px rgba(62, 73, 84, 0.04);
}

.card-header {
  background:    transparent;
  border-bottom: 1px solid #f0f1f5;
  padding:       1.25rem 1.875rem;
}

.card-title {
  font-size:     1rem;
  font-weight:   600;
  color:         #374557;
}
```

---

## 12. Buttons

### Variants

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Primary | `#1921FA` | white | none |
| Primary (outline) | transparent | `#1921FA` | `#1921FA` |
| Secondary | `#FF8D0E` | white | none |
| Success | `#4FD66E` | white | none |
| Danger | `#FF5E5E` | white | none |
| Light | `#f4f4f4` | `#374557` | `#CCCCCC` |

### Sizes

| Size | Height | Padding | Font |
|------|--------|---------|------|
| `sm` | 32px | `0.375rem 0.75rem` | 13px |
| `md` (default) | 40px | `0.5rem 1.25rem` | 14px |
| `lg` | 48px | `0.75rem 1.875rem` | 15px |
| `pill` | 40px | `0.5rem 1.5rem` | 14px, border-radius 50rem |

```css
button {
  font-family: Poppins, sans-serif;
  font-weight: 600;
  border-radius: 0.25rem;  /* default; override with .rounded-full for pill */
  transition: all 0.1s ease;
  letter-spacing: 0.02em;
}
```

---

## 13. Inputs & Forms

```css
.form-control {
  height:        3rem;          /* 48px */
  padding:       0.75rem 1rem;
  font-size:     0.875rem;
  font-weight:   400;
  color:         #666666;
  background:    #ffffff;
  border:        1px solid #CCCCCC;
  border-radius: 0.5rem;
  transition:    border-color 0.3s ease, box-shadow 0.3s ease;
}

.form-control:focus {
  border-color: #8c90fd;          /* --primary at 50% */
  box-shadow:   0 0 0 0.25rem rgba(25, 33, 250, 0.25);
  outline:      none;
}

.form-control::placeholder {
  color: #adb5bd;
}

label {
  font-size:   0.875rem;
  font-weight: 600;
  color:       #374557;
  margin-bottom: 0.5rem;
  display:     block;
}
```

### Briefing textarea (primary input — optimize for speed)
```css
.briefing-input {
  min-height:  7rem;
  font-size:   1rem;        /* slightly larger — main interaction */
  border:      2px solid #CCCCCC;
  resize:      vertical;
}
.briefing-input:focus {
  border-color: #1921FA;
  box-shadow:   0 0 0 0.25rem rgba(25, 33, 250, 0.15);
}
```

---

## 14. Badges

```css
/* Tier badges */
.badge-free     { background: #e9ecef;    color: #495057; }
.badge-starter  { background: rgba(25,33,250,0.1); color: #1921FA; }
.badge-pro      { background: #FF8D0E;    color: #ffffff; }

/* Status badges */
.badge-success  { background: rgba(79,214,110,0.15);  color: #297F00; }
.badge-warning  { background: rgba(255,159,0,0.15);   color: #FF9F00; }
.badge-danger   { background: rgba(255,94,94,0.15);   color: #FF5E5E; }
.badge-info     { background: rgba(88,186,215,0.15);  color: #3065D0; }

/* Fit score chips */
.score-high    { background: rgba(79,214,110,0.15);  color: #297F00; }   /* 80–100 */
.score-medium  { background: rgba(255,159,0,0.15);   color: #FF9F00; }   /* 50–79  */
.score-low     { background: rgba(255,94,94,0.15);   color: #FF5E5E; }   /* 0–49   */
```

---

## 15. Tables

```css
table {
  width:           100%;
  border-collapse: collapse;
  font-size:       0.875rem;
}

thead th {
  font-size:      0.8125rem;
  font-weight:    600;
  color:          #89879f;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom:  2px solid #f0f1f5;
  padding:        0.75rem 1rem;
}

tbody td {
  padding:        0.875rem 1rem;
  border-bottom:  1px solid #f0f1f5;
  color:          #666666;
  vertical-align: middle;
}

tbody tr:hover {
  background: rgba(25, 33, 250, 0.03);
}
```

---

## 16. Property Card (PropMatch-specific)

The core broker-facing element. Must load fast and be scannable.

```
┌─────────────────────────────────────┐
│  [image 16:9]                       │
├─────────────────────────────────────┤
│  Rua Domingos de Morais, 1234       │  ← address, bold, #374557
│  Vila Mariana · São Paulo           │  ← neighborhood · city, #89879f, 13px
│                                     │
│  R$ 750.000   🛏 2   📐 68m²         │  ← price bold primary, metrics #666
│                                     │
│  ⬜ FITL Score: [████░░] 82%         │  ← score bar + chip (color by range)
│                                     │
│  [Selecionar]  [Ver fonte ↗]        │  ← primary btn + ghost btn
└─────────────────────────────────────┘

card border-radius: 0.75rem
card shadow:        0px 12px 23px 0px rgba(62,73,84,0.04)
card hover shadow:  0 4px 20px rgba(25,33,250,0.12)
card selected:      border: 2px solid #1921FA; shadow: 0 0 0 4px rgba(25,33,250,0.15)
image border-radius: 0.75rem 0.75rem 0 0
```

---

## 17. Stat / KPI Cards (dashboard)

```
┌──────────────────────────┐
│ 🏠  Total Briefings       │  ← icon (48x48, bg: rgba-primary-1, color: primary)
│     683                  │  ← number: 1.875rem, bold, #374557
│     +12% esta semana     │  ← delta: 13px, success green or danger red
└──────────────────────────┘
```

---

## 18. Dark Mode

Variables that change in `[data-theme-version="dark"]`:

```css
body bg:       #17171E
card bg:       #1E1E2D   (--card: 222.2 84% 4.9%)
sidebar bg:    #1E1E2D
text body:     rgba(255,255,255,0.7)
heading:       #f4f4f4
border:        rgba(255,255,255,0.07)
input bg:      #2c2c3e
input border:  rgba(255,255,255,0.1)
```

---

## 19. Animations & Transitions

```css
/* Default transition for interactive elements */
transition: all 0.3s ease;

/* Button press */
transform: translateY(1px);

/* Sidebar item hover */
transition: all 0.2s ease;

/* Card hover lift */
transform: translateY(-2px);
transition: transform 0.2s ease, box-shadow 0.2s ease;

/* Page fade-in */
animation: fadeIn 0.3s ease;

/* SSE result stream — each property card streams in */
animation: slideInUp 0.25s ease;
```

---

## 20. Tailwind CSS Variable Mapping

These variables must be set in `src/app/globals.css` and referenced by `tailwind.config.ts`.

```css
:root {
  /* shadcn/ui expects HSL values */
  --background:   0 0% 97.3%;          /* #F8F8F8 */
  --foreground:   214 25% 37%;         /* #374557 — headings */
  --card:         0 0% 100%;
  --card-foreground: 214 25% 37%;
  --popover:      0 0% 100%;
  --popover-foreground: 214 25% 37%;

  --primary:      234 97% 54%;         /* #1921FA */
  --primary-foreground: 0 0% 100%;

  --secondary:    31 100% 52%;         /* #FF8D0E */
  --secondary-foreground: 0 0% 100%;

  --muted:        210 17% 95%;         /* #f0f1f5 */
  --muted-foreground: 246 13% 59%;     /* #89879f */

  --accent:       234 97% 54%;         /* same as primary for hover states */
  --accent-foreground: 0 0% 100%;

  --destructive:  0 100% 67%;          /* #FF5E5E */
  --destructive-foreground: 0 0% 100%;

  --success:      135 61% 58%;         /* #4FD66E */
  --warning:      37 100% 50%;         /* #FF9F00 */
  --info:         196 54% 59%;         /* #58bad7 */

  --border:       0 0% 80%;            /* #CCCCCC */
  --input:        0 0% 80%;
  --ring:         234 97% 54%;         /* primary — focus ring */

  --radius: 0.75rem;

  /* Layout */
  --sidebar-width: 17.5rem;            /* 280px */
  --header-height: 5rem;               /* 80px */
}
```

---

## 21. Google Fonts Import

```html
<!-- In src/app/layout.tsx via next/font/google -->
Poppins — weights: 300, 400, 500, 600, 700, 800
subsets: ['latin', 'latin-ext']
```

---

## 22. Icon Library

Use **Lucide React** (already installed via shadcn/ui). Do not import from other icon sets.

Common icons for PropMatch AI:

| Context | Icon |
|---------|------|
| Briefing | `FileText` |
| Property | `Home` |
| WhatsApp / message | `MessageCircle` |
| Client | `User` / `Users` |
| Score / ranking | `TrendingUp` |
| HITL / review | `ClipboardCheck` |
| Search | `Search` |
| Copy to clipboard | `Copy` |
| Notification | `Bell` |
| Settings | `Settings` |
| Logout | `LogOut` |
| Pro tier | `Zap` |
| Filter | `SlidersHorizontal` |
| Location | `MapPin` |
| Price | `DollarSign` |
| Bedrooms | `BedDouble` |
| Area | `SquareIcon` |

---

## 23. Responsive Behavior

| Breakpoint | Sidebar | Content |
|-----------|---------|---------|
| `< 768px` | hidden (slide-over drawer) | full width |
| `768–992px` | icon-only (88px) | `calc(100% - 88px)` |
| `> 992px` | full (280px) | `calc(100% - 280px)` |

The hamburger toggle (`☰`) appears on mobile in the top header.

---

## 24. Loading & Empty States

**Skeleton loaders**: use gray-200 (`#e9ecef`) animated shimmer. Never show empty grids.

**Empty briefing results**:
```
┌────────────────────────────────────┐
│            🔍                      │
│   Nenhum imóvel encontrado         │  ← #374557, h5
│   Tente ampliar os critérios       │  ← #89879f, 14px
│   [Ampliar busca automaticamente]  │  ← primary button
└────────────────────────────────────┘
```

**HITL queue pending**:
```
Análise em revisão humana — resultado em até 3 min
[progress bar with --primary at 40% width, animated]
```

---

*This file is the single source of truth for visual design. Updated when design.md is finalized with brand identity. Any UI component must reference these tokens — no hardcoded hex values in component files.*
