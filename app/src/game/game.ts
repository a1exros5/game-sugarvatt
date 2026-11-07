import { AudioSystem } from "./audio";
import { CHARACTERS, ENEMY_NAMES, LEVELS, characterById, levelsFor, type CharacterId, type LevelDef, type SceneId } from "./content";
import { GAME_CONFIG, PALETTE, QUALITY } from "./config";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { loadSave, resetSave, writeSave } from "./save";
import type { ConcertRuntime, Enemy, GameMode, Item, Particle, Player, Projectile, Rect, SaveData, TaskObject, UiButton } from "./types";
import { circleRect, generateLevel, moveWithCollisions } from "./world";

const THEMES: Record<SceneId, { floor: string; tile: string; wall: string; top: string; accent: string }> = {
  marinaRoom: { floor: "#745444", tile: "#7d5c49", wall: "#3b2930", top: "#a9785e", accent: "#ffd0dc" },
  courtyard: { floor: "#4f6f58", tile: "#587961", wall: "#303c35", top: "#8c9b69", accent: "#ffd166" },
  rehearsal: { floor: "#483444", tile: "#523b4c", wall: "#241c2a", top: "#76546d", accent: "#f5a3c7" },
  underpass: { floor: "#334c55", tile: "#3a5660", wall: "#1e2c36", top: "#527784", accent: "#6fe1dc" },
  garage: { floor: "#515158", tile: "#595960", wall: "#2c2b33", top: "#7c7979", accent: "#ffd166" },
  musicShop: { floor: "#6b4c48", tile: "#745550", wall: "#34272c", top: "#a47764", accent: "#ffd166" },
  workshop: { floor: "#4a4641", tile: "#544e47", wall: "#29272a", top: "#807460", accent: "#ffab66" },
  nightStreet: { floor: "#29374e", tile: "#303e56", wall: "#191e31", top: "#485577", accent: "#ff91c8" },
  alisaRoom: { floor: "#76576e", tile: "#806075", wall: "#3b293d", top: "#aa7c96", accent: "#ffd0e6" },
  cafe: { floor: "#765846", tile: "#80614c", wall: "#3d2c31", top: "#b38263", accent: "#ffcc9d" },
  theatre: { floor: "#55303f", tile: "#603747", wall: "#2b1c2b", top: "#8e4860", accent: "#ff91c8" },
  park: { floor: "#476553", tile: "#506e5b", wall: "#2a3a35", top: "#7c9569", accent: "#ffc4d9" },
  anyaRoom: { floor: "#403a50", tile: "#494258", wall: "#24212f", top: "#6b5e7b", accent: "#c39bd3" },
  repairGarage: { floor: "#4e5145", tile: "#575a4c", wall: "#2c302b", top: "#7a7e62", accent: "#d1b67a" },
  parking: { floor: "#383c48", tile: "#40444f", wall: "#232630", top: "#626777", accent: "#c39bd3" },
  busRoute: { floor: "#33434f", tile: "#3b4b57", wall: "#202d37", top: "#5d737b", accent: "#e1b6df" },
};

