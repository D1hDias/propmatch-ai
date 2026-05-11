import Link from 'next/link';
import { TrendingUp, Search, Users, Bell, ArrowRight, CheckCircle2 } from 'lucide-react';

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

const BENEFITS = [
  'Clientes que você perderia viram vendas',
  'Menos tempo vasculhando portais manualmente',
  'Parcerias B2B que você não encontraria sozinho',
  'CRM de perfis ativos com re-scan automático',
  'Mensagem WhatsApp gerada e formatada automaticamente',
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F8F8F8] text-[#374557]">
      {/* Nav */}
      <header className="border-b border-[#CCCCCC] bg-white">
        <div className="mx-auto max-w-5xl px-6 flex items-center justify-between h-16">
          <span className="text-xl font-bold text-[#1921FA] tracking-tight">
            PropMatch<span className="text-[#FF8D0E]"> AI</span>
          </span>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-[#666666] hover:text-[#1921FA] transition-colors"
            >
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
              { score: 94, label: 'Apto 2 dorm · Moema', price: 'R$ 820.000', detail: '68 m² · 1 vaga · Mobiliado', color: '#4FD66E' },
              { score: 78, label: 'Apto 2 dorm · Vila Mariana', price: 'R$ 790.000', detail: '62 m² · 1 vaga', color: '#FF9F00' },
              { score: 61, label: 'Apto 2 dorm · Ibirapuera', price: 'R$ 850.000', detail: '71 m² · 2 vagas', color: '#FF9F00' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-[#CCCCCC] overflow-hidden">
                <div className="h-28 bg-gradient-to-br from-[#e9ecef] to-[#dee2e6] relative">
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

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-2xl font-bold text-center text-[#374557] mb-10">
          Tudo que o corretor moderno precisa
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-[#CCCCCC] bg-white p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1921FA]/10">
                <f.icon className="h-5 w-5 text-[#1921FA]" />
              </div>
              <h3 className="font-semibold text-[#374557]">{f.title}</h3>
              <p className="text-sm text-[#666666] leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits list */}
      <section className="bg-[#1921FA] py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-8">
            Por que usar o PropMatch AI?
          </h2>
          <ul className="grid sm:grid-cols-2 gap-3 text-left max-w-2xl mx-auto">
            {BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-3 text-white/90 text-sm">
                <CheckCircle2 className="h-5 w-5 text-[#4FD66E] flex-shrink-0 mt-0.5" />
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-[#1921FA] hover:bg-white/90 transition-colors shadow-lg"
            >
              Criar conta grátis agora
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#CCCCCC] bg-white">
        <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#89879f]">
          <span>
            <strong className="text-[#1921FA]">PropMatch AI</strong> — Inteligência para corretores
          </span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-[#374557] transition-colors">
              Privacidade
            </Link>
            <Link href="/terms" className="hover:text-[#374557] transition-colors">
              Termos de uso
            </Link>
            <a href="mailto:suporte@propmatch.com.br" className="hover:text-[#374557] transition-colors">
              Suporte
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
