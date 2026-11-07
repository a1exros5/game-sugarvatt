import { INPUT_CONFIG } from "./config";

const DIRECTION_KEYS: Record<string, ["x" | "z", 1 | -1]> = {
  KeyW: ["z", 1], ArrowUp: ["z", 1],
  KeyS: ["z", -1], ArrowDown: ["z", -1],
  KeyA: ["x", -1], ArrowLeft: ["x", -1],
  KeyD: ["x", 1], ArrowRight: ["x", 1],
};

/** Keyboard + multi-touch virtual controls. W/up always moves toward the top of the map. */
export class Input {
  moveX = 0;
  moveZ = 0;
  readonly actions = new Set<string>();
  private held = new Set<string>();
  private touchX = 0;
  private touchZ = 0;
  private stickPointer: number | null = null;
  private unsubscribe: Array<() => void> = [];

  constructor(_target: HTMLElement) {
    const on = <T extends Event>(el: Window | Document | HTMLElement, type: string, fn: (event: T) => void, options?: AddEventListenerOptions) => {
      const handler = fn as EventListener;
      el.addEventListener(type, handler, options);
      this.unsubscribe.push(() => el.removeEventListener(type, handler, options));
    };

    on<KeyboardEvent>(window, "keydown", (event) => {
      if (DIRECTION_KEYS[event.code] || event.code === "Space") event.preventDefault();
      if (event.repeat) return;
      if (DIRECTION_KEYS[event.code]) this.held.add(event.code);
      this.actions.add(event.code);
      if (event.code === "KeyE" || event.code === "Enter") this.actions.add("interact");
      if (event.code === "Space") this.actions.add("ability");
      if (event.code === "Escape" || event.code === "KeyP") this.actions.add("pause");
      if (event.code === "KeyM") this.actions.add("mute");
      if (event.code.startsWith("Digit") && Number(event.code.slice(5)) >= 1 && Number(event.code.slice(5)) <= 4) {
        this.actions.add(`lane${Number(event.code.slice(5)) - 1}`);
      }
      this.recomputeAxes();
    });
    on<KeyboardEvent>(window, "keyup", (event) => {
      this.held.delete(event.code);
      this.recomputeAxes();
    });
    on(window, "blur", () => this.resetAll());
    on(document, "visibilitychange", () => { if (document.hidden) this.resetAll(); });

    const stick = document.getElementById("pixel-joystick");
    if (stick) {
      const updateStick = (event: PointerEvent) => {
        if (this.stickPointer !== event.pointerId) return;
        const rect = stick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = event.clientX - cx;
        let dy = event.clientY - cy;
        const distance = Math.hypot(dx, dy);
        const range = Math.min(INPUT_CONFIG.JOYSTICK_RANGE, rect.width * 0.34);
        if (distance > range) { dx = dx / distance * range; dy = dy / distance * range; }
        const dead = INPUT_CONFIG.JOYSTICK_DEAD_ZONE;
        this.touchX = Math.abs(dx) < dead ? 0 : clamp(dx / range, -1, 1);
        this.touchZ = Math.abs(dy) < dead ? 0 : clamp(-dy / range, -1, 1);
        stick.style.setProperty("--stick-x", `${dx}px`);
        stick.style.setProperty("--stick-y", `${dy}px`);
        this.recomputeAxes();
      };
      on<PointerEvent>(stick, "pointerdown", (event) => {
        if (this.stickPointer !== null) return;
        event.preventDefault();
        this.stickPointer = event.pointerId;
        stick.setPointerCapture(event.pointerId);
        stick.classList.add("is-active");
        updateStick(event);
      });
      on<PointerEvent>(stick, "pointermove", updateStick);
      const release = (event: PointerEvent) => {
        if (this.stickPointer !== event.pointerId) return;
        this.stickPointer = null;
        this.touchX = 0; this.touchZ = 0;
        stick.style.setProperty("--stick-x", "0px");
        stick.style.setProperty("--stick-y", "0px");
        stick.classList.remove("is-active");
        this.recomputeAxes();
      };
      on<PointerEvent>(stick, "pointerup", release);
      on<PointerEvent>(stick, "pointercancel", release);
    }

    const bindAction = (id: string, action: string) => {
      const element = document.getElementById(id);
      if (!element) return;
      on<PointerEvent>(element, "pointerdown", (event) => {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        element.classList.add("is-pressed");
        this.actions.add(action);
      });
      const release = () => element.classList.remove("is-pressed");
      on<PointerEvent>(element, "pointerup", release);
      on<PointerEvent>(element, "pointercancel", release);
    };
    bindAction("button-a", "interact");
    bindAction("button-b", "ability");
    bindAction("button-pause", "pause");
    bindAction("button-mute", "mute");
    for (let lane = 0; lane < 4; lane++) bindAction(`lane-${lane}`, `lane${lane}`);
  }

  consumeAction(code: string): boolean {
    const present = this.actions.has(code);
    if (present) this.actions.delete(code);
    return present;
  }

  clearActions(): void { this.actions.clear(); }

  private recomputeAxes(): void {
    let x = this.touchX;
    let z = this.touchZ;
    for (const code of this.held) {
      const mapping = DIRECTION_KEYS[code];
      if (!mapping) continue;
      if (mapping[0] === "x") x += mapping[1]; else z += mapping[1];
    }
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    this.moveX = clamp(x, -1, 1);
    this.moveZ = clamp(z, -1, 1);
  }

  private resetAll(): void {
    this.held.clear();
    this.touchX = 0; this.touchZ = 0;
    this.stickPointer = null;
    this.recomputeAxes();
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.actions.clear();
    this.resetAll();
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