export class CottonCandyGame {
  private ctx: CanvasRenderingContext2D;
  private input: Input;
  private audio: AudioSystem;
  private loop: GameLoop;
  private mode: GameMode = "loading";
  private previousMode: GameMode = "title";
  private save: SaveData = loadSave();
  private selectedIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === this.save.selected));
  private level: ReturnType<typeof generateLevel> | null = null;
  private player: Player = this.makePlayer();
  private images: Record<CharacterId, HTMLImageElement>;
  private loadedImages = 0;
  private camera = { x: 0, y: 0 };
  private time = 0;
  private shake = 0;
  private flash = 0;
  private bark = "";
  private barkTime = 0;
  private uiButtons: UiButton[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private concert: ConcertRuntime | null = null;
  private lowQuality = false;
  private fps = 60;
  private fpsFrames = 0;
  private fpsClock = 0;
  private lastFrameTime = performance.now();
  private disposed = false;
  private renderScale = 1;
  private viewWidth = 480;
  private viewHeight = GAME_CONFIG.LOGICAL_HEIGHT;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas2D is unavailable");
    this.ctx = context;
    this.input = new Input(canvas);
    this.audio = new AudioSystem();
    this.syncMuteButton();
    this.images = {} as Record<CharacterId, HTMLImageElement>;
    for (const character of CHARACTERS) {
      const image = new Image();
      image.src = character.sprite;
      image.onload = () => {
        this.loadedImages++;
        if (this.loadedImages === CHARACTERS.length && this.mode === "loading") this.setMode("title");
      };
      this.images[character.id] = image;
    }
    for (let i = 0; i < GAME_CONFIG.MAX_PROJECTILES; i++) this.projectiles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, hostile: true, color: "#fff", size: 3 });
    for (let i = 0; i < GAME_CONFIG.MAX_PARTICLES; i++) this.particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: "#fff", size: 2 });
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("pointerdown", this.onCanvasPointer);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.exposeDebug();
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointerdown", this.onCanvasPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    delete window.__gameProbe;
    delete window.__gameDebug;
    window.__GAME_READY__ = false;
    this.syncControls("none");
  }

  private makePlayer(): Player {
    return { x: 70, y: GAME_CONFIG.WORLD_HEIGHT / 2, prevX: 70, prevY: GAME_CONFIG.WORLD_HEIGHT / 2, vx: 0, vy: 0, faceX: 1, faceY: 0, hearts: 3, invulnerable: 0, abilityCooldown: 0, abilityFlash: 0, abilityDuration: 0.4, energy: 0, walkTime: 0, moving: false };
  }

  private resize = (): void => {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const height = GAME_CONFIG.LOGICAL_HEIGHT;
    const width = aspect < 1.2 ? 480 : Math.max(480, Math.round(height * aspect));
    this.viewWidth = width;
    this.viewHeight = height;
    this.renderScale = window.matchMedia("(pointer: fine)").matches ? 2 : 1;
    const pixelWidth = width * this.renderScale;
    const pixelHeight = height * this.renderScale;
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    this.canvas.style.width = `${Math.floor(width * scale)}px`;
    this.canvas.style.height = `${Math.floor(height * scale)}px`;
    this.ctx.imageSmoothingEnabled = false;
  };

  private onVisibility = (): void => {
    if (document.hidden && (this.mode === "playing" || this.mode === "concert")) this.setMode("paused");
  };

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.input.clearActions();
    if (mode === "playing" || mode === "dialogue") this.syncControls("game");
    else if (mode === "concert") this.syncControls("concert");
    else if (mode === "paused") this.syncControls(this.level?.def ? "game" : this.concert ? "concert" : "none");
    else this.syncControls("none");
  }

  private syncMuteButton(): void {
    const button = document.getElementById("button-mute");
    if (!button) return;
    button.textContent = this.audio.muted ? "×" : "♪";
    button.setAttribute("aria-label", this.audio.muted ? "Включить звук" : "Выключить звук");
  }

  private syncControls(mode: "game" | "concert" | "none"): void {
    const gameControls = document.getElementById("game-controls");
    const concertControls = document.getElementById("concert-controls");
    const pause = document.getElementById("button-pause");
    if (gameControls) gameControls.hidden = mode !== "game";
    if (concertControls) concertControls.hidden = mode !== "concert";
    if (pause) pause.hidden = mode === "none";
  }

  private startLevel(character: CharacterId, chapter: number): void {
    const definition = levelsFor(character)[chapter];
    if (!definition || !this.isUnlocked(definition)) return;
    this.save.selected = character;
    const abilityLabel = document.querySelector<HTMLElement>("#button-b small");
    if (abilityLabel) abilityLabel.textContent = { marina: "ДРОБЬ", zhenya: "РИФФ", alisa: "ВОКАЛ", anya: "БАС" }[character];
    this.selectedIndex = CHARACTERS.findIndex((c) => c.id === character);
    writeSave(this.save);
    this.level = generateLevel(definition, this.save.notes);
    this.player = this.makePlayer();
    this.camera.x = 0;
    this.camera.y = Math.max(0, this.player.y - this.viewHeight / 2);
    this.clearPools();
    this.concert = null;
    this.say(definition.intro, 4.5);
    this.audio.startMusic();
    this.setMode("playing");
  }

  private restartLevel(): void {
    if (!this.level) return;
    this.startLevel(this.level.def.char, this.level.def.chapter);
  }

  private completeLevel(): void {
    if (!this.level) return;
    if (!this.save.completed.includes(this.level.def.id)) this.save.completed.push(this.level.def.id);
    writeSave(this.save);
    this.audio.sfx("win");
    this.setMode("levelComplete");
  }

  private nextLevel(): void {
    if (!this.level) return;
    const { char, chapter } = this.level.def;
    if (chapter < 3) this.startLevel(char, chapter + 1);
    else this.setMode("select");
  }

  private isUnlocked(definition: LevelDef): boolean {
    if (definition.chapter === 0) return true;
    const previous = levelsFor(definition.char)[definition.chapter - 1];
    return this.save.completed.includes(previous.id);
  }

  private allArrived(): boolean { return this.save.completed.length === LEVELS.length; }

  private update(dt: number): void {
    this.time += dt;
    if (this.input.consumeAction("mute")) { this.audio.toggleMute(); this.syncMuteButton(); }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 10);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.barkTime > 0) this.barkTime -= dt;

    switch (this.mode) {
      case "title":
        if (this.input.consumeAction("Space")) this.startLevel("marina", 0);
        else if (this.input.consumeAction("interact")) this.setMode("select");
        break;
      case "select":
        if (this.input.consumeAction("pause")) this.setMode("title");
        break;
      case "help":
        if (this.input.consumeAction("pause")) this.setMode(this.previousMode === "help" ? "title" : this.previousMode);
        break;
      case "playing":
        if (this.input.consumeAction("pause")) { this.setMode("paused"); break; }
        this.updatePlaying(dt);
        break;
      case "dialogue":
        if (this.input.consumeAction("interact") || this.input.consumeAction("ability") || this.input.consumeAction("Space")) this.setMode("playing");
        if (this.input.consumeAction("pause")) this.setMode("playing");
        break;
      case "paused":
        if (this.input.consumeAction("pause")) this.setMode(this.concert ? "concert" : "playing");
        break;
      case "levelComplete":
        if (this.input.consumeAction("Space") || this.input.consumeAction("interact")) this.nextLevel();
        break;
      case "gameover":
        if (this.input.consumeAction("Space") || this.input.consumeAction("interact")) this.restartLevel();
        break;
      case "concert":
        if (this.input.consumeAction("pause")) { this.setMode("paused"); break; }
        this.updateConcert(dt);
        break;
      case "finale":
        if (this.input.consumeAction("Space")) this.startConcert();
        break;
    }

    if (this.mode === "playing" && this.level) {
      const intensity = this.level.boss?.active ? 1 : 0;
      this.audio.update(dt, this.level.def.char, intensity);
    } else if (this.mode === "concert") {
      this.audio.update(dt, "alisa", 2);
    }
  }

  private updatePlaying(dt: number): void {
    const level = this.level;
    if (!level) return;
    level.elapsed += dt;
    level.hintClock += dt;
    level.comboClock = Math.max(0, level.comboClock - dt);
    if (level.comboClock <= 0) level.combo = 0;
    for (const task of level.tasks) task.pulse = Math.max(0, task.pulse - dt * 2.5);
    const player = this.player;
    player.prevX = player.x; player.prevY = player.y;
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.abilityCooldown = Math.max(0, player.abilityCooldown - dt);
    player.abilityFlash = Math.max(0, player.abilityFlash - dt);

    const speedBonus = { marina: 1.08, zhenya: 1, alisa: 1.03, anya: 0.96 }[level.def.char];
    const speed = GAME_CONFIG.PLAYER_SPEED * speedBonus;
    const dx = this.input.moveX * speed * dt;
    const dy = -this.input.moveZ * speed * dt;
    player.moving = Math.abs(dx) + Math.abs(dy) > 0.001;
    if (player.moving) {
      player.faceX = this.input.moveX;
      player.faceY = -this.input.moveZ;
      const length = Math.hypot(player.faceX, player.faceY) || 1;
      player.faceX /= length; player.faceY /= length;
      player.walkTime += dt * 9;
      level.hintClock = 0;
      moveWithCollisions(player, dx, dy, GAME_CONFIG.PLAYER_RADIUS, level.obstacles);
    }

    if (this.input.consumeAction("ability") && player.abilityCooldown <= 0) this.useAbility();
    if (this.input.consumeAction("interact")) this.interact();

    for (const item of level.items) {
      if (item.collected || Math.hypot(item.x - player.x, item.y - player.y) > 19) continue;
      item.collected = true;
      if (item.note) {
        if (!this.save.notes.includes(item.key)) this.save.notes.push(item.key);
        writeSave(this.save);
        this.addEnergy(12);
        level.score += 75;
        this.say(`Сахарная нота: ${this.save.notes.length}/48`, 1.8);
      } else {
        level.collected++;
        level.score += 50;
        this.addEnergy(8);
        this.say(`${item.name} — найдено! ${characterById(level.def.char).item}`, 2.6);
      }
      this.audio.sfx("pickup");
      this.burst(item.x, item.y, item.note ? PALETTE.hotPink : PALETTE.yellow, 12);
    }

    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateParticles(dt);
    if (player.hearts <= 0) {
      this.audio.sfx("lose");
      this.setMode("gameover");
    }
  }

  private interact(): void {
    const level = this.level;
    if (!level) return;
    const player = this.player;
    if (Math.hypot(level.npc.x - player.x, level.npc.y - player.y) < 48) {
      if (level.def.task.type === "return" && !level.returned && level.collected >= level.def.items.length) {
        level.returned = true;
        level.score += 250;
        this.addEnergy(20);
        this.audio.sfx("switch");
        this.burst(level.npc.x, level.npc.y, PALETTE.green, 18);
        this.say(level.def.task.done, 3.2);
      } else if (level.def.task.type === "return" && !level.returned) {
        this.say(`Сначала принеси все вещи: ${level.collected}/${level.def.items.length}.`, 2.2);
      } else {
        this.setMode("dialogue");
        this.audio.sfx("ui");
      }
      return;
    }
    for (const task of level.tasks) {
      if (Math.hypot(task.x - player.x, task.y - player.y) >= 42) continue;
      if (task.active) { this.say(`${task.name}: уже сделано.`, 1.5); return; }
      if (level.def.task.type === "ability") { this.say("Здесь нужна способность — кнопка B.", 1.8); return; }
      if (level.def.task.type === "sequence") {
        const expected = level.tasks.find((entry) => !entry.active);
        if (expected !== task) {
          for (const entry of level.tasks) entry.active = false;
          this.audio.sfx("miss");
          this.say(`Не тот порядок. Сначала: ${expected?.name ?? level.tasks[0]?.name}.`, 2.5);
          return;
        }
      }
      this.activateTask(task.index);
      return;
    }
    const exit = level.exit;
    if (circleRect(player.x, player.y, 28, exit)) {
      if (this.exitOpen()) this.completeLevel();
      else {
        const bossText = level.boss?.active ? " Сначала разберись с боссом." : "";
        const taskText = this.sideTasksDone() ? "" : ` Дела: ${this.taskDoneCount()}/${level.tasks.length + (level.def.task.type === "return" ? 1 : 0)}.`;
        this.say(`Выход закрыт. Вещи: ${level.collected}/${level.def.items.length}.${taskText}${bossText}`, 3.1);
      }
      return;
    }
    this.say("Здесь ничего. Но со стороны это выглядело очень уверенно.", 1.8);
  }

  private activateTask(index: number): void {
    const level = this.level;
    const task = level?.tasks[index];
    if (!level || !task || task.active) return;
    task.active = true;
    task.pulse = 1;
    level.score += 150 + level.combo * 10;
    this.addEnergy(15);
    this.audio.sfx("switch");
    this.burst(task.x, task.y, PALETTE.green, 14);
    this.say(this.sideTasksDone() ? level.def.task.done : `${task.name} — готово! ${this.taskDoneCount()}/${level.tasks.length}`, 2.6);
  }

  private sideTasksDone(): boolean {
    const level = this.level;
    if (!level) return false;
    if (level.def.task.type === "none") return true;
    if (level.def.task.type === "return") return level.returned;
    return level.tasks.every((task) => task.active);
  }

  private taskDoneCount(): number {
    const level = this.level;
    if (!level) return 0;
    return level.tasks.filter((task) => task.active).length + (level.returned ? 1 : 0);
  }

  private addEnergy(amount: number): void {
    const before = this.player.energy;
    this.player.energy = Math.min(100, this.player.energy + amount);
    if (before < 100 && this.player.energy >= 100) this.say("ВДОХНОВЕНИЕ 100%! Следующая способность — усиленная.", 2.8);
  }

  private exitOpen(): boolean {
    if (!this.level) return false;
    return this.level.collected >= this.level.def.items.length && this.sideTasksDone() && !this.level.boss?.active;
  }

  private useAbility(): void {
    const level = this.level;
    if (!level) return;
    const character = characterById(level.def.char);
    const player = this.player;
    const superMove = player.energy >= 100;
    if (superMove) {
      player.energy = 0;
      player.hearts = Math.min(GAME_CONFIG.MAX_HEARTS, player.hearts + 1);
      player.invulnerable = Math.max(player.invulnerable, 0.65);
      this.flash = 0.55;
      this.say("САХАРНОЕ СОЛО! Усиленный приём и одно сердце сверху.", 2.2);
    }
    const cooldown = { marina: 0.46, zhenya: 0.58, alisa: 0.72, anya: 0.86 }[character.id];
    player.abilityCooldown = cooldown;
    player.abilityDuration = { marina: 0.42, zhenya: 0.48, alisa: 0.62, anya: 0.52 }[character.id];
    player.abilityFlash = player.abilityDuration;
    this.audio.sfx("ability");
    this.shake = Math.max(this.shake, character.id === "anya" ? 3.2 : 1.4);
    this.burst(player.x, player.y, character.color, superMove ? 22 : 8);
    const radial = character.id === "marina" || character.id === "anya";
    const baseRange = { marina: 68, zhenya: 126, alisa: 118, anya: 80 }[character.id];
    const range = baseRange * (superMove ? 1.35 : 1);
    const reaches = (x: number, y: number, extra = 0): boolean => {
      const dx = x - player.x;
      const dy = y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > range + extra) return false;
      if (radial || distance < 20) return true;
      const threshold = character.id === "alisa" ? 0.05 : 0.28;
      return (dx * player.faceX + dy * player.faceY) / Math.max(1, distance) > threshold;
    };

    if (character.id === "marina") {
      for (const projectile of this.projectiles) {
        if (!projectile.active || !projectile.hostile || !reaches(projectile.x, projectile.y)) continue;
        projectile.active = false;
        level.score += 10;
        this.burst(projectile.x, projectile.y, PALETTE.yellow, 4);
      }
    }
    if (character.id === "zhenya") {
      const base = Math.atan2(player.faceY, player.faceX);
      for (const spread of [-0.2, 0, 0.2]) {
        this.spawnProjectile(player.x, player.y, Math.cos(base + spread) * 180, Math.sin(base + spread) * 180, character.color, 4, false);
      }
    }

    for (const enemy of level.enemies) {
      if (!enemy.alive || !reaches(enemy.x, enemy.y)) continue;
      enemy.hp -= character.id === "anya" || superMove ? 2 : 1;
      enemy.stun = character.id === "alisa" ? 2.7 : character.id === "anya" ? 1.05 : 0.75;
      const length = Math.hypot(enemy.x - player.x, enemy.y - player.y) || 1;
      const push = character.id === "anya" ? 190 : character.id === "marina" ? 125 : 100;
      enemy.vx = (enemy.x - player.x) / length * push;
      enemy.vy = (enemy.y - player.y) / length * push;
      this.burst(enemy.x, enemy.y, character.color, 8);
      level.score += 20;
      if (enemy.hp <= 0) this.defeatEnemy(enemy);
    }

    for (const task of level.tasks) {
      if (level.def.task.type === "ability" && !task.active && reaches(task.x, task.y, 12)) this.activateTask(task.index);
    }
    for (const pad of level.switches) {
      if (!pad.active && reaches(pad.x, pad.y, 10)) {
        pad.active = true;
        pad.pulse = 1;
        this.audio.sfx("switch");
        this.burst(pad.x, pad.y, PALETTE.green, 10);
      }
    }

    const boss = level.boss;
    if (boss?.active && level.switches.every((pad) => pad.active) && boss.vulnerable <= 0) {
      boss.vulnerable = 4.2;
      this.say("Защита сбита. Бей, пока босс светится!", 2.2);
      this.flash = 0.35;
    }
    if (boss?.active && reaches(boss.x, boss.y, 24)) {
      if (boss.vulnerable > 0) {
        boss.hp--;
        boss.vulnerable = 0;
        boss.flash = 0.25;
        for (const pad of level.switches) pad.active = false;
        this.shake = 5;
        level.score += 400;
        this.addEnergy(25);
        this.audio.sfx("hit");
        this.burst(boss.x, boss.y, PALETTE.yellow, 24);
        if (boss.hp <= 0) {
          boss.active = false;
          this.say(`${character.win} Выход открыт.`, 3.5);
          this.audio.sfx("win");
          this.burst(boss.x, boss.y, character.color, 40);
        } else this.say(`Попадание! Осталось: ${boss.hp}`, 1.4);
      } else this.say("Пока бессмертен. Сначала активируй три розовые площадки.", 1.8);
    }
  }

  private defeatEnemy(enemy: NonNullable<ReturnType<typeof generateLevel>["enemies"]>[number]): void {
    const level = this.level;
    if (!level || !enemy.alive) return;
    enemy.alive = false;
    level.combo++;
    level.comboClock = 4;
    level.score += 100 + level.combo * 15;
    this.addEnergy(22);
    this.audio.sfx("hit");
    this.say(`${ENEMY_NAMES[level.def.char][enemy.kind]} больше не отвлекает. Серия: ${level.combo}.`, 1.5);
  }

  private updateEnemies(dt: number): void {
    const level = this.level;
    if (!level) return;
    const player = this.player;
    for (const enemy of level.enemies) {
      if (!enemy.alive) continue;
      enemy.stun = Math.max(0, enemy.stun - dt);
      enemy.attackClock -= dt;
      if (enemy.stun > 0) {
        moveWithCollisions(enemy, enemy.vx * dt, enemy.vy * dt, 8, level.obstacles);
        enemy.vx *= 0.88; enemy.vy *= 0.88;
        continue;
      }
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (!enemy.spotted && distance < 135) {
        enemy.spotted = true;
        this.say(`Прокрастинация: ${ENEMY_NAMES[level.def.char][enemy.kind]}!`, 1.8);
      }
      let vx = 0, vy = 0;
      if (enemy.kind === "chaser" && distance < 280) {
        const speed = 35 + level.def.chapter * 5 + (level.def.char === "marina" ? 9 : 0);
        vx = dx / distance * speed; vy = dy / distance * speed;
      } else if (enemy.kind === "patrol") {
        if (level.def.char === "alisa" || level.def.char === "anya") {
          const targetY = enemy.homeY + Math.sin(this.time * 0.9 + enemy.phase) * 58;
          vy = Math.sign(targetY - enemy.y) * 28;
        } else {
          const targetX = enemy.homeX + Math.sin(this.time * 0.9 + enemy.phase) * 65;
          vx = Math.sign(targetX - enemy.x) * 28;
        }
      } else if (enemy.kind === "shooter") {
        if (distance < 105) { vx = -dx / distance * 25; vy = -dy / distance * 25; }
        else if (distance > 185 && distance < 310) { vx = dx / distance * 22; vy = dy / distance * 22; }
        if (distance < 320 && enemy.attackClock <= 0) {
          if (level.def.char === "zhenya") {
            const base = Math.atan2(dy, dx);
            for (const spread of [-0.18, 0.18]) this.spawnProjectile(enemy.x, enemy.y, Math.cos(base + spread) * 92, Math.sin(base + spread) * 92, "#ef5d73", 3);
          } else this.spawnProjectile(enemy.x, enemy.y, dx / distance * 82, dy / distance * 82, "#ef5d73", 3);
          enemy.attackClock = 2.2;
        }
      } else if (enemy.kind === "blocker") {
        vx = (enemy.homeX - enemy.x) * 0.8; vy = (enemy.homeY - enemy.y) * 0.8;
        if (distance < 190 && enemy.attackClock <= 0) {
          const count = level.def.char === "anya" ? 6 : 4;
          for (let i = 0; i < count; i++) {
            const angle = i * Math.PI * 2 / count + enemy.phase;
            this.spawnProjectile(enemy.x, enemy.y, Math.cos(angle) * 62, Math.sin(angle) * 62, "#c39bd3", 3);
          }
          enemy.attackClock = 2.8;
        }
      }
      moveWithCollisions(enemy, vx * dt, vy * dt, 8, level.obstacles);
      if (distance < 18) this.damagePlayer(dx / distance, dy / distance);
    }
  }

  private updateBoss(dt: number): void {
    const level = this.level;
    const boss = level?.boss;
    if (!level || !boss?.active) return;
    boss.flash = Math.max(0, boss.flash - dt);
    boss.vulnerable = Math.max(0, boss.vulnerable - dt);
    boss.phase = boss.hp <= 1 ? 1 : 0;
    for (const pad of level.switches) pad.pulse = Math.max(0, pad.pulse - dt * 2);

    const dx = this.player.x - boss.x;
    const dy = this.player.y - boss.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (boss.chargeTime > 0) {
      boss.chargeTime -= dt;
      boss.x = Math.max(350, Math.min(850, boss.x + boss.vx * dt));
      boss.y = Math.max(70, Math.min(470, boss.y + boss.vy * dt));
    } else if (boss.telegraph > 0) {
      boss.telegraph -= dt;
      if (boss.telegraph <= 0) this.fireBossPattern();
    } else if (boss.vulnerable <= 0) {
      boss.attackClock -= dt;
      if (boss.attackClock <= 0) {
        boss.telegraph = 0.65;
        boss.attackClock = boss.phase ? 1.65 : 2.25;
      }
    }
    if (distance < 38) this.damagePlayer(dx / distance, dy / distance);
  }

  private fireBossPattern(): void {
    const level = this.level;
    const boss = level?.boss;
    if (!level || !boss?.active) return;
    const character = level.def.char;
    const dx = this.player.x - boss.x;
    const dy = this.player.y - boss.y;
    const base = Math.atan2(dy, dx);
    if (character === "marina") {
      const count = boss.phase ? 10 : 8;
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + this.time * 0.2;
        this.spawnProjectile(boss.x, boss.y, Math.cos(angle) * 82, Math.sin(angle) * 82, "#ffd166", 4);
      }
    } else if (character === "zhenya") {
      for (const spread of [-0.22, 0, 0.22]) this.spawnProjectile(boss.x, boss.y, Math.cos(base + spread) * 110, Math.sin(base + spread) * 110, "#ef5d73", 5);
    } else if (character === "alisa") {
      for (const spread of [-0.34, -0.17, 0, 0.17, 0.34]) this.spawnProjectile(boss.x, boss.y, Math.cos(base + spread) * 72, Math.sin(base + spread) * 72, "#ff8fc7", 5);
    } else {
      boss.vx = Math.cos(base) * (boss.phase ? 205 : 170);
      boss.vy = Math.sin(base) * (boss.phase ? 205 : 170);
      boss.chargeTime = 0.65;
    }
  }

  private damagePlayer(nx: number, ny: number): void {
    const player = this.player;
    if (player.invulnerable > 0 || this.mode !== "playing") return;
    player.hearts--;
    player.energy = Math.max(0, player.energy - 25);
    player.invulnerable = 1.15;
    this.shake = 5;
    this.flash = 0.45;
    if (this.level) {
      this.level.hits++;
      this.level.combo = 0;
      this.level.comboClock = 0;
      this.say(characterById(this.level.def.char).hit, 2.2);
    }
    this.audio.sfx("hit");
    moveWithCollisions(player, nx * 15, ny * 15, GAME_CONFIG.PLAYER_RADIUS, this.level?.obstacles ?? []);
    this.burst(player.x, player.y, PALETTE.red, 15);
  }

  private spawnProjectile(x: number, y: number, vx: number, vy: number, color: string, size: number, hostile = true): void {
    const projectile = this.projectiles.find((entry) => !entry.active);
    if (!projectile) return;
    projectile.active = true; projectile.x = x; projectile.y = y;
    projectile.vx = vx; projectile.vy = vy; projectile.life = hostile ? 5 : 0.75;
    projectile.hostile = hostile; projectile.color = color; projectile.size = size;
  }

  private updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      if (projectile.life <= 0) { projectile.active = false; continue; }
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      if (projectile.x < 20 || projectile.x > GAME_CONFIG.WORLD_WIDTH - 20 || projectile.y < 20 || projectile.y > GAME_CONFIG.WORLD_HEIGHT - 20) {
        projectile.active = false; continue;
      }
      if (projectile.hostile && Math.hypot(projectile.x - this.player.x, projectile.y - this.player.y) < GAME_CONFIG.PLAYER_RADIUS + projectile.size) {
        const length = Math.hypot(projectile.vx, projectile.vy) || 1;
        this.damagePlayer(projectile.vx / length, projectile.vy / length);
        projectile.active = false;
      }
    }
  }

  private burst(x: number, y: number, color: string, count: number): void {
    const limit = this.lowQuality ? QUALITY.PARTICLES_LOW : QUALITY.PARTICLES_HIGH;
    let emitted = 0;
    for (let i = 0; i < limit; i++) {
      const particle = this.particles[i];
      if (particle.active) continue;
      const angle = (emitted / Math.max(1, count)) * Math.PI * 2 + this.time;
      const speed = 22 + (emitted % 5) * 9;
      particle.active = true; particle.x = x; particle.y = y;
      particle.vx = Math.cos(angle) * speed; particle.vy = Math.sin(angle) * speed;
      particle.life = particle.maxLife = 0.35 + (emitted % 4) * 0.08;
      particle.color = color; particle.size = 1 + emitted % 3;
      emitted++;
      if (emitted >= count) break;
    }
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) { particle.active = false; continue; }
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= 0.96; particle.vy *= 0.96;
    }
  }

  private clearPools(): void {
    for (const projectile of this.projectiles) projectile.active = false;
    for (const particle of this.particles) particle.active = false;
  }

  private say(text: string, duration = 2.4): void { this.bark = text; this.barkTime = duration; }

  private startConcert(): void {
    if (!this.allArrived()) return;
    const notes = [];
    let lane = 0;
    for (let time = 2, index = 0; time < GAME_CONFIG.CONCERT_DURATION - 1; index++) {
      notes.push({ time, lane, hit: false, missed: false });
      lane = (lane + (index % 5 === 3 ? 2 : 1)) % 4;
      time += time > 35 ? 0.5 : 0.75;
    }
    this.concert = { time: 0, notes, score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, laneFlash: [0, 0, 0, 0], finished: false };
    this.level = null;
    this.audio.startMusic();
    this.setMode("concert");
  }

  private updateConcert(dt: number): void {
    const concert = this.concert;
    if (!concert || concert.finished) return;
    concert.time += dt;
    for (let lane = 0; lane < 4; lane++) {
      concert.laneFlash[lane] = Math.max(0, concert.laneFlash[lane] - dt * 4);
      if (!this.input.consumeAction(`lane${lane}`)) continue;
      concert.laneFlash[lane] = 1;
      let nearest = -1;
      let nearestDelta = 0.3;
      for (let i = 0; i < concert.notes.length; i++) {
        const note = concert.notes[i];
        if (note.lane !== lane || note.hit || note.missed) continue;
        const delta = Math.abs(note.time - concert.time);
        if (delta < nearestDelta) { nearest = i; nearestDelta = delta; }
      }
      if (nearest >= 0) {
        concert.notes[nearest].hit = true;
        concert.hits++; concert.combo++;
        concert.maxCombo = Math.max(concert.maxCombo, concert.combo);
        concert.score += 100 + concert.combo * 5;
        this.audio.sfx("note");
      } else {
        concert.combo = 0;
        this.audio.sfx("miss");
      }
    }
    for (const note of concert.notes) {
      if (!note.hit && !note.missed && concert.time - note.time > 0.3) {
        note.missed = true; concert.misses++; concert.combo = 0;
      }
    }
    if (concert.time >= GAME_CONFIG.CONCERT_DURATION) {
      concert.finished = true;
      const accuracy = concert.hits + concert.misses ? Math.round(concert.hits / (concert.hits + concert.misses) * 100) : 0;
      this.save.bestConcert = Math.max(this.save.bestConcert, accuracy);
      writeSave(this.save);
      this.audio.sfx("win");
      this.setMode("finale");
    }
  }

  private onCanvasPointer = (event: PointerEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.viewWidth / rect.width;
    const y = (event.clientY - rect.top) * this.viewHeight / rect.height;
    for (let i = this.uiButtons.length - 1; i >= 0; i--) {
      const button = this.uiButtons[i];
      if (!button.enabled || x < button.x || x > button.x + button.w || y < button.y || y > button.y + button.h) continue;
      this.audio.sfx("ui");
      this.handleUiAction(button.action);
      return;
    }
  };

  private handleUiAction(action: string): void {
    if (action === "start" || action === "select") this.setMode("select");
    else if (action === "title") this.setMode("title");
    else if (action === "help") { this.previousMode = this.mode; this.setMode("help"); }
    else if (action === "resume") this.setMode(this.concert ? "concert" : "playing");
    else if (action === "restart") this.restartLevel();
    else if (action === "next") this.nextLevel();
    else if (action === "concert") this.startConcert();
    else if (action === "reset-save") { resetSave(); this.save = loadSave(); this.selectedIndex = 0; this.level = null; this.concert = null; this.setMode("title"); }
    else if (action.startsWith("char:")) { this.selectedIndex = Number(action.slice(5)); this.save.selected = CHARACTERS[this.selectedIndex].id; writeSave(this.save); }
    else if (action.startsWith("level:")) this.startLevel(CHARACTERS[this.selectedIndex].id, Number(action.slice(6)));
  }

  private render(): void {
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.fpsFrames++; this.fpsClock += frameDt;
    if (this.fpsClock >= 1) {
      this.fps = this.fpsFrames / this.fpsClock;
      if (this.fps < QUALITY.DEGRADE_FPS && this.mode === "playing") this.lowQuality = true;
      this.fpsFrames = 0; this.fpsClock = 0;
    }
    const ctx = this.ctx;
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.deep;
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    this.uiButtons.length = 0;

    if (this.mode === "loading") this.renderLoading();
    else if (this.mode === "title") this.renderTitle();
    else if (this.mode === "select") this.renderSelect();
    else if (this.mode === "help") this.renderHelp();
    else if (this.mode === "concert") this.renderConcert();
    else if (this.mode === "finale") this.renderFinale();
    else {
      this.renderWorld();
      if (this.mode === "dialogue") this.renderDialogue();
      else if (this.mode === "paused") this.renderPause();
      else if (this.mode === "levelComplete") this.renderLevelComplete();
      else if (this.mode === "gameover") this.renderGameover();
    }
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.22;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
      ctx.globalAlpha = 1;
    }
    if (this.mode !== "loading") window.__GAME_READY__ = true;
  }

  private renderLoading(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.drawText("САХАРНАЯ ВАТА", W / 2, H / 2 - 10, 20, PALETTE.hotPink, "center");
    this.drawText(`ЗАГРУЗКА СПРАЙТОВ ${this.loadedImages}/4`, W / 2, H / 2 + 18, 9, PALETTE.cream, "center");
  }

  private renderMenuBackground(): void {
    const W = this.viewWidth, H = this.viewHeight;
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.deep; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#40254a";
    for (let y = 0; y < H; y += 16) {
      for (let x = (y / 16 % 2) * 8; x < W; x += 32) {
        if ((x * 7 + y * 13) % 5 < 2) ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.fillStyle = "#2b1a34";
    for (let x = 0; x < W; x += 48) ctx.fillRect(x, H - 42 - (x % 96 ? 8 : 0), 32, 42);
  }

  private renderTitle(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.renderMenuBackground();
    this.drawText("САХАРНАЯ ВАТА", W / 2 + 2, 42, 29, "#5b2b52", "center");
    this.drawText("САХАРНАЯ ВАТА", W / 2, 39, 29, PALETTE.hotPink, "center");
    this.drawText("ВСЕ НА СЦЕНУ!", W / 2, 61, 13, PALETTE.cream, "center");
    this.drawText("16 УРОВНЕЙ  •  4 ИСТОРИИ  •  1 КОНЦЕРТ", W / 2, 77, 7, "#d7afc9", "center");
    this.drawButton(W / 2 - 78, 91, 156, 30, this.save.completed.length ? "ПРОДОЛЖИТЬ" : "НАЧАТЬ", "start", true);
    this.drawButton(W / 2 - 78, 127, 156, 25, "КАК ИГРАТЬ", "help", true);
    const spacing = Math.min(112, (W - 80) / 3);
    for (let i = 0; i < 4; i++) this.drawSprite(CHARACTERS[i].id, W / 2 + (i - 1.5) * spacing, H - 6, 86 + Math.sin(this.time * 2 + i) * 2, false);
    const arrived = CHARACTERS.filter((member) => levelsFor(member.id).every((level) => this.save.completed.includes(level.id))).length;
    this.drawText(`В ГРИМЕРКЕ: ${arrived}/4  •  НОТЫ: ${this.save.notes.length}/48`, W / 2, H - 94, 8, PALETTE.yellow, "center");
    this.drawText("SPACE — БЫСТРЫЙ СТАРТ", W / 2, H - 82, 7, "#b896af", "center");
  }

  private renderSelect(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.renderMenuBackground();
    const character = CHARACTERS[this.selectedIndex];
    const levels = levelsFor(character.id);
    this.drawButton(8, 8, 58, 21, "← МЕНЮ", "title", true);
    this.drawText("КОГО ВЕДЁМ НА КОНЦЕРТ?", W / 2, 20, 12, PALETTE.cream, "center");
    const tabW = (W - 24) / 4;
    for (let i = 0; i < 4; i++) {
      const arrived = levelsFor(CHARACTERS[i].id).every((level) => this.save.completed.includes(level.id));
      this.drawButton(8 + i * tabW, 38, tabW - 4, 25, `${arrived ? "✓ " : ""}${CHARACTERS[i].name}`, `char:${i}`, true, i === this.selectedIndex);
    }
    this.drawPanel(12, 70, W - 24, H - 82);
    this.drawSprite(character.id, 76, H - 17, 128, false);
    this.drawText(character.name, 137, 94, 17, character.color);
    this.drawText(character.role.toUpperCase(), 137, 109, 8, PALETTE.cream);
    this.drawWrapped(character.trait, 137, 121, W - 166, 7, "#e2c5d7", 10, 2);
    this.drawWrapped(character.arc, 137, 142, W - 166, 7, PALETTE.cream, 10, 2);
    this.drawWrapped(character.abilityHint, 137, 163, W - 166, 6, character.color, 9, 2);
    for (let i = 0; i < 4; i++) {
      const level = levels[i];
      const unlocked = this.isUnlocked(level);
      const complete = this.save.completed.includes(level.id);
      this.drawButton(137 + (i % 2) * 116, 181 + ((i / 2) | 0) * 31, 108, 25, `${complete ? "✓" : unlocked ? i + 1 : "×"}  ${["ДОМ", "УЛИЦА", "БОСС", "КЛУБ"][i]}`, `level:${i}`, unlocked);
    }
    const arrived = CHARACTERS.filter((member) => levelsFor(member.id).every((level) => this.save.completed.includes(level.id))).length;
    if (!this.allArrived()) this.drawText(`В ГРИМЕРКЕ: ${arrived}/4  •  НОТЫ: ${this.save.notes.length}/48`, 137, 253, 6, PALETTE.yellow);
    if (this.allArrived()) this.drawButton(W - 174, H - 31, 162, 25, "ФИНАЛЬНЫЙ КОНЦЕРТ", "concert", true);
  }

  private renderHelp(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.renderMenuBackground();
    this.drawText("КАК ДОЙТИ ДО КОНЦЕРТА", W / 2, 31, 17, PALETTE.hotPink, "center");
    this.drawPanel(W / 2 - 174, 45, 348, 145);
    const lines = [
      "ТЕЛЕФОН: крестовина слева — движение.",
      "A — говорить и действовать. B — способность.",
      "КЛАВИАТУРА: WASD/стрелки, E, пробел, Esc.",
      "Собирай личные вещи и выполняй дела из списка.",
      "За помехи и задания растёт вдохновение.",
      "На 100% следующий приём усилится и лечит.",
      "У босса: 3 площадки, затем удар по свечению.",
      "Ноты необязательны. Прогресс — в этом браузере.",
    ];
    lines.forEach((line, index) => this.drawText(line, W / 2, 62 + index * 16, 7, index === 3 ? PALETTE.yellow : PALETTE.cream, "center"));
    this.drawButton(W / 2 - 112, 201, 224, 27, "ПОНЯТНО, ПОГНАЛИ", "title", true);
    this.drawButton(W / 2 - 112, 235, 224, 22, "СТЕРЕТЬ ПРОГРЕСС", "reset-save", true);
  }

  private renderWorld(): void {
    const level = this.level;
    if (!level) { this.renderTitle(); return; }
    const ctx = this.ctx;
    const W = this.viewWidth, H = this.viewHeight;
    const theme = THEMES[level.def.scene];
    const targetX = Math.max(0, Math.min(GAME_CONFIG.WORLD_WIDTH - W, this.player.x - W / 2));
    const targetY = Math.max(0, Math.min(GAME_CONFIG.WORLD_HEIGHT - H, this.player.y - H / 2));
    this.camera.x += (targetX - this.camera.x) * GAME_CONFIG.CAMERA_LERP;
    this.camera.y += (targetY - this.camera.y) * GAME_CONFIG.CAMERA_LERP;
    const shakeX = Math.sin(this.time * 71) * this.shake;
    const shakeY = Math.cos(this.time * 59) * this.shake * 0.6;
    const camX = Math.round(this.camera.x - shakeX);
    const camY = Math.round(this.camera.y - shakeY);
    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.fillStyle = theme.floor; ctx.fillRect(0, 0, GAME_CONFIG.WORLD_WIDTH, GAME_CONFIG.WORLD_HEIGHT);
    const startX = Math.max(0, (camX / 16 | 0) * 16);
    const startY = Math.max(0, (camY / 16 | 0) * 16);
    const endX = Math.min(GAME_CONFIG.WORLD_WIDTH, camX + W + 16);
    const endY = Math.min(GAME_CONFIG.WORLD_HEIGHT, camY + H + 16);
    ctx.fillStyle = theme.tile;
    for (let y = startY; y < endY; y += 16) {
      for (let x = startX; x < endX; x += 16) {
        if ((x / 16 + y / 16) % 2 === 0) ctx.fillRect(x, y, 16, 16);
        if ((x * 3 + y * 5) % 128 === 0) { ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.12; ctx.fillRect(x + 5, y + 6, 2, 2); ctx.globalAlpha = 1; ctx.fillStyle = theme.tile; }
      }
    }
    this.drawSceneDetails(level.def);
    for (const obstacle of level.obstacles) this.drawObstacle(obstacle, level.def);
    this.drawExit(level.exit.x, level.exit.y, this.exitOpen());
    this.drawNpc(level.npc.x, level.npc.y, level.def.char);
    for (const task of level.tasks) this.drawTask(task, level.def);
    for (const item of level.items) if (!item.collected) this.drawItem(item, level.def.char);
    for (const pad of level.switches) this.drawPad(pad.x, pad.y, pad.active, pad.pulse);
    for (const enemy of level.enemies) if (enemy.alive) this.drawEnemy(enemy, level.def.char);
    if (level.boss?.active) this.drawBoss(level.boss, level.def);
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      ctx.fillStyle = projectile.color;
      ctx.fillRect(Math.round(projectile.x - projectile.size), Math.round(projectile.y - projectile.size), projectile.size * 2, projectile.size * 2);
      ctx.fillStyle = PALETTE.cream; ctx.fillRect(Math.round(projectile.x - 1), Math.round(projectile.y - 1), 2, 2);
    }
    this.drawPlayer();
    for (const particle of this.particles) {
      if (!particle.active) continue;
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.renderHud();
  }

  private drawSceneDetails(def: LevelDef): void {
    const ctx = this.ctx;
    const theme = THEMES[def.scene];
    switch (def.scene) {
      case "underpass": case "nightStreet": case "parking": case "busRoute":
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = def.scene === "underpass" ? "#a6d5d2" : "#d9c985";
        for (let x = 34; x < GAME_CONFIG.WORLD_WIDTH; x += 96) {
          ctx.fillRect(x, 266, 48, 4);
          if (def.scene === "parking") { ctx.fillRect(x - 8, 150, 3, 82); ctx.fillRect(x - 8, 360, 3, 82); }
        }
        ctx.globalAlpha = 1;
        if (def.scene === "underpass") {
          this.drawText("САХАР →", 310, 54, 13, "#ef83bd");
          this.drawText("НЕ СПИ", 720, 498, 11, "#75d7d2");
        }
        break;
      case "courtyard": case "park":
        for (let i = 0; i < 54; i++) {
          const x = 35 + (i * 173) % 885;
          const y = 42 + (i * 97) % 458;
          ctx.fillStyle = i % 3 ? "#759263" : theme.accent;
          ctx.fillRect(x, y, 2, 5); ctx.fillRect(x - 2, y + 2, 6, 2);
        }
        if (def.scene === "park") {
          ctx.globalAlpha = 0.18; ctx.fillStyle = "#ffd1b5";
          ctx.fillRect(0, 224, GAME_CONFIG.WORLD_WIDTH, 92); ctx.globalAlpha = 1;
        }
        break;
      case "marinaRoom": case "alisaRoom": case "anyaRoom":
        ctx.globalAlpha = 0.32; ctx.fillStyle = theme.accent;
        ctx.fillRect(286, 213, 176, 104);
        ctx.fillStyle = theme.wall; ctx.fillRect(296, 223, 156, 84);
        for (let x = 88; x < 900; x += 176) {
          ctx.fillStyle = theme.accent; ctx.fillRect(x, 32, 38, 28);
          ctx.fillStyle = theme.wall; ctx.fillRect(x + 4, 36, 30, 20);
        }
        ctx.globalAlpha = 1;
        break;
      case "rehearsal": case "theatre":
        for (let i = 0; i < 4; i++) {
          const x = 155 + i * 215;
          ctx.globalAlpha = 0.08 + Math.sin(this.time * 2 + i) * 0.025;
          ctx.fillStyle = i % 2 ? PALETTE.hotPink : PALETTE.yellow;
          ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x - 65, 510); ctx.lineTo(x + 65, 510); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
        this.drawText(def.scene === "theatre" ? "СЦЕНА" : "РЕПЕТИЦИЯ", 480, 52, 13, theme.accent, "center");
        break;
      case "garage": case "workshop": case "repairGarage":
        ctx.strokeStyle = "#292b2c"; ctx.lineWidth = 2;
        for (let i = 0; i < 18; i++) {
          const x = 50 + (i * 137) % 850, y = 60 + (i * 83) % 420;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 12, y + 5); ctx.lineTo(x + 17, y + 1); ctx.stroke();
        }
        this.drawText("ИНСТРУМЕНТЫ", 480, 50, 10, theme.accent, "center");
        break;
      case "musicShop": case "cafe":
        for (let x = 80; x < 900; x += 160) {
          ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.25;
          ctx.fillRect(x, 32, 58, 25); ctx.globalAlpha = 1;
          this.drawText(def.scene === "cafe" ? "☕" : "♪", x + 29, 51, 14, theme.accent, "center");
        }
        break;
    }
  }

  private drawObstacle(rect: Rect, def: LevelDef): void {
    const ctx = this.ctx;
    const theme = THEMES[def.scene];
    ctx.fillStyle = theme.wall; ctx.fillRect(rect.x + 3, rect.y + 5, rect.w, rect.h);
    ctx.fillStyle = theme.top; ctx.fillRect(rect.x, rect.y, rect.w, Math.max(4, rect.h - 5));
    ctx.fillStyle = theme.wall; ctx.fillRect(rect.x, rect.y + rect.h - 7, rect.w, 7);
    if (rect.w > 200 || rect.h > 200) return;
    switch (def.scene) {
      case "marinaRoom": case "alisaRoom": case "anyaRoom":
        ctx.fillStyle = theme.accent; ctx.fillRect(rect.x + 5, rect.y + 5, rect.w - 10, Math.max(6, rect.h - 16));
        ctx.fillStyle = PALETTE.cream; ctx.fillRect(rect.x + 8, rect.y + 8, Math.min(22, rect.w - 16), 9);
        break;
      case "courtyard": case "park":
        ctx.fillStyle = "#594330"; ctx.fillRect(rect.x + rect.w / 2 - 4, rect.y + rect.h / 2, 8, rect.h / 2 - 5);
        ctx.fillStyle = "#36523c"; ctx.fillRect(rect.x + 3, rect.y + 2, rect.w - 6, rect.h * 0.65);
        ctx.fillStyle = "#73905b"; ctx.fillRect(rect.x + 8, rect.y + 6, rect.w - 18, 8);
        break;
      case "rehearsal": case "theatre": case "workshop":
        ctx.fillStyle = "#211b26"; ctx.fillRect(rect.x + 5, rect.y + 5, rect.w - 10, rect.h - 13);
        ctx.fillStyle = theme.accent;
        ctx.fillRect(rect.x + 10, rect.y + 10, Math.max(5, rect.w / 4), Math.max(5, rect.h / 4));
        if (rect.w > 55) ctx.fillRect(rect.x + rect.w / 2 + 4, rect.y + 10, Math.max(5, rect.w / 4), Math.max(5, rect.h / 4));
        break;
      case "nightStreet": case "parking": case "busRoute": case "underpass":
        ctx.fillStyle = "#26303d"; ctx.fillRect(rect.x + 8, rect.y + 6, rect.w - 16, Math.max(7, rect.h / 3));
        ctx.fillStyle = "#171c26";
        ctx.fillRect(rect.x + 6, rect.y + rect.h - 5, 12, 6); ctx.fillRect(rect.x + rect.w - 18, rect.y + rect.h - 5, 12, 6);
        ctx.fillStyle = theme.accent; ctx.fillRect(rect.x + rect.w - 9, rect.y + rect.h - 14, 5, 4);
        break;
      case "garage": case "repairGarage":
        ctx.strokeStyle = theme.accent; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(rect.x + 5, rect.y + 5); ctx.lineTo(rect.x + rect.w - 5, rect.y + rect.h - 9); ctx.moveTo(rect.x + rect.w - 5, rect.y + 5); ctx.lineTo(rect.x + 5, rect.y + rect.h - 9); ctx.stroke();
        break;
      case "musicShop": case "cafe":
        ctx.fillStyle = theme.accent;
        for (let x = rect.x + 4; x < rect.x + rect.w - 4; x += 14) ctx.fillRect(x, rect.y + 4, 7, 8);
        ctx.fillStyle = PALETTE.cream; ctx.fillRect(rect.x + 8, rect.y + 17, rect.w - 16, 3);
        break;
    }
  }

  private drawExit(x: number, y: number, open: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = open ? PALETTE.hotPink : "#483b4c";
    ctx.fillRect(x - 4, y - 5, 42, 78);
    ctx.fillStyle = PALETTE.ink; ctx.fillRect(x, y, 34, 68);
    ctx.fillStyle = open ? PALETTE.yellow : "#79677b";
    ctx.fillRect(x + 24, y + 35, 4, 4);
    this.drawText(open ? "КЛУБ" : "ЗАКР", x + 17, y + 30, 7, open ? PALETTE.cream : "#a48ca4", "center");
    if (open) { ctx.globalAlpha = 0.25 + Math.sin(this.time * 5) * 0.1; ctx.fillStyle = PALETTE.hotPink; ctx.fillRect(x - 8, y - 9, 50, 86); ctx.globalAlpha = 1; }
  }

  private drawNpc(x: number, y: number, character: CharacterId): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#241a28"; ctx.fillRect(x - 9, y - 7, 18, 22);
    ctx.fillStyle = "#d5a082"; ctx.fillRect(x - 7, y - 20, 14, 13);
    ctx.fillStyle = character === "zhenya" ? "#d7b35d" : "#71452f"; ctx.fillRect(x - 8, y - 23, 16, 7);
    ctx.fillStyle = PALETTE.cream; ctx.fillRect(x + 12, y - 31, 12, 12);
    ctx.fillStyle = PALETTE.ink; ctx.fillRect(x + 17, y - 28, 2, 6);
    this.drawText("NPC", x, y + 25, 6, PALETTE.cream, "center");
  }

  private drawTask(task: TaskObject, def: LevelDef): void {
    const ctx = this.ctx;
    const y = task.y + Math.sin(this.time * 3 + task.index) * 1.5;
    ctx.globalAlpha = task.active ? 0.28 : 0.18 + Math.sin(this.time * 5 + task.index) * 0.06;
    ctx.fillStyle = task.active ? PALETTE.green : PALETTE.hotPink;
    ctx.fillRect(task.x - 18, y - 18, 36, 36); ctx.globalAlpha = 1;
    ctx.fillStyle = task.active ? "#355d4a" : "#4a2c48"; ctx.fillRect(task.x - 12, y - 10, 24, 22);
    ctx.fillStyle = task.active ? PALETTE.green : characterById(def.char).color;
    ctx.fillRect(task.x - 9, y - 13, 18, 5);
    const symbol = task.active ? "✓" : def.task.type === "ability" ? "B" : def.task.type === "sequence" ? String(task.index + 1) : "A";
    this.drawText(symbol, task.x, y + 7, 9, task.active ? PALETTE.green : PALETTE.cream, "center");
    this.drawText(task.name, task.x, y - 22, 5, task.active ? PALETTE.green : PALETTE.cream, "center");
  }

  private drawItem(item: Item, character: CharacterId): void {
    const ctx = this.ctx;
    const bob = Math.sin(this.time * 4 + item.phase) * 3;
    const x = Math.round(item.x), y = Math.round(item.y + bob);
    const color = characterById(character).color;
    ctx.globalAlpha = 0.18; ctx.fillStyle = item.note ? PALETTE.hotPink : color;
    ctx.fillRect(x - 13, y - 13, 26, 26); ctx.globalAlpha = 1;
    if (item.note) {
      this.drawText("♪", x, y + 7, 20, PALETTE.hotPink, "center");
      return;
    }
    const variant = item.key.charCodeAt(item.key.length - 1) % 3;
    ctx.fillStyle = color;
    if (character === "marina") {
      ctx.fillRect(x - 8, y - 2, 16, 10);
      ctx.fillStyle = PALETTE.cream; ctx.fillRect(x - 6, y - 5, 12, 4);
      ctx.strokeStyle = PALETTE.yellow; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 8, y - 10); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 8, y - 10); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    } else if (character === "zhenya") {
      if (variant === 0) { ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x - 8, y + 7); ctx.lineTo(x + 8, y + 7); ctx.closePath(); ctx.fill(); }
      else { ctx.fillRect(x - 8, y - 6, 16, 13); ctx.fillStyle = PALETTE.ink; ctx.fillRect(x - 5, y - 3, 10, 7); ctx.fillStyle = color; ctx.fillRect(x + 6, y - 11, 3, 8); }
    } else if (character === "alisa") {
      if (variant === 0) { ctx.fillStyle = PALETTE.cream; ctx.fillRect(x - 7, y - 9, 14, 18); ctx.fillStyle = color; for (let i = 0; i < 3; i++) ctx.fillRect(x - 4, y - 5 + i * 4, 9, 2); }
      else { ctx.fillRect(x - 2, y - 1, 4, 11); ctx.beginPath(); ctx.arc(x, y - 5, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = PALETTE.cream; ctx.fillRect(x - 2, y - 8, 3, 3); }
    } else {
      ctx.fillRect(x - 8, y - 7, 16, 15); ctx.fillStyle = PALETTE.ink; ctx.fillRect(x - 5, y - 4, 10, 8); ctx.fillStyle = color; ctx.fillRect(x - 3, y - 10, 6, 3);
      if (variant === 2) { ctx.fillStyle = PALETTE.cream; ctx.fillRect(x - 1, y - 3, 2, 6); }
    }
    this.drawText(item.name, x, y - 17, 5, PALETTE.cream, "center");
  }

  private drawPad(x: number, y: number, active: boolean, pulse: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = active ? PALETTE.green : PALETTE.hotPink;
    ctx.globalAlpha = active ? 0.9 : 0.45 + Math.sin(this.time * 5) * 0.15;
    ctx.fillRect(x - 15 - pulse * 4, y - 10 - pulse * 4, 30 + pulse * 8, 20 + pulse * 8);
    ctx.globalAlpha = 1; ctx.fillStyle = PALETTE.ink; ctx.fillRect(x - 10, y - 5, 20, 10);
    this.drawText(active ? "✓" : "B", x, y + 4, 9, active ? PALETTE.green : PALETTE.cream, "center");
  }

  private drawEnemy(enemy: Enemy, character: CharacterId): void {
    const ctx = this.ctx;
    const { x, y, kind, stun, phase } = enemy;
    const wobble = Math.sin(this.time * 8 + phase) * 2;
    const color = characterById(character).color;
    ctx.fillStyle = stun > 0 ? "#705879" : "#241b2b";
    if (character === "marina") {
      ctx.fillRect(x - 10, y - 10 + wobble, 20, 20);
      ctx.fillRect(x - 8, y - 15 + wobble, 6, 5); ctx.fillRect(x + 2, y - 15 + wobble, 6, 5);
      ctx.fillStyle = color; ctx.fillRect(x - 7, y - 7 + wobble, 14, 12);
      ctx.fillStyle = PALETTE.ink; ctx.fillRect(x - 1, y - 6 + wobble, 2, 7); ctx.fillRect(x, y + wobble, 5, 2);
    } else if (character === "zhenya") {
      ctx.fillRect(x - 11, y - 7 + wobble, 22, 15);
      ctx.fillRect(x + 6, y - 16 + wobble, 5, 12);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y + wobble, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color; ctx.fillRect(x - 4, y - 4 + wobble, 3, 3); ctx.fillRect(x + 3, y - 4 + wobble, 3, 3);
    } else if (character === "alisa") {
      ctx.fillRect(x - 9, y - 14 + wobble, 18, 25);
      ctx.fillStyle = color; ctx.fillRect(x - 6, y - 11 + wobble, 12, 14);
      ctx.fillStyle = PALETTE.cream; ctx.globalAlpha = 0.65; ctx.fillRect(x - 4, y - 9 + wobble, 3, 9); ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.ink; ctx.fillRect(x - 2, y + 6 + wobble, 4, 2);
    } else {
      ctx.globalAlpha = 0.55; ctx.fillStyle = color;
      ctx.fillRect(x - 18, y - 13 + wobble, 12, 12); ctx.fillRect(x + 6, y - 13 + wobble, 12, 12); ctx.globalAlpha = 1;
      ctx.fillStyle = stun > 0 ? "#705879" : "#241b2b"; ctx.fillRect(x - 11, y - 8 + wobble, 22, 16);
      ctx.fillRect(x + 9, y - 3 + wobble, 10, 3);
      ctx.fillStyle = color; ctx.fillRect(x - 7, y - 4 + wobble, 4, 4); ctx.fillRect(x + 3, y - 4 + wobble, 4, 4);
    }
    if (kind === "shooter") { ctx.fillStyle = PALETTE.yellow; ctx.fillRect(x - 2, y - 20 + wobble, 4, 7); }
    if (kind === "blocker") { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x - 14, y - 16 + wobble, 28, 29); }
    if (kind === "patrol") { ctx.fillStyle = color; ctx.fillRect(x - 13, y + 11, 7, 3); ctx.fillRect(x + 6, y + 11, 7, 3); }
    this.drawText(ENEMY_NAMES[character][kind], x, y - 25 + wobble, 4, stun > 0 ? PALETTE.green : PALETTE.cream, "center");
    if (stun > 0) this.drawText("✦ ✦", x, y - 34 + wobble, 7, PALETTE.yellow, "center");
  }

  private drawBoss(boss: NonNullable<ReturnType<typeof generateLevel>["boss"]>, def: LevelDef): void {
    const ctx = this.ctx;
    const x = boss.x, y = boss.y;
    const glow = boss.vulnerable > 0 || boss.telegraph > 0;
    if (glow) { ctx.globalAlpha = 0.2 + Math.sin(this.time * 16) * 0.08; ctx.fillStyle = boss.vulnerable > 0 ? PALETTE.green : PALETTE.red; ctx.fillRect(x - 48, y - 48, 96, 96); ctx.globalAlpha = 1; }
    ctx.fillStyle = boss.flash > 0 ? PALETTE.cream : "#2a2030";
    if (def.char === "marina") {
      ctx.beginPath(); ctx.moveTo(x, y - 38); ctx.lineTo(x - 32, y + 34); ctx.lineTo(x + 32, y + 34); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PALETTE.yellow; ctx.fillRect(x - 3, y - 28, 6, 49);
    } else if (def.char === "zhenya") {
      ctx.fillRect(x - 36, y - 34, 72, 68);
      ctx.fillStyle = "#70435d"; ctx.fillRect(x - 26, y - 22, 20, 20); ctx.fillRect(x + 7, y - 22, 20, 20); ctx.fillRect(x - 26, y + 7, 52, 16);
    } else if (def.char === "alisa") {
      ctx.fillRect(x - 34, y - 30, 68, 60);
      ctx.fillStyle = PALETTE.hotPink; ctx.fillRect(x - 25, y - 20, 50, 20);
      this.drawText("404", x, y - 6, 13, PALETTE.ink, "center");
    } else {
      ctx.fillRect(x - 30, y - 18, 60, 36);
      ctx.globalAlpha = 0.65; ctx.fillStyle = "#c39bd3"; ctx.fillRect(x - 45, y - 32, 28, 22); ctx.fillRect(x + 17, y - 32, 28, 22); ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.red; ctx.fillRect(x - 18, y - 7, 6, 6); ctx.fillRect(x + 12, y - 7, 6, 6);
    }
    this.drawText(def.bossName ?? "БОСС", x, y - 49, 9, PALETTE.cream, "center");
    for (let i = 0; i < boss.maxHp; i++) {
      ctx.fillStyle = i < boss.hp ? PALETTE.red : "#4c3a4d";
      ctx.fillRect(x - 24 + i * 18, y + 43, 14, 5);
    }
  }

  private drawPlayer(): void {
    const level = this.level;
    if (!level) return;
    const player = this.player;
    if (player.invulnerable > 0 && player.abilityFlash <= 0 && (this.time * 14 | 0) % 2 === 0) return;
    const ctx = this.ctx;
    const character = level.def.char;
    const color = characterById(character).color;
    const active = player.abilityFlash > 0;
    const progress = active ? 1 - player.abilityFlash / player.abilityDuration : 0;
    const pulse = active ? Math.sin(progress * Math.PI) : 0;
    const bob = player.moving ? Math.abs(Math.sin(player.walkTime)) * 3 : Math.sin(this.time * 2) * 0.6;
    const rotation = character === "zhenya" ? -0.13 * pulse : character === "marina" ? Math.sin(progress * Math.PI * 5) * 0.045 * pulse : 0;
    const scaleY = character === "anya" ? 1 - pulse * 0.13 : character === "alisa" ? 1 + pulse * 0.08 : 1;
    if (player.energy >= 100) {
      ctx.globalAlpha = 0.12 + Math.sin(this.time * 7) * 0.05; ctx.fillStyle = PALETTE.yellow;
      ctx.fillRect(player.x - 20, player.y - 42, 40, 57); ctx.globalAlpha = 1;
    }
    this.drawSprite(character, player.x, player.y + 13 - bob, 57, player.faceX < -0.1, rotation, scaleY);
    if (!active) return;

    ctx.save();
    ctx.translate(player.x, player.y - 7);
    ctx.globalAlpha = Math.min(1, player.abilityFlash * 4);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    if (character === "marina") {
      for (let i = 0; i < 2; i++) {
        const radius = 18 + progress * 66 + i * 12;
        ctx.globalAlpha = (1 - progress) * (i ? 0.45 : 0.9);
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const side of [-1, 1]) {
        const angle = side * (0.7 + progress * 2.4);
        ctx.strokeStyle = PALETTE.yellow; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 7, -18 + Math.sin(angle) * 5); ctx.lineTo(Math.cos(angle) * 25, -18 + Math.sin(angle) * 24); ctx.stroke();
      }
      ctx.fillStyle = color; ctx.fillRect(-11, 4, 22, 10);
    } else if (character === "zhenya") {
      const angle = Math.atan2(player.faceY, player.faceX);
      ctx.rotate(angle);
      ctx.fillStyle = "#9a554e"; ctx.fillRect(2, -6, 16, 15); ctx.fillStyle = PALETTE.yellow; ctx.fillRect(15, -2, 24, 4);
      for (let i = 0; i < 3; i++) this.drawText("♪", 24 + progress * 80, -19 + i * 18, 13, color, "center");
      ctx.globalAlpha = 1 - progress; ctx.beginPath(); ctx.moveTo(20, -17); ctx.lineTo(35 + progress * 90, 0); ctx.lineTo(20, 17); ctx.stroke();
    } else if (character === "alisa") {
      ctx.globalAlpha = 0.1 * pulse; ctx.fillStyle = PALETTE.cream;
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(-55, 25); ctx.lineTo(55, 25); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = PALETTE.cream; ctx.fillRect(8, -11, 3, 18); ctx.fillStyle = color; ctx.fillRect(6, -15, 7, 7);
      ctx.rotate(Math.atan2(player.faceY, player.faceX));
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (1 - progress) * (1 - i * 0.2);
        ctx.beginPath(); ctx.arc(0, 0, 25 + progress * 90 + i * 10, -0.65, 0.65); ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#5b3d68"; ctx.fillRect(1, -7, 18, 16); ctx.fillStyle = color; ctx.fillRect(14, -3, 27, 5);
      for (let i = 0; i < 3; i++) {
        const radius = 18 + progress * 76 + i * 11;
        ctx.globalAlpha = (1 - progress) * (1 - i * 0.22);
        ctx.strokeRect(-radius, -radius * 0.55, radius * 2, radius * 1.1);
      }
      ctx.globalAlpha = 0.7; ctx.fillStyle = color;
      for (let x = -70; x <= 70; x += 14) ctx.fillRect(x, 18 + Math.sin(x + progress * 8) * 4, 8, 3);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private renderHud(): void {
    const level = this.level;
    if (!level) return;
    const W = this.viewWidth;
    const character = characterById(level.def.char);
    this.drawPanel(6, 6, 170, 51);
    for (let i = 0; i < 3; i++) this.drawHeart(16 + i * 18, 15, i < this.player.hearts);
    this.drawText(character.ability, 69, 18, 7, character.color);
    this.drawText(this.player.abilityCooldown <= 0 ? "B — ГОТОВО" : "ПЕРЕЗАРЯДКА", 69, 30, 6, this.player.abilityCooldown <= 0 ? PALETTE.green : "#c4afc0");
    this.ctx.fillStyle = "#1c1423"; this.ctx.fillRect(69, 36, 91, 7);
    this.ctx.fillStyle = this.player.energy >= 100 ? PALETTE.yellow : character.color;
    this.ctx.fillRect(70, 37, 89 * this.player.energy / 100, 5);
    this.drawText(`ВДОХНОВЕНИЕ ${Math.round(this.player.energy)}%`, 16, 50, 5, this.player.energy >= 100 ? PALETTE.yellow : PALETTE.cream);

    const objectiveW = Math.min(280, W - 184);
    const objectiveX = W - objectiveW - 6;
    this.drawPanel(objectiveX, 6, objectiveW, 51);
    this.drawText(level.def.title, objectiveX + 7, 18, 7, PALETTE.cream);
    this.drawText(`ВЕЩИ ${level.collected}/${level.def.items.length}  •  НОТЫ ${this.save.notes.length}/48`, objectiveX + 7, 31, 6, level.collected >= level.def.items.length ? PALETTE.green : PALETTE.yellow);
    const totalTasks = level.tasks.length + (level.def.task.type === "return" ? 1 : 0);
    const taskLine = level.boss?.active
      ? `БОСС: ПЭДЫ ${level.switches.filter((pad) => pad.active).length}/3  •  ОЧКИ ${level.score}`
      : totalTasks ? `${level.def.task.label}: ${this.taskDoneCount()}/${totalTasks}` : `ОЧКИ ${level.score}`;
    this.drawText(taskLine, objectiveX + 7, 45, totalTasks ? 5 : 6, this.sideTasksDone() ? PALETTE.green : PALETTE.cream);

    const player = this.player;
    let prompt = "";
    if (Math.hypot(level.npc.x - player.x, level.npc.y - player.y) < 48) {
      prompt = level.def.task.type === "return" && !level.returned ? "A — ПЕРЕДАТЬ НАХОДКИ" : "A — ПОГОВОРИТЬ";
    } else {
      for (const task of level.tasks) {
        if (task.active || Math.hypot(task.x - player.x, task.y - player.y) >= 48) continue;
        prompt = `${level.def.task.type === "ability" ? "B — СПОСОБНОСТЬ" : "A — ДЕЙСТВИЕ"}: ${task.name}`;
        break;
      }
    }
    if (!prompt && circleRect(player.x, player.y, 35, level.exit)) prompt = this.exitOpen() ? "A — ВОЙТИ В КЛУБ" : "ВЫХОД ЗАКРЫТ";
    if (prompt) this.drawText(prompt, W / 2, 70, 7, this.exitOpen() ? PALETTE.green : PALETTE.cream, "center");
    else if (level.combo > 1) this.drawText(`СЕРИЯ ×${level.combo}  •  ОЧКИ ${level.score}`, W / 2, 70, 8, PALETTE.yellow, "center");
    else if (level.hintClock > 12) {
      const target = level.items.find((item) => !item.collected) ?? level.tasks.find((task) => !task.active);
      if (target) {
        const angle = Math.atan2(target.y - player.y, target.x - player.x);
        this.drawText(`${angle > -0.8 && angle < 0.8 ? "→" : angle >= 0.8 && angle < 2.4 ? "↓" : angle <= -0.8 && angle > -2.4 ? "↑" : "←"} ПОДСКАЗКА`, W / 2, 70, 7, PALETTE.yellow, "center");
      }
    }
    if (this.barkTime > 0 && this.bark) {
      const width = Math.min(W - 100, 420);
      this.drawPanel(W / 2 - width / 2, this.viewHeight - 68, width, 44);
      this.drawWrapped(this.bark, W / 2 - width / 2 + 9, this.viewHeight - 52, width - 18, 8, PALETTE.cream, 11, 3);
    }
  }

  private renderDialogue(): void {
    const level = this.level;
    if (!level) return;
    const W = this.viewWidth, H = this.viewHeight;
    this.ctx.fillStyle = "rgba(20,12,25,.45)"; this.ctx.fillRect(0, 0, W, H);
    this.drawPanel(36, H - 103, W - 72, 83);
    this.drawSprite(level.def.char, 73, H - 25, 68, false);
    this.drawText(level.npc.name.toUpperCase(), 116, H - 82, 10, PALETTE.hotPink);
    this.drawWrapped(level.npc.line, 116, H - 65, W - 164, 8, PALETTE.cream, 12, 3);
    this.drawText("A / E — ДАЛЬШЕ", W - 48, H - 29, 7, PALETTE.yellow, "right");
  }

  private renderPause(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.ctx.fillStyle = "rgba(22,12,28,.72)"; this.ctx.fillRect(0, 0, W, H);
    this.drawPanel(W / 2 - 112, 38, 224, 197);
    this.drawText("ПАУЗА", W / 2, 69, 21, PALETTE.hotPink, "center");
    this.drawButton(W / 2 - 83, 88, 166, 29, "ПРОДОЛЖИТЬ", "resume", true);
    if (!this.concert) this.drawButton(W / 2 - 83, 125, 166, 27, "НАЧАТЬ УРОВЕНЬ ЗАНОВО", "restart", true);
    this.drawButton(W / 2 - 83, 160, 166, 27, this.concert ? "ВЫБОР ГЕРОЯ" : "ВЫБОР ГЕРОЯ", "select", true);
    this.drawText(this.audio.muted ? "M — ВКЛЮЧИТЬ ЗВУК" : "M — ВЫКЛЮЧИТЬ ЗВУК", W / 2, 211, 8, PALETTE.cream, "center");
  }

  private renderLevelComplete(): void {
    const level = this.level;
    if (!level) return;
    const W = this.viewWidth, H = this.viewHeight;
    this.ctx.fillStyle = "rgba(22,12,28,.76)"; this.ctx.fillRect(0, 0, W, H);
    this.drawPanel(W / 2 - 165, 20, 330, 228);
    this.drawText(level.def.chapter === 3 ? "ДОШЛА ДО КЛУБА!" : "ГЛАВА ПРОЙДЕНА!", W / 2, 49, 17, PALETTE.hotPink, "center");
    const rank = level.hits === 0 && level.score >= 700 ? "S" : level.hits <= 1 ? "A" : level.hits <= 3 ? "B" : "C";
    this.drawSprite(level.def.char, W / 2 - 105, 192, 94, false);
    this.drawText(level.def.location, W / 2 - 43, 76, 7, PALETTE.cream);
    this.drawText(`РАНГ ${rank}  •  ОЧКИ ${level.score}`, W / 2 - 43, 99, 10, rank === "S" ? PALETTE.yellow : PALETTE.hotPink);
    this.drawText(`ВРЕМЯ: ${Math.floor(level.elapsed / 60)}:${String(Math.floor(level.elapsed % 60)).padStart(2, "0")}`, W / 2 - 43, 120, 7, PALETTE.yellow);
    this.drawText(`УДАРЫ: ${level.hits}  •  НОТЫ: ${this.save.notes.length}/48`, W / 2 - 43, 138, 7, PALETTE.cream);
    this.drawButton(W / 2 - 43, 155, 144, 27, level.def.chapter === 3 ? "В ГРИМЕРКУ" : "ДАЛЬШЕ", "next", true);
    this.drawButton(W / 2 - 43, 188, 144, 23, "ВЫБОР ГЕРОЯ", "select", true);
    this.drawWrapped(level.def.outro, W / 2 - 145, 222, 290, 6, "#e0c2d4", 9, 2, "center");
  }

  private renderGameover(): void {
    const W = this.viewWidth, H = this.viewHeight;
    this.ctx.fillStyle = "rgba(28,12,25,.78)"; this.ctx.fillRect(0, 0, W, H);
    this.drawPanel(W / 2 - 130, 57, 260, 156);
    this.drawText("НЕУДАЧНЫЙ ДУБЛЬ", W / 2, 88, 18, PALETTE.red, "center");
    const phrase = this.level ? characterById(this.level.def.char).hit : "Попробуем ещё раз.";
    this.drawWrapped(phrase, W / 2 - 100, 108, 200, 8, PALETTE.cream, 12, 2, "center");
    this.drawButton(W / 2 - 90, 141, 180, 29, "ЕЩЁ РАЗ", "restart", true);
    this.drawButton(W / 2 - 90, 178, 180, 24, "ВЫБОР ГЕРОЯ", "select", true);
  }

  private renderConcert(): void {
    const concert = this.concert;
    if (!concert) return;
    const W = this.viewWidth, H = this.viewHeight;
    const ctx = this.ctx;
    ctx.fillStyle = "#1c1228"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#4a2555"; ctx.fillRect(0, 30, W, 95);
    for (let i = 0; i < 8; i++) {
      ctx.globalAlpha = 0.12; ctx.fillStyle = CHARACTERS[i % 4].color;
      ctx.beginPath(); ctx.moveTo(i * W / 8, 30); ctx.lineTo(i * W / 8 - 35, 150); ctx.lineTo(i * W / 8 + 60, 150); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const spacing = Math.min(100, W / 5);
    for (let i = 0; i < 4; i++) this.drawSprite(CHARACTERS[i].id, W / 2 + (i - 1.5) * spacing, 126, 64 + concert.laneFlash[i] * 8, false);
    ctx.fillStyle = "#2a1b31"; ctx.fillRect(0, 126, W, H - 126);
    for (let x = 12; x < W; x += 25) {
      ctx.fillStyle = x % 50 ? "#50304f" : "#38263f";
      ctx.fillRect(x, H - 45 - (x % 3) * 5, 15, 35);
      ctx.fillRect(x + 3, H - 53 - (x % 3) * 5, 9, 9);
    }
    const laneWidth = 48;
    const startX = W / 2 - laneWidth * 2;
    const targetY = H - 63;
    for (let lane = 0; lane < 4; lane++) {
      ctx.globalAlpha = 0.2 + concert.laneFlash[lane] * 0.35;
      ctx.fillStyle = CHARACTERS[lane].color;
      ctx.fillRect(startX + lane * laneWidth, 132, laneWidth - 3, H - 145);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = CHARACTERS[lane].color; ctx.lineWidth = 2;
      ctx.strokeRect(startX + lane * laneWidth + 3, targetY - 8, laneWidth - 9, 16);
      this.drawText(String(lane + 1), startX + lane * laneWidth + 21, targetY + 4, 9, PALETTE.cream, "center");
    }
    for (const note of concert.notes) {
      if (note.hit || note.missed) continue;
      const y = targetY - (note.time - concert.time) * 74;
      if (y < 126 || y > H) continue;
      ctx.fillStyle = CHARACTERS[note.lane].color;
      ctx.fillRect(startX + note.lane * laneWidth + 8, y - 5, laneWidth - 19, 10);
      ctx.fillStyle = PALETTE.cream; ctx.fillRect(startX + note.lane * laneWidth + 14, y - 2, laneWidth - 31, 4);
    }
    this.drawText(`СЧЁТ ${concert.score}`, 10, 17, 10, PALETTE.cream);
    this.drawText(`КОМБО ${concert.combo}`, W / 2, 17, 10, PALETTE.yellow, "center");
    this.drawText(`${Math.max(0, Math.ceil(GAME_CONFIG.CONCERT_DURATION - concert.time))}`, W - 12, 17, 10, PALETTE.hotPink, "right");
  }

  private renderFinale(): void {
    const concert = this.concert;
    const W = this.viewWidth, H = this.viewHeight;
    this.renderMenuBackground();
    const accuracy = concert && concert.hits + concert.misses ? Math.round(concert.hits / (concert.hits + concert.misses) * 100) : 0;
    this.drawText("КОНЦЕРТ СОСТОЯЛСЯ!", W / 2, 37, 22, PALETTE.hotPink, "center");
    this.drawText(accuracy >= 90 ? "ПОЛНЫЙ ЗАЛ!" : accuracy >= 70 ? "НЕОНОВЫЙ КОНЦЕРТ!" : "САХАРНАЯ СЦЕНА!", W / 2, 60, 11, PALETTE.yellow, "center");
    const spacing = Math.min(105, W / 5);
    for (let i = 0; i < 4; i++) this.drawSprite(CHARACTERS[i].id, W / 2 + (i - 1.5) * spacing, 170, 90 + Math.sin(this.time * 4 + i) * 3, false);
    this.drawText(`ТОЧНОСТЬ ${accuracy}%  •  МАКС. КОМБО ${concert?.maxCombo ?? 0}  •  СЧЁТ ${concert?.score ?? 0}`, W / 2, 187, 9, PALETTE.cream, "center");
    this.drawButton(W / 2 - 128, 207, 122, 29, "НА БИС", "concert", true);
    this.drawButton(W / 2 + 6, 207, 122, 29, "В МЕНЮ", "title", true);
    this.drawText(`ЛУЧШАЯ ТОЧНОСТЬ: ${this.save.bestConcert}%`, W / 2, 252, 8, "#c69bb8", "center");
  }

  private drawSprite(id: CharacterId, x: number, feetY: number, height: number, flip: boolean, rotation = 0, scaleY = 1): void {
    const image = this.images[id];
    if (!image?.complete || !image.naturalWidth) return;
    const ctx = this.ctx;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(feetY));
    if (flip) ctx.scale(-1, 1);
    if (rotation) ctx.rotate(rotation);
    if (scaleY !== 1) ctx.scale(1, scaleY);
    ctx.fillStyle = "rgba(20,12,22,.28)";
    ctx.fillRect(-width * 0.25, -3, width * 0.5, 3);
    ctx.drawImage(image, Math.round(-width / 2), Math.round(-height), Math.round(width), Math.round(height));
    ctx.restore();
  }

  private drawHeart(x: number, y: number, full: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = full ? PALETTE.red : "#5d4055";
    ctx.fillRect(x, y, 5, 5); ctx.fillRect(x + 8, y, 5, 5);
    ctx.fillRect(x - 2, y + 3, 17, 6); ctx.fillRect(x + 1, y + 9, 11, 4); ctx.fillRect(x + 5, y + 13, 4, 3);
  }

  private drawPanel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#170e1e"; ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = PALETTE.purple; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PALETTE.panel; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = "#4c2d56"; ctx.fillRect(x + 4, y + 4, w - 8, 2);
  }

  private drawButton(x: number, y: number, w: number, h: number, label: string, action: string, enabled: boolean, selected = false): void {
    const ctx = this.ctx;
    this.uiButtons.push({ x, y, w, h, label, action, enabled });
    ctx.fillStyle = enabled ? selected ? PALETTE.hotPink : "#6b3867" : "#3d3041";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = enabled ? selected ? "#a44479" : "#4b294d" : "#2d2631";
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    ctx.fillStyle = enabled ? PALETTE.cream : "#756979";
    ctx.fillRect(x + 3, y + 3, w - 6, 2);
    this.drawText(label, x + w / 2, y + h / 2 + 3, Math.min(9, Math.max(6, w / Math.max(12, label.length * 0.75))), enabled ? PALETTE.cream : "#817382", "center");
  }

  private textFont(size: number): string {
    const readableSize = size <= 7 ? size + 1 : size;
    return `700 ${readableSize}px "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
  }

  private drawText(text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left"): void {
    const ctx = this.ctx;
    ctx.font = this.textFont(size);
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    ctx.fillText(text, Math.round(x), Math.round(y));
  }

  private drawWrapped(text: string, x: number, y: number, maxWidth: number, size: number, color: string, lineHeight: number, maxLines: number, align: CanvasTextAlign = "left"): void {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    this.ctx.font = this.textFont(size);
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
      else line = candidate;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      let drawX = x;
      if (align === "center") drawX = x + maxWidth / 2;
      this.drawText(lines[i], drawX, y + i * lineHeight, size, color, align);
    }
  }

  private exposeDebug(): void {
    window.__gameProbe = () => ({ x: this.player.x, y: 0, z: this.player.y });
    window.__gameStats = () => ({
      fps: this.fps,
      enemies: this.level?.enemies.filter((enemy) => enemy.alive).length ?? 0,
      projectiles: this.projectiles.filter((projectile) => projectile.active).length,
      particles: this.particles.filter((particle) => particle.active).length,
      mode: this.mode,
      canvas: { width: this.viewWidth, height: this.viewHeight },
    });
    window.__gameDebug = {
      state: () => this.mode,
      startLevel: (character: CharacterId, chapter: number) => {
        const previous = levelsFor(character).slice(0, chapter).map((level) => level.id);
        for (const id of previous) if (!this.save.completed.includes(id)) this.save.completed.push(id);
        this.startLevel(character, chapter);
      },
      completeLevel: () => {
        if (!this.level) return;
        this.level.collected = this.level.def.items.length;
        for (const task of this.level.tasks) task.active = true;
        this.level.returned = true;
        if (this.level.boss) this.level.boss.active = false;
        this.completeLevel();
      },
      unlockAll: () => { this.save.completed = LEVELS.map((level) => level.id); writeSave(this.save); this.setMode("select"); },
      gameover: () => { this.player.hearts = 0; this.setMode("gameover"); },
      startConcert: () => { this.save.completed = LEVELS.map((level) => level.id); this.startConcert(); },
      finishConcert: () => { if (this.concert) this.concert.time = GAME_CONFIG.CONCERT_DURATION - 0.02; },
      damage: () => this.damagePlayer(1, 0),
      charge: () => { this.player.energy = 100; },
      teleport: (x: number, y: number) => { this.player.x = x; this.player.y = y; this.player.prevX = x; this.player.prevY = y; },
      defeatBoss: () => { if (this.level?.boss) this.level.boss.active = false; },
      snapshot: () => ({
        mode: this.mode,
        level: this.level?.def.id ?? null,
        collected: this.level?.collected ?? 0,
        required: this.level?.def.items.length ?? 0,
        items: this.level?.items.map((item) => ({ key: item.key, x: item.x, y: item.y, note: item.note, collected: item.collected })) ?? [],
        boss: this.level?.boss ? { x: this.level.boss.x, y: this.level.boss.y, hp: this.level.boss.hp, active: this.level.boss.active, vulnerable: this.level.boss.vulnerable } : null,
        pads: this.level?.switches.map((pad) => ({ x: pad.x, y: pad.y, active: pad.active })) ?? [],
        tasks: this.level?.tasks.map((task) => ({ x: task.x, y: task.y, index: task.index, active: task.active, name: task.name })) ?? [],
        returned: this.level?.returned ?? false,
        taskType: this.level?.def.task.type ?? "none",
        npc: this.level?.npc ?? null,
        score: this.level?.score ?? 0,
        energy: this.player.energy,
        exit: this.level?.exit ?? null,
        concert: this.concert ? { time: this.concert.time, hits: this.concert.hits, misses: this.concert.misses, score: this.concert.score } : null,
        save: { completed: this.save.completed.length, notes: this.save.notes.length },
      }),
    };
  }
}
