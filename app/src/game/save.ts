import { CHARACTERS, LEVELS, type CharacterId } from "./content";
import { GAME_CONFIG } from "./config";
import { storage } from "./storage";
import type { SaveData } from "./types";

const KEY = "cotton-candy.save";
const LEVEL_IDS = new Set(LEVELS.map((level) => level.id));
const CHARACTER_IDS = new Set(CHARACTERS.map((character) => character.id));

export function defaultSave(): SaveData {
  return { version: GAME_CONFIG.SAVE_VERSION, completed: [], notes: [], bestConcert: 0, selected: "marina" };
}

export function loadSave(): SaveData {
  const raw = storage.get<Partial<SaveData>>(KEY, {});
  const clean = defaultSave();
  if (Array.isArray(raw.completed)) clean.completed = [...new Set(raw.completed.filter((id): id is string => typeof id === "string" && LEVEL_IDS.has(id)))];
  if (Array.isArray(raw.notes)) clean.notes = [...new Set(raw.notes.filter((id): id is string => typeof id === "string" && id.length < 64))];
  if (typeof raw.bestConcert === "number" && Number.isFinite(raw.bestConcert)) clean.bestConcert = Math.max(0, Math.min(100, raw.bestConcert));
  if (typeof raw.selected === "string" && CHARACTER_IDS.has(raw.selected as CharacterId)) clean.selected = raw.selected as CharacterId;
  return clean;
}

export function writeSave(save: SaveData): void { storage.set(KEY, save); }
export function resetSave(): void { storage.remove(KEY); }
