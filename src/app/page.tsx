import { SimulationCanvas } from '@/components/SimulationCanvas';

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-emerald-400/80">
            Traffic engine · Etapa 8 — scenario control
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Urban Flow</h1>
          <p className="mt-2 max-w-prose text-neutral-400">
            An agent-based mobility simulation on a deterministic fixed-step engine. A one-way
            Manhattan grid: cars enter from the edges, are routed by shortest path (Dijkstra) to an
            exit, and turn and give way at each junction. Now interactive — close roads, drop
            incidents, retune demand and destinations, flip priorities, add traffic signals, and
            compare throughput before and after. Colour encodes speed, green (free flow) to red
            (stopped).
          </p>
        </header>
        <SimulationCanvas />
      </div>
    </main>
  );
}
