'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Menu, ChevronDown, LogOut, User, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const MOCK_USER = {
  name: 'Diego Dias',
  email: 'dihdias1987@gmail.com',
  initials: 'DD',
};

interface HeaderProps {
  onMenuClick: () => void;
  pageTitle?: string;
}

export function Header({ onMenuClick, pageTitle = 'Dashboard' }: HeaderProps) {
  const router = useRouter();

  function handleLogout() {
    localStorage.removeItem('access_token');
    fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
      router.push('/login');
    });
  }

  return (
    <header
      className="fixed top-0 right-0 left-0 lg:left-sidebar h-header bg-white border-b border-border z-20 flex items-center px-6 lg:px-8 gap-4 shadow-header"
      role="banner"
    >
      {/* Mobile hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden text-muted-foreground hover:text-foreground"
        onClick={onMenuClick}
        aria-label="Abrir menu"
      >
        <Menu className="w-6 h-6" />
      </Button>

      {/* Page title */}
      <h1 className="text-base font-semibold text-foreground flex-1 lg:flex-none">{pageTitle}</h1>

      <div className="flex-1 hidden lg:block" />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label="Notificações"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-secondary" />
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="Menu do usuário"
            >
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary text-white text-xs font-semibold">
                  {MOCK_USER.initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block text-left">
                <p className="text-sm font-semibold text-foreground leading-none">{MOCK_USER.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-none">{MOCK_USER.email}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground ml-1" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 shadow-dropdown">
            <DropdownMenuLabel>
              <p className="text-sm font-semibold">{MOCK_USER.name}</p>
              <p className="text-xs text-muted-foreground font-normal">{MOCK_USER.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2 cursor-pointer">
              <Link href="/settings/profile">
                <User className="w-4 h-4" />
                Perfil
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="gap-2 cursor-pointer">
              <Link href="/settings">
                <Settings className="w-4 h-4" />
                Configurações
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 cursor-pointer text-danger focus:text-danger focus:bg-red-50"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
