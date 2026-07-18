import { SimulationCanvas } from '@/components/SimulationCanvas';
import { SCENARIO_PARAM } from '@/render/shareLink';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)[SCENARIO_PARAM];
  const scenarioParam = typeof raw === 'string' ? raw : null;

  return (
    <main className="min-h-dvh lg:h-dvh">
      <SimulationCanvas scenarioParam={scenarioParam} />
    </main>
  );
}
