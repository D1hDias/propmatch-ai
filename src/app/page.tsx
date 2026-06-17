import type { Metadata } from 'next';
import Link from 'next/link';
import {
  TrendingUp,
  Search,
  Users,
  Bell,
  ArrowRight,
  CheckCircle2,
  CheckCircle,
  X,
  Zap,
  MessageCircle,
  BarChart2,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'PropMatch AI — Encontre o imóvel certo para cada cliente em segundos',
  description:
    'A IA que transforma o briefing do cliente em lista curada de imóveis com match % e mensagem WhatsApp pronta. Feita para corretores do Brasil.',
  openGraph: {
    title: 'PropMatch AI',
    description: 'Briefing → imóveis ranqueados → WhatsApp em segundos.',
    url: 'https://propmatch.com.br',
    siteName: 'PropMatch AI',
    locale: 'pt_BR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PropMatch AI',
    description: 'Briefing → imóveis ranqueados → WhatsApp em segundos.',
  },
};

const FEATURES = [
  {
    icon: Search,
    title: 'Busca inteligente multi-portal',
    description:
      'Cole a mensagem do cliente e escolha onde buscar — ZAP, Viva Real ou qualquer imobiliária com link. A IA extrai os critérios e varre tudo em paralelo.',
  },
  {
    icon: TrendingUp,
    title: 'Match % em tempo real',
    description:
      'Cada imóvel recebe uma pontuação de 0 a 100% de compatibilidade com o perfil do cliente. Você vê de cara o que vale o seu tempo.',
  },
  {
    icon: Users,
    title: 'Parcerias de venda conjunta',
    description:
      'Encontrou o imóvel mas ele é de outro corretor? Gere em um clique a mensagem de proposta de parceria e divida a comissão.',
  },
  {
    icon: Bell,
    title: 'Alertas automáticos de match',
    description:
      'Cadastre o perfil do cliente e esqueça. Quando surgir um imóvel novo que bate com o perfil, você recebe uma notificação imediata.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Cole o briefing',
    description: 'Paste a mensagem do seu cliente exatamente como recebeu — no WhatsApp, e-mail ou digitada ao vivo.',
    icon: MessageCircle,
  },
  {
    step: '2',
    title: 'A IA busca em paralelo',
    description: 'Em segundos, a IA extrai os critérios e varre múltiplos portais ao mesmo tempo, calculando o match % de cada imóvel.',
    icon: Zap,
  },
  {
    step: '3',
    title: 'Selecione e envie',
    description: 'Escolha os melhores imóveis, adicione uma nota pessoal e copie a mensagem WhatsApp formatada com um clique.',
    icon: BarChart2,
  },
];

