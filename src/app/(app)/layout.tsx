import { AppShell } from '@/components/layout/AppShell';
import { OnboardingTour } from '@/components/onboarding/OnboardingTour';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      <OnboardingTour />
    </AppShell>
  );
}
