import type { CharacterId, LevelDef } from "./content";

export type GameMode = "loading" | "title" | "select" | "playing" | "dialogue" | "paused" | "levelComplete" | "gameover" | "concert" | "finale" | "help";
export type EnemyKind = "chaser" | "patrol" | "shooter" | "blocker";

export interface Vec2 { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export interface Player {
  x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number; faceX: number; faceY: number;
  hearts: number; invulnerable: number; abilityCooldown: number;
  abilityFlash: number; abilityDuration: number; energy: number;
  walkTime: number; moving: boolean;
}

export interface Item {
  x: number; y: number; name: string; key: string;
  note: boolean; collected: boolean; phase: number;
}

export interface Enemy {
  x: number; y: number; homeX: number; homeY: number;
  vx: number; vy: number; kind: EnemyKind; hp: number;
  alive: boolean; stun: number; attackClock: number; phase: number;
  spotted: boolean;
}

export interface TaskObject {
  x: number; y: number; name: string; index: number;
  active: boolean; pulse: number;
}

export interface Projectile {
  active: boolean; x: number; y: number; vx: number; vy: number;
  life: number; hostile: boolean; color: string; size: number;
}

export interface Particle {
  active: boolean; x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string; size: number;
}

export interface SwitchPad {
  x: number; y: number; active: boolean; pulse: number;
}

export interface Boss {
  x: number; y: number; hp: number; maxHp: number;
  active: boolean; vulnerable: number; attackClock: number;
  telegraph: number; chargeTime: number; vx: number; vy: number;
  phase: number; flash: number;
}

export interface LevelRuntime {
  def: LevelDef;
  obstacles: Rect[];
  items: Item[];
  enemies: Enemy[];
  switches: SwitchPad[];
  tasks: TaskObject[];
  boss: Boss | null;
  exit: Rect;
  npc: { x: number; y: number; name: string; line: string };
  collected: number;
  returned: boolean;
  taskAnnounced: boolean;
  score: number;
  combo: number;
  comboClock: number;
  elapsed: number;
  hits: number;
  hintClock: number;
}

export interface SaveData {
  version: number;
  completed: string[];
  notes: string[];
  bestConcert: number;
  selected: CharacterId;
}

export interface UiButton {
  x: number; y: number; w: number; h: number;
  label: string; action: string; enabled: boolean; sub?: string;
}

export interface ConcertNote {
  time: number; lane: number; hit: boolean; missed: boolean;
}

export interface ConcertRuntime {
  time: number; notes: ConcertNote[]; score: number; combo: number;
  maxCombo: number; hits: number; misses: number; laneFlash: number[];
  finished: boolean;
}
