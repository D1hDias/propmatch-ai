import { BriefingForm } from '@/components/briefings/BriefingForm';

export const metadata = { title: 'Novo Briefing — PropMatch AI' };

export default function NewBriefingPage() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Novo Briefing</h2>
        <p className="text-muted-foreground mt-1">
          Preencha os critérios do cliente para iniciar a busca nos parceiros.
        </p>
      </div>

      <BriefingForm />
    </div>
  );
}
