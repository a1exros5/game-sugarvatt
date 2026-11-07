import { CottonCandyGame } from "./game";
import type { CharacterId } from "./content";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __gameStats?: () => { fps: number; enemies: number; projectiles: number; particles: number; mode: string; canvas: { width: number; height: number } };
    __gameDebug?: {
      state: () => string;
      startLevel: (character: CharacterId, chapter: number) => void;
      completeLevel: () => void;
      unlockAll: () => void;
      gameover: () => void;
      startConcert: () => void;
      finishConcert: () => void;
      damage: () => void;
      charge: () => void;
      teleport: (x: number, y: number) => void;
      defeatBoss: () => void;
      snapshot: () => unknown;
    };
  }
}

let session: CottonCandyGame | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  session = new CottonCandyGame(canvas);
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}
