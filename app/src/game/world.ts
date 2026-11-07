import { CHARACTERS, type LevelDef } from "./content";
import { GAME_CONFIG } from "./config";
import type { Enemy, EnemyKind, Item, LevelRuntime, Rect, SwitchPad, TaskObject } from "./types";

export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function generateLevel(def: LevelDef, collectedNotes: string[]): LevelRuntime {
  const random = mulberry32(hashText(def.id));
  const W = GAME_CONFIG.WORLD_WIDTH;
  const H = GAME_CONFIG.WORLD_HEIGHT;
  const obstacles: Rect[] = [
    { x: 0, y: 0, w: W, h: 24 }, { x: 0, y: H - 24, w: W, h: 24 },
    { x: 0, y: 0, w: 24, h: H }, { x: W - 24, y: 0, w: 24, h: H },
  ];

  if (def.stage === "boss") {
    obstacles.push(
      { x: 240, y: 100, w: 42, h: 42 }, { x: 730, y: 390, w: 42, h: 42 },
      { x: 240, y: 410, w: 42, h: 28 }, { x: 790, y: 90, w: 38, h: 54 },
    );
  } else {
    const rows = def.stage === "home" ? [82, 404] : def.stage === "street" ? [112, 382] : [72, 420];
    for (let i = 0; i < 8; i++) {
      const column = i % 4;
      const row = i < 4 ? 0 : 1;
      const width = 46 + ((random() * 48) | 0);
      const height = 30 + ((random() * 28) | 0);
      obstacles.push({
        x: 170 + column * 185 + ((random() * 30) | 0),
        y: rows[row] + ((random() * 28) | 0), w: width, h: height,
      });
    }
    obstacles.push({ x: 375, y: 220, w: 64, h: 42 }, { x: 650, y: 300, w: 54, h: 54 });
  }

  const exit: Rect = { x: W - 58, y: H / 2 - 34, w: 34, h: 68 };
  const npc = { x: 94, y: 100, name: def.npcName, line: def.npc };
  const slots: { x: number; y: number }[] = [];
  for (const y of [64, 158, 260, 356, 460]) {
    for (const x of [142, 260, 390, 520, 650, 780, 866]) slots.push({ x, y });
  }
  shuffle(slots, random);
  let slotIndex = 0;
  const takePosition = (awayFromSpawn = false): { x: number; y: number } => {
    for (let attempts = 0; attempts < slots.length * 2; attempts++) {
      const point = slots[slotIndex++ % slots.length];
      if (awayFromSpawn && Math.hypot(point.x - 70, point.y - H / 2) < 230) continue;
      if (Math.hypot(point.x - npc.x, point.y - npc.y) < 55) continue;
      if (point.x > W - 105 && Math.abs(point.y - H / 2) < 85) continue;
      if (!obstacles.some((rect) => pointInExpandedRect(point.x, point.y, rect, 18))) return point;
    }
    return { x: 110 + (slotIndex * 137) % 720, y: 70 + (slotIndex * 83) % 390 };
  };

  const items: Item[] = [];
  def.items.forEach((name, index) => {
    const point = takePosition();
    items.push({ x: point.x, y: point.y, name, key: `${def.id}:item:${index}`, note: false, collected: false, phase: random() * 6.28 });
  });
  for (let index = 0; index < 3; index++) {
    const point = takePosition();
    const key = `${def.id}:note:${index}`;
    items.push({ x: point.x, y: point.y, name: "Сахарная нота", key, note: true, collected: collectedNotes.includes(key), phase: random() * 6.28 });
  }

  const tasks: TaskObject[] = def.task.names.map((name, index) => {
    const point = takePosition();
    return { x: point.x, y: point.y, name, index, active: false, pulse: 0 };
  });

  const charIndex = CHARACTERS.findIndex((character) => character.id === def.char);
  const enemyCount = def.stage === "boss" ? 3 : Math.min(GAME_CONFIG.MAX_ENEMIES, 2 + def.chapter + (charIndex > 1 ? 1 : 0));
  const enemies: Enemy[] = [];
  const kinds: EnemyKind[] = ["chaser", "patrol", "shooter", "blocker"];
  for (let index = 0; index < enemyCount; index++) {
    const point = takePosition(true);
    enemies.push({
      x: point.x, y: point.y, homeX: point.x, homeY: point.y, vx: 0, vy: 0,
      kind: kinds[(index + charIndex + def.chapter) % kinds.length], hp: index % 4 === 3 ? 2 : 1,
      alive: true, stun: 0, attackClock: 1 + random() * 1.5, phase: random() * 6.28, spotted: false,
    });
  }

  const switches: SwitchPad[] = def.stage === "boss" ? [
    { x: 510, y: 150, active: false, pulse: 0 },
    { x: 760, y: 270, active: false, pulse: 0 },
    { x: 510, y: 398, active: false, pulse: 0 },
  ] : [];

  return {
    def, obstacles, items, enemies, switches, tasks, exit, npc,
    collected: 0, returned: false, taskAnnounced: false, score: 0, combo: 0, comboClock: 0,
    elapsed: 0, hits: 0, hintClock: 0,
    boss: def.stage === "boss" ? {
      x: 630, y: 272, hp: 3, maxHp: 3, active: true, vulnerable: 0, attackClock: 1.8,
      telegraph: 0, chargeTime: 0, vx: 0, vy: 0, phase: 0, flash: 0,
    } : null,
  };
}

export function circleRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function moveWithCollisions(body: { x: number; y: number }, dx: number, dy: number, radius: number, obstacles: Rect[]): void {
  body.x += dx;
  for (const rect of obstacles) {
    if (!circleRect(body.x, body.y, radius, rect)) continue;
    body.x = dx > 0 ? rect.x - radius : rect.x + rect.w + radius;
  }
  body.y += dy;
  for (const rect of obstacles) {
    if (!circleRect(body.x, body.y, radius, rect)) continue;
    body.y = dy > 0 ? rect.y - radius : rect.y + rect.h + radius;
  }
}

function pointInExpandedRect(x: number, y: number, rect: Rect, padding: number): boolean {
  return x > rect.x - padding && x < rect.x + rect.w + padding && y > rect.y - padding && y < rect.y + rect.h + padding;
}

function shuffle<T>(array: T[], random: () => number): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [array[i], array[j]] = [array[j], array[i]];
  }
}
