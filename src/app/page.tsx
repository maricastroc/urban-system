import { SimulationCanvas } from '@/components/SimulationCanvas';
import { SCENARIO_PARAM } from '@/render/shareLink';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp[SCENARIO_PARAM];
  const scenarioParam = typeof raw === 'string' ? raw : null;

  const debug = sp.debug !== undefined || sp.perf !== undefined;
  const num = (v: string | string[] | undefined): number | null =>
    typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

  return (
    <main className="min-h-dvh lg:h-dvh">
      <SimulationCanvas scenarioParam={scenarioParam} debug={debug} grid={num(sp.grid)} cap={num(sp.cap)} />
    </main>
  );
}