const PLANS = [
  {
    name: 'Free',
    price: 'Grátis',
    priceDetail: 'para sempre',
    description: 'Para corretores que querem experimentar.',
    cta: 'Criar conta grátis',
    href: '/signup',
    highlight: false,
    features: [
      { label: '5 briefings por hora', included: true },
      { label: '20 buscas por dia', included: true },
      { label: '1 busca simultânea', included: true },
      { label: 'Até 10 clientes salvos', included: true },
      { label: 'Mensagem WhatsApp (clipboard)', included: true },
      { label: 'Filtro de amenidades', included: false },
      { label: 'Notas pessoais por imóvel', included: false },
      { label: 'Analytics de conversão', included: false },
    ],
  },
  {
    name: 'Starter',
    price: 'R$ 197',
    priceDetail: 'por mês',
    description: 'Para o corretor ativo que quer escalar.',
    cta: 'Começar com Starter',
    href: '/signup?plan=starter',
    highlight: true,
    features: [
      { label: '60 briefings por hora', included: true },
      { label: '500 buscas por dia', included: true },
      { label: '3 buscas simultâneas', included: true },
      { label: 'Clientes ilimitados', included: true },
      { label: 'Mensagem WhatsApp (clipboard)', included: true },
      { label: 'Filtro de amenidades', included: true },
      { label: 'Notas pessoais por imóvel', included: true },
      { label: 'Analytics de conversão', included: true },
    ],
  },
  {
    name: 'Pro',
    price: 'R$ 397',
    priceDetail: 'por mês',
    description: 'Para equipes e corretores de alto volume.',
    cta: 'Começar com Pro',
    href: '/signup?plan=pro',
    highlight: false,
    features: [
      { label: '300 briefings por hora', included: true },
      { label: '5.000 buscas por dia', included: true },
      { label: '10 buscas simultâneas', included: true },
      { label: 'Clientes ilimitados', included: true },
      { label: 'Mensagem WhatsApp (clipboard)', included: true },
      { label: 'Filtro de amenidades', included: true },
      { label: 'Notas pessoais por imóvel', included: true },
      { label: 'Analytics de conversão', included: true },
    ],
    extras: [
      'WhatsApp Cloud API (2.000 envios/dia)',
      'Gestão de equipe',
      'Integração CRM',
      'Upload de planilha de parceiros',
    ],
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F8F8F8] text-[#374557]">
      {/* Nav */}
      <header className="border-b border-[#CCCCCC] bg-white sticky top-0 z-40">
        <div className="mx-auto max-w-5xl px-6 flex items-center justify-between h-16">
          <span className="text-xl font-bold text-[#1921FA] tracking-tight">
            PropMatch<span className="text-[#FF8D0E]"> AI</span>
          </span>
          <nav className="flex items-center gap-4">
            <a href="#como-funciona" className="text-sm font-medium text-[#666666] hover:text-[#1921FA] transition-colors hidden sm:inline">
              Como funciona
            </a>
            <a href="#planos" className="text-sm font-medium text-[#666666] hover:text-[#1921FA] transition-colors hidden sm:inline">
              Planos
            </a>
            <Link href="/login" className="text-sm font-medium text-[#666666] hover:text-[#1921FA] transition-colors">
              Entrar
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-[#1921FA] px-4 py-2 text-sm font-semibold text-white hover:bg-[#050cdb] transition-colors"
            >
              Criar conta grátis
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#1921FA]/10 px-4 py-1.5 text-sm font-medium text-[#1921FA] mb-6">
          <TrendingUp className="h-4 w-4" />
          Inteligência imobiliária para corretores
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-[#374557] mb-6">
          Encontre o imóvel certo<br />
          para cada cliente em{' '}
          <span className="text-[#1921FA]">segundos</span>
        </h1>
        <p className="text-lg text-[#666666] max-w-2xl mx-auto mb-10 leading-relaxed">
          O PropMatch AI varre múltiplos portais, calcula o percentual de match com o perfil do
          seu cliente e gera a mensagem WhatsApp na hora. Você fecha mais vendas, inclusive em parceria.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-xl bg-[#1921FA] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#050cdb] transition-colors shadow-lg shadow-[#1921FA]/20"
          >
            Começar gratuitamente
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-[#CCCCCC] bg-white px-6 py-3.5 text-sm font-semibold text-[#374557] hover:border-[#1921FA]/40 hover:text-[#1921FA] transition-colors"
          >
            Já tenho conta
          </Link>
        </div>
        <p className="mt-4 text-xs text-[#89879f]">Sem cartão de crédito. Cancele quando quiser.</p>
      </section>

      {/* Match % visual demo */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="rounded-2xl border border-[#CCCCCC] bg-white shadow-sm overflow-hidden">
          <div className="border-b border-[#CCCCCC] bg-[#F8F8F8] px-6 py-3 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-[#FF5E5E]" />
            <div className="h-3 w-3 rounded-full bg-[#FF9F00]" />
            <div className="h-3 w-3 rounded-full bg-[#4FD66E]" />
            <span className="ml-3 text-xs text-[#89879f] font-mono">propmatch.com.br/briefings/resultado</span>
          </div>
          <div className="p-6 grid sm:grid-cols-3 gap-4">
            {[
              { score: 94, label: 'Apto 2 dorm · Leblon', price: 'R$ 820.000', detail: '68 m² · 1 vaga · Mobiliado', color: '#4FD66E', img: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400&h=224&fit=crop&auto=format' },
              { score: 78, label: 'Apto 2 dorm · Botafogo', price: 'R$ 790.000', detail: '62 m² · 1 vaga', color: '#FF9F00', img: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=400&h=224&fit=crop&auto=format' },
              { score: 61, label: 'Apto 2 dorm · Barra da Tijuca', price: 'R$ 850.000', detail: '71 m² · 2 vagas', color: '#FF9F00', img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&h=224&fit=crop&auto=format' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-[#CCCCCC] overflow-hidden">
                <div className="h-28 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.img} alt={item.label} className="w-full h-full object-cover" />
                  <span
                    className="absolute top-2 right-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow"
                    style={{ backgroundColor: item.color }}
                  >
                    <TrendingUp className="h-3 w-3" />
                    {item.score}%
                  </span>
                </div>
                <div className="p-3 space-y-1">
                  <p className="text-sm font-semibold text-[#374557]">{item.price}</p>
                  <p className="text-xs text-[#666666]">{item.label}</p>
                  <p className="text-xs text-[#89879f]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-bold text-center text-[#374557] mb-3">
          Como funciona
        </h2>
        <p className="text-center text-[#666666] mb-12 max-w-xl mx-auto">
          Da mensagem do cliente ao WhatsApp em menos de 10 segundos.
        </p>
        <div className="grid sm:grid-cols-3 gap-8 relative">
          {/* connector line — desktop only */}
          <div className="hidden sm:block absolute top-8 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px bg-[#CCCCCC]" />
          {HOW_IT_WORKS.map((step) => (
            <div key={step.step} className="flex flex-col items-center text-center space-y-3 relative">
              <div className="w-16 h-16 rounded-2xl bg-[#1921FA] flex items-center justify-center shadow-lg shadow-[#1921FA]/20 relative z-10">
                <step.icon className="h-7 w-7 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#1921FA] uppercase tracking-widest mb-1">Passo {step.step}</p>
                <h3 className="font-semibold text-[#374557] mb-1">{step.title}</h3>
                <p className="text-sm text-[#666666] leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-2xl font-bold text-center text-[#374557] mb-10">
            Tudo que o corretor moderno precisa
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-[#CCCCCC] p-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1921FA]/10">
                  <f.icon className="h-5 w-5 text-[#1921FA]" />
                </div>
                <h3 className="font-semibold text-[#374557]">{f.title}</h3>
                <p className="text-sm text-[#666666] leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="planos" className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-2xl font-bold text-center text-[#374557] mb-3">
          Planos e preços
        </h2>
        <p className="text-center text-[#666666] mb-12 max-w-xl mx-auto">
          Comece grátis. Escale conforme sua carteira de clientes crescer.
        </p>
        <div className="grid sm:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-6 flex flex-col ${
                plan.highlight
                  ? 'border-[#1921FA] bg-[#1921FA] text-white shadow-xl shadow-[#1921FA]/20 scale-[1.02]'
                  : 'border-[#CCCCCC] bg-white'
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-bold uppercase tracking-widest text-[#FF8D0E] mb-3">
                  Mais popular
                </div>
              )}
              <div className="mb-4">
                <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-white/70' : 'text-[#89879f]'}`}>
                  {plan.name}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-bold ${plan.highlight ? 'text-white' : 'text-[#374557]'}`}>
                    {plan.price}
                  </span>
                  <span className={`text-sm ${plan.highlight ? 'text-white/60' : 'text-[#89879f]'}`}>
                    {plan.priceDetail}
                  </span>
                </div>
                <p className={`text-sm mt-2 ${plan.highlight ? 'text-white/70' : 'text-[#666666]'}`}>
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f.label} className="flex items-center gap-2.5 text-sm">
                    {f.included ? (
                      <CheckCircle className={`h-4 w-4 shrink-0 ${plan.highlight ? 'text-[#4FD66E]' : 'text-[#4FD66E]'}`} />
                    ) : (
                      <X className={`h-4 w-4 shrink-0 ${plan.highlight ? 'text-white/30' : 'text-[#CCCCCC]'}`} />
                    )}
                    <span className={f.included ? (plan.highlight ? 'text-white/90' : 'text-[#374557]') : (plan.highlight ? 'text-white/40' : 'text-[#89879f]')}>
                      {f.label}
                    </span>
                  </li>
                ))}
                {'extras' in plan && plan.extras && plan.extras.map((e) => (
                  <li key={e} className="flex items-center gap-2.5 text-sm">
                    <CheckCircle className="h-4 w-4 shrink-0 text-[#4FD66E]" />
                    <span className="text-[#374557]">{e}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={`w-full rounded-xl py-3 text-sm font-semibold text-center transition-colors ${
                  plan.highlight
                    ? 'bg-white text-[#1921FA] hover:bg-white/90'
                    : 'bg-[#1921FA] text-white hover:bg-[#050cdb]'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-[#89879f] mt-6">
          Todos os planos incluem cancelamento a qualquer momento. Pagamento via cartão ou PIX.
        </p>
      </section>

      {/* CTA final */}
      <section className="bg-[#1921FA] py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Pronto para fechar mais vendas?
          </h2>
          <p className="text-white/70 mb-8 max-w-md mx-auto">
            Junte-se aos corretores que já economizam 38 horas por mês com o PropMatch AI.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#1921FA] hover:bg-white/90 transition-colors shadow-lg"
            >
              Criar conta grátis agora
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Já tenho conta
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/60">
            {[
              'Sem cartão de crédito',
              'Cancele quando quiser',
              'Suporte em português',
              'Dados protegidos pela LGPD',
            ].map((b) => (
              <li key={b} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-[#4FD66E] shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#CCCCCC] bg-white">
        <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#89879f]">
          <span>
            <strong className="text-[#1921FA]">PropMatch AI</strong> — Inteligência para corretores
          </span>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
            <a href="#planos" className="hover:text-[#374557] transition-colors">Planos</a>
            <a href="https://status.propmatch.com.br" target="_blank" rel="noopener noreferrer" className="hover:text-[#374557] transition-colors">
              Status
            </a>
            <Link href="/privacy" className="hover:text-[#374557] transition-colors">Privacidade</Link>
            <Link href="/terms" className="hover:text-[#374557] transition-colors">Termos de uso</Link>
            <a href="mailto:suporte@propmatch.com.br" className="hover:text-[#374557] transition-colors">Suporte</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
