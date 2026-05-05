import type { Config } from 'tailwindcss';

// Design tokens from design.md (extracted from Salero template, adapted for PropMatch AI).
// All values here must match the CSS variables in src/app/globals.css.
// Do NOT hardcode colors in components — use Tailwind classes mapped to these tokens.
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      fontSize: {
        // Body scale from design.md §4
        'xs':   ['0.75rem',   { lineHeight: '1.0', fontWeight: '600' }],   // 12px — badges
        'sm':   ['0.8125rem', { lineHeight: '1.4' }],                      // 13px — labels
        'base': ['0.875rem',  { lineHeight: '1.5' }],                      // 14px — body
        'md':   ['0.938rem',  { lineHeight: '1.4' }],                      // 15px — h6
        'lg':   ['1rem',      { lineHeight: '1.2', fontWeight: '600' }],   // 16px — h5
        'xl':   ['1.125rem',  { lineHeight: '1.2', fontWeight: '600' }],   // 18px — h4
        '2xl':  ['1.5rem',    { lineHeight: '1.2', fontWeight: '600' }],   // 24px — h3
        '3xl':  ['1.875rem',  { lineHeight: '1.2', fontWeight: '600' }],   // 30px — h2
        '4xl':  ['2.25rem',   { lineHeight: '1.2', fontWeight: '600' }],   // 36px — h1
      },
      colors: {
        // shadcn/ui semantic tokens (CSS variable-driven)
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover:      '#050cdb',
          dark:       '#030777',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          dark:       '#da7300',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',

        // PropMatch semantic colors (§2 from design.md)
        success: '#4FD66E',
        warning: '#FF9F00',
        info:    '#58bad7',
        danger:  '#FF5E5E',

        // Neutral palette (§3 from design.md)
        title:  '#374557',
        body:   '#666666',
        muted2: '#89879f',
      },
      borderRadius: {
        lg:   'var(--radius)',                        // 0.75rem — cards, modals
        md:   'calc(var(--radius) - 0.25rem)',        // 0.5rem  — inputs
        sm:   'calc(var(--radius) - 0.5rem)',         // 0.25rem — buttons, badges
        full: '50rem',
      },
      boxShadow: {
        card:     '0px 12px 23px 0px rgba(62, 73, 84, 0.04)',
        'card-hover': '0 4px 20px rgba(25, 33, 250, 0.12)',
        dropdown: '0px 0px 50px 0px rgba(82, 63, 105, 0.15)',
        modal:    '0 0.5rem 1rem rgba(0, 0, 0, 0.15)',
        header:   '0 0 15px rgba(0, 0, 0, 0.02)',
        selected: '0 0 0 4px rgba(25, 33, 250, 0.15)',
      },
      spacing: {
        // Layout constants from design.md §8
        'sidebar': 'var(--sidebar-width)',   // 17.5rem / 280px
        'header':  'var(--header-height)',   // 5rem / 80px
      },
      height: {
        header: 'var(--header-height)',
      },
      width: {
        sidebar: 'var(--sidebar-width)',
      },
      animation: {
        'slide-in-up': 'slideInUp 0.25s ease forwards',
        shimmer:       'shimmer 2s infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
