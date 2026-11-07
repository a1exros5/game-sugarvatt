import type { CharacterId } from "./content";

export type SfxId = "hit" | "pickup" | "ui" | "ability" | "win" | "lose" | "switch" | "note" | "miss";

const MUTE_KEY = "cotton-candy.muted";
const ROOTS: Record<CharacterId, number> = { marina: 110, zhenya: 123.47, alisa: 130.81, anya: 82.41 };
const MELODY = [1, 1.5, 2, 1.5, 2.5, 2, 1.5, 1.25];

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

/** Procedural chiptune score and synthesized effects; no external audio files. */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private disposed = false;
  private musicWanted = false;
  private beatClock = 0;
  private step = 0;
  muted = readMuted();

  private readonly unlock = () => {
    this.ensureCtx();
    this.detachUnlock();
  };

  constructor() {
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  private detachUnlock(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.42;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  startMusic(): void { this.musicWanted = true; }
  stopMusic(): void { this.musicWanted = false; this.beatClock = 0; }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch { /* browser-local fallback */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.42;
    return this.muted;
  }

  update(dt: number, character: CharacterId, intensity = 0): void {
    if (!this.musicWanted || this.muted || this.disposed || !this.ctx) return;
    this.beatClock -= dt;
    if (this.beatClock > 0) return;
    const tempo = intensity >= 2 ? 0.17 : intensity === 1 ? 0.205 : 0.235;
    this.beatClock += tempo;
    const root = ROOTS[character];
    const step = this.step++ % 16;
    if (step % 2 === 0) this.tone(root * (step % 8 === 6 ? 1.5 : 1), tempo * 1.6, "triangle", 0.038);
    this.tone(root * 2 * MELODY[(step / 2) | 0], tempo * 0.75, "square", intensity >= 2 ? 0.026 : 0.016);
    if (step % 4 === 2) this.noise(0.025, 0.012 + intensity * 0.004);
    if (intensity >= 2 && step % 2 === 1) this.tone(root * 4, 0.035, "square", 0.012);
  }

  sfx(id: SfxId): void {
    if (this.disposed || this.muted) return;
    this.ensureCtx();
    const specs: Record<SfxId, [OscillatorType, number, number, number, number]> = {
      hit: ["square", 150, 55, 0.13, 0.15],
      pickup: ["sine", 620, 1180, 0.14, 0.12],
      ui: ["square", 380, 520, 0.055, 0.07],
      ability: ["sawtooth", 210, 90, 0.16, 0.10],
      win: ["sine", 520, 1040, 0.48, 0.14],
      lose: ["sawtooth", 180, 45, 0.55, 0.12],
      switch: ["square", 320, 720, 0.11, 0.10],
      note: ["sine", 700, 920, 0.06, 0.07],
      miss: ["triangle", 130, 90, 0.07, 0.05],
    };
    const [type, from, to, duration, gain] = specs[id];
    this.tone(from, duration, type, gain, to);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, endFrequency?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const time = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), time);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
  }

  private noise(duration: number, volume: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const length = Math.max(1, (this.ctx.sampleRate * duration) | 0);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic alternating noise avoids Math.random in the game runtime.
    for (let i = 0; i < length; i++) data[i] = (((i * 37 + this.step * 17) % 101) / 50.5 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    source.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachUnlock();
    this.master?.disconnect();
    this.master = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
  }
}
