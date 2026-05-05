import { BriefingForm } from '@/components/briefings/BriefingForm';

export const metadata = { title: 'Novo Briefing — PropMatch AI' };

export default function NewBriefingPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Novo Briefing</h2>
        <p className="text-muted-foreground mt-1">
          Cole a mensagem do cliente e a IA extrai os critérios automaticamente.
        </p>
      </div>

      <div className="bg-card rounded-xl shadow-card p-6 lg:p-8">
        <BriefingForm />
      </div>
    </div>
  );
}
