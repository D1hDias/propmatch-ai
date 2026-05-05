'use client';

import { useState } from 'react';
import { Sidebar, SidebarNav } from './Sidebar';
import { Header } from './Header';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface AppShellProps {
  children: React.ReactNode;
  pageTitle?: string;
}

export function AppShell({ children, pageTitle }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile sidebar via Sheet */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          className="w-sidebar p-0 bg-primary border-none"
          aria-label="Menu de navegação"
        >
          <SidebarNav onLinkClick={() => setMobileSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Header */}
      <Header
        onMenuClick={() => setMobileSidebarOpen(true)}
        pageTitle={pageTitle}
      />

      {/* Main content */}
      <main
        className="lg:ml-sidebar pt-header min-h-screen"
        id="main-content"
        role="main"
      >
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
