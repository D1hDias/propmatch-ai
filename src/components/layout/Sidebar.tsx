'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  History,
  MessageCircle,
  User,
  Zap,
  Settings,
  Building2,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Seu Espaço',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Clientes', href: '/clients', icon: Users },
    ],
  },
  {
    title: 'Ferramentas',
    items: [
      { label: 'Histórico', href: '/historico', icon: History },
      { label: 'Mensagens WhatsApp', href: '/mensagens', icon: MessageCircle },
      { label: 'Imobiliárias', href: '/imobi', icon: Building2 },
    ],
  },
  {
    title: 'Conta',
    items: [
      { label: 'Perfil', href: '/settings/profile', icon: User },
      { label: 'Plano & Billing', href: '/settings/billing', icon: Zap },
      { label: 'Privacidade', href: '/settings/privacy', icon: Settings },
    ],
  },
];

interface SidebarNavProps {
  onLinkClick?: () => void;
}

export function SidebarNav({ onLinkClick }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-7 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <span className="text-white font-bold text-lg leading-tight">PropMatch AI</span>
      </div>

      {/* Nova Busca CTA */}
      <div className="px-4 pb-4">
        <Link
          href="/busca"
          onClick={onLinkClick}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white text-primary font-semibold text-sm hover:bg-white/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova Busca
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-3 mb-2 text-xs font-semibold tracking-widest uppercase text-white/40">
              {section.title}
            </p>
            <ul className="space-y-1" role="list">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onLinkClick}
                      className={cn(
                        'flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-white/80 transition-colors',
                        isActive
                          ? 'bg-white/15 text-white'
                          : 'hover:bg-white/7 hover:text-white',
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside
      className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-sidebar bg-primary z-30"
      aria-label="Navegação principal"
    >
      <SidebarNav />
    </aside>
  );
}
