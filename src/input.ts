export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'fire' | 'jump' | 'backflip'
  | 'nextWeapon' | 'prevWeapon'
  | 'fuse1' | 'fuse2' | 'fuse3' | 'fuse4' | 'fuse5' | 'fuseCycle'
  | 'confirm' | 'back' | 'pause' | 'mute' | 'fullscreen' | 'debug' | 'newMatch'
  | 'menu' | 'camLeft' | 'camRight' | 'camUp' | 'camDown' | 'center' | 'zoomIn' | 'zoomOut' | 'zoomCycle' | 'screenshot';

export interface Pad {
  isHeld(a: Action): boolean;
  pressed(a: Action): boolean;
  released(a: Action): boolean;
  heldFor(a: Action): number;
}

const KEYMAP: Record<string, Action[]> = {
  ArrowLeft: ['left'], ArrowRight: ['right'], ArrowUp: ['up'], ArrowDown: ['down'],
  KeyA: ['camLeft'], KeyD: ['camRight'], KeyW: ['camUp'], KeyS: ['camDown'], KeyC: ['center'], Home: ['center'],
  Equal: ['zoomIn'], NumpadAdd: ['zoomIn'], Minus: ['zoomOut'], NumpadSubtract: ['zoomOut'], KeyZ: ['zoomCycle'], KeyK: ['screenshot'],
  Space: ['fire', 'confirm'],
  Enter: ['jump', 'confirm'], NumpadEnter: ['jump', 'confirm'],
  Backspace: ['backflip'],
  Tab: ['menu'], KeyE: ['nextWeapon'], KeyQ: ['prevWeapon'],
  Digit1: ['fuse1'], Digit2: ['fuse2'], Digit3: ['fuse3'], Digit4: ['fuse4'], Digit5: ['fuse5'],
  Escape: ['pause', 'back'], KeyP: ['pause'],
  KeyM: ['mute'], KeyF: ['fullscreen'], Backquote: ['debug'], KeyN: ['newMatch'],
};

// Standard gamepad mapping (Xbox layout): A=0 B=1 X=2 Y=3 LB=4 RB=5 Back=8 Start=9, D-pad 12-15.
const PADMAP: Array<[number, Action[]]> = [
  [0, ['fire', 'confirm']],
  [1, ['jump', 'back']],
  [2, ['backflip']],
  [3, ['menu']],
  [5, ['nextWeapon']],
  [4, ['fuseCycle']],
  [9, ['pause', 'confirm']],
  [8, ['mute']],
  [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']],
];

const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Backspace', 'Tab', 'Enter', 'Equal', 'Minus']);

export class Input implements Pad {
  private held = new Set<Action>();
  private kbHeld = new Map<string, boolean>();
  private padHeld = new Set<Action>();
  private down = new Set<Action>();
  private up = new Set<Action>();
  private prevPad = new Set<Action>();
  private holdTicks = new Map<Action, number>();
  onFirstGesture: (() => void) | null = null;
  padConnected = false;
  typed: string[] = [];

  /** Characters typed since the last call (for name entry). */
  takeText(): string {
    const s = this.typed.join('');
    this.typed.length = 0;
    return s;
  }

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      this.gesture();
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.key.length === 1 && /^[a-zA-Z0-9 '!?.\-]$/.test(e.key)) this.typed.push(e.key.toUpperCase());
      this.kbHeld.set(e.code, true);
      for (const a of KEYMAP[e.code] ?? []) this.down.add(a);
    });
    target.addEventListener('keyup', (e) => {
      this.kbHeld.set(e.code, false);
      for (const a of KEYMAP[e.code] ?? []) this.up.add(a);
    });
    target.addEventListener('blur', () => this.kbHeld.clear());
    target.addEventListener('pointerdown', () => this.gesture());
  }

  private gesture(): void {
    if (this.onFirstGesture) this.onFirstGesture();
  }

  /** Call once per fixed tick before game logic. */
  poll(): void {
    this.padHeld.clear();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    this.padConnected = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.padConnected = true;
      for (const [idx, acts] of PADMAP) if (p.buttons[idx]?.pressed) for (const a of acts) this.padHeld.add(a);
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (ax < -0.4) this.padHeld.add('left');
      if (ax > 0.4) this.padHeld.add('right');
      if (ay < -0.4) this.padHeld.add('up');
      if (ay > 0.4) this.padHeld.add('down');
      const rx = p.axes[2] ?? 0;
      const ry = p.axes[3] ?? 0;
      if (rx < -0.4) this.padHeld.add('camLeft');
      if (rx > 0.4) this.padHeld.add('camRight');
      if (ry < -0.4) this.padHeld.add('camUp');
      if (ry > 0.4) this.padHeld.add('camDown');
    }
    for (const a of this.padHeld) if (!this.prevPad.has(a)) this.down.add(a);
    for (const a of this.prevPad) if (!this.padHeld.has(a)) this.up.add(a);
    this.prevPad = new Set(this.padHeld);

    this.held.clear();
    for (const [code, on] of this.kbHeld) if (on) for (const a of KEYMAP[code] ?? []) this.held.add(a);
    for (const a of this.padHeld) this.held.add(a);
    for (const a of ['left', 'right', 'up', 'down', 'fire', 'camLeft', 'camRight', 'camUp', 'camDown'] as Action[]) {
      this.holdTicks.set(a, this.held.has(a) ? (this.holdTicks.get(a) ?? 0) + 1 : 0);
    }
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }
  pressed(a: Action): boolean {
    return this.down.has(a);
  }
  released(a: Action): boolean {
    return this.up.has(a);
  }
  heldFor(a: Action): number {
    return this.holdTicks.get(a) ?? 0;
  }

  /** Call once per fixed tick after game logic. */
  endTick(): void {
    this.down.clear();
    this.up.clear();
    if (this.typed.length > 32) this.typed.length = 0;
  }

  /** Lets tests and the debug console drive the game. */
  inject(a: Action, isDown: boolean): void {
    const code = `virtual:${a}`;
    KEYMAP[code] = [a];
    this.kbHeld.set(code, isDown);
    (isDown ? this.down : this.up).add(a);
  }
}

/** Scripted controller the CPU uses, so its turns run through the same controls as a human's. */
export class VirtualPad implements Pad {
  private held = new Set<Action>();
  private down = new Set<Action>();
  private up = new Set<Action>();
  private ticks = new Map<Action, number>();

  hold(a: Action, on: boolean): void {
    if (on && !this.held.has(a)) {
      this.held.add(a);
      this.down.add(a);
    } else if (!on && this.held.has(a)) {
      this.held.delete(a);
      this.up.add(a);
      this.ticks.set(a, 0);
    }
  }

  tap(a: Action): void {
    this.down.add(a);
  }

  releaseAll(): void {
    for (const a of [...this.held]) this.hold(a, false);
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }
  pressed(a: Action): boolean {
    return this.down.has(a);
  }
  released(a: Action): boolean {
    return this.up.has(a);
  }
  heldFor(a: Action): number {
    return this.ticks.get(a) ?? 0;
  }

  endTick(): void {
    this.down.clear();
    this.up.clear();
    for (const a of this.held) this.ticks.set(a, (this.ticks.get(a) ?? 0) + 1);
  }
}