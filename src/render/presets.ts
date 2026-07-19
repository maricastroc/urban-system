import { toggleLaneClosed, toggleSignal, greenWave, type Scene } from './scene';

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly tone: 'warn' | 'bad' | 'accent';
  readonly demandRate: number;
  readonly stage?: (scene: Scene) => void;
}

export function centralJunction(scene: Scene): number {
  const js = scene.junctions;
  let cx = 0;
  let cy = 0;
  for (const j of js) {
    cx += j.pos.x;
    cy += j.pos.y;
  }
  cx /= js.length;
  cy /= js.length;
  let best = 0;
  let bestD = Infinity;
  js.forEach((j, i) => {
    const d = (j.pos.x - cx) ** 2 + (j.pos.y - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function centralArteryLane(scene: Scene): number {
  const j = scene.junctions[centralJunction(scene)];
  const ap = j.approaches.find((a) => a.fromLane >= 0);
  return ap ? ap.fromLane : -1;
}

/** The longest corridor through the central junction (ties → the earlier/H one). */
function centralCorridor(scene: Scene): number {
  const jc = centralJunction(scene);
  let best = -1;
  let bestLen = 0;
  scene.corridors.forEach((cor, i) => {
    if (cor.junctions.includes(jc) && cor.junctions.length > bestLen) {
      bestLen = cor.junctions.length;
      best = i;
    }
  });
  return best;
}

export const PRESETS: Preset[] = [
  {
    id: 'rush',
    label: 'Rush hour',
    desc: 'Every entry flooded — watch the grid saturate.',
    tone: 'warn',
    demandRate: 1.5,
  },
  {
    id: 'artery',
    label: 'Close the artery',
    desc: 'Shut the central road; new traffic reroutes around it.',
    tone: 'bad',
    demandRate: 0.8,
    stage: (scene) => {
      const lane = centralArteryLane(scene);
      if (lane >= 0 && scene.world.control.laneClosed[lane] !== 1) toggleLaneClosed(scene, lane);
    },
  },
  {
    id: 'signal',
    label: 'Signalize the centre',
    desc: 'Traffic lights on the middle junction vs. give-way.',
    tone: 'accent',
    demandRate: 1.1,
    stage: (scene) => {
      const j = centralJunction(scene);
      if (scene.signals[j]?.enabled !== true) toggleSignal(scene, j);
    },
  },
  {
    id: 'wave',
    label: 'Green-wave the artery',
    desc: 'Coordinate signals along the central corridor into a green wave.',
    tone: 'accent',
    demandRate: 1.2,
    stage: (scene) => {
      const i = centralCorridor(scene);
      if (i >= 0 && scene.coordinated[i] === 0) greenWave(scene, i);
    },
  },
];
