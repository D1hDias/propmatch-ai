import Link from 'next/link';
import { CreditCard, Shield, User } from 'lucide-react';

export const metadata = { title: 'Configurações — PropMatch AI' };

const sections = [
  {
    href: '/settings/billing',
    icon: CreditCard,
    title: 'Plano e cobrança',
    description: 'Gerencie sua assinatura, veja o plano atual e histórico de pagamentos.',
  },
  {
    href: '/settings/privacy',
    icon: Shield,
    title: 'Privacidade e LGPD',
    description: 'Solicite exportação dos seus dados ou exclusão da conta.',
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie sua conta e preferências.</p>
      </div>

      <div className="space-y-3">
        {sections.map(({ href, icon: Icon, title, description }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-muted/30 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <User className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors rotate-[-90deg]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
