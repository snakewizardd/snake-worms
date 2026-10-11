import { VIEW_H, VIEW_W } from './config.ts';
import { Game } from './game.ts';
import { Input } from './input.ts';
import { sfx } from './audio.ts';
import { drawText } from './font.ts';
import { Front } from './menu.ts';
import { renderGame, ui } from './render.ts';
import { loadSettings } from './settings.ts';
import type { Settings } from './settings.ts';
import { THEMES, THEME_ORDER } from './themes.ts';
import { MENU_ROWS } from './weapons.ts';
import { rng } from './util.ts';
import { arenaAvailable } from './arena/wsLink.ts';

type ArenaModule = typeof import('./arena/run.ts');
let arenaMod: ArenaModule | null = null;
// Only exists under `npm run arena`; the production build drops this branch (and the whole arena runtime).
if (import.meta.env.MODE === 'arena') {
  void import('./arena/run.ts').then((m) => {
    arenaMod = m;
    m.resizeBroadcast();
  });
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

function resize(): void {
  const fit = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = `${Math.floor(VIEW_W * fit)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * fit)}px`;
  arenaMod?.resizeBroadcast();
}
window.addEventListener('resize', resize);
resize();

const input = new Input(window);
input.onFirstGesture = () => sfx.unlock();
const settings = loadSettings();

type Scene = 'front' | 'loading' | 'game';
let scene: Scene = 'front';
let front: Front | null = new Front(input, settings);
let game: Game | null = null;
let pending: Settings | null = null;
let loadingFrames = 0;
const expose = window as unknown as { game: Game | null; sfx: typeof sfx };
expose.sfx = sfx;

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function startMatch(s: Settings): void {
  pending = s;
  scene = 'loading';
  loadingFrames = 0;
  sfx.stopMusic();
  sfx.stopAmbience();
}

function exitGame(action: 'menu' | 'restart'): void {
  if (arenaMod?.active()) {
    if (arenaMod.blocking()) return;
    arenaMod.leave();
    action = 'menu';
  }
  if (action === 'restart' && game) {
    startMatch({ ...game.settings });
    return;
  }
  sfx.stopAmbience();
  game = null;
  expose.game = null;
  front = new Front(input, settings, 'main');
  scene = 'front';
}

function screenshot(): void {
  const big = document.createElement('canvas');
  big.width = VIEW_W * 3;
  big.height = VIEW_H * 3;
  const b = big.getContext('2d')!;
  b.imageSmoothingEnabled = false;
  b.drawImage(canvas, 0, 0, big.width, big.height);
  big.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `snakes-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  sfx.coin();
}

function step(): void {
  const typing = scene === 'front' && front?.typing;
  if (!typing && input.pressed('fullscreen')) toggleFullscreen();
  if (!typing && input.pressed('screenshot')) screenshot();
  if (scene === 'front' && front) {
    const r = front.update();
    if (r) {
      sfx.unlock();
      startMatch(r.start);
    }
  } else if (scene === 'game' && game) {
    const g = game;
    g.update();
    // Leaving the match (menu/rematch) replaces or clears `game` during update.
    if (game !== g) return;
    if (sfx.ctx?.state === 'running') sfx.startAmbience();
    if (arenaMod?.active()) {
      arenaMod.tick(g);
      return;
    }
    const cpuTurn = !!g.active && g.active.team.cpu && !g.paused;
    if (cpuTurn && input.isHeld('fire')) {
      input.endTick();
      g.update();
      if (game === g) g.update();
    }
  }
}

function draw(): void {
  if (scene === 'front' && front) front.draw(ctx);
  else if (scene === 'loading') {
    ctx.fillStyle = '#0d1030';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawText(ctx, 'RAISING A NEW ISLAND...', VIEW_W / 2, VIEW_H / 2 - 8, { scale: 2, align: 'center', color: '#7ccf3e' });
    if (++loadingFrames >= 2 && pending) {
      const themeId = pending.theme === 'random' ? rng.pick(THEME_ORDER) : pending.theme;
      game = new Game(input, pending, THEMES[themeId], rng.int(1, 2 ** 31 - 1));
      game.onExit = exitGame;
      expose.game = game;
      front = null;
      if (pending.mode === 'arena' && pending.arena && arenaAvailable() && arenaMod) arenaMod.begin(game, pending, canvas);
      pending = null;
      scene = 'game';
    }
  } else if (scene === 'game' && game) {
    renderGame(ctx, game);
    arenaMod?.draw(game, canvas);
  }
}

// ---------------------------------------------------------------- mouse

function toCanvas(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
}

function hitRect(x: number, y: number): string | null {
  for (const r of ui.rects) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.act;
  return null;
}

let drag: { x: number; y: number; moved: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  const p = toCanvas(e);
  if (scene === 'front' && front) {
    if (e.button === 0) {
      const r = front.click(p.x, p.y);
      if (r) {
        sfx.unlock();
        startMatch(r.start);
      }
    }
    return;
  }
  if (scene !== 'game' || !game) return;
  if (e.button === 2) {
    if (game.humanTurn && (game.phase === 'play' || game.phase === 'intro')) {
      if (game.menuOpen) game.menuOpen = false;
      else game.openMenu();
    }
    return;
  }
  if (e.button === 0) {
    const act = hitRect(p.x, p.y);
    if (act) {
      if (act === 'minimap') {
        const m = ui.rects.find((r) => r.act === 'minimap')!;
        game.centerCamera(((p.x - m.x) / m.w) * 1920, ((p.y - m.y) / m.h) * 900);
      } else if (act === 'menu') {
        if (game.humanTurn) game.openMenu();
      } else if (act.startsWith('weapon:')) {
        const [, r, c] = act.split(':').map(Number) as [number, number, number];
        game.menuRow = r;
        game.menuCol = c;
        if (game.selectWeapon(MENU_ROWS[r]![1][c]!)) game.menuOpen = false;
      } else if (act.startsWith('pause:')) game.pauseChoose(Number(act.split(':')[1]));
      return;
    }
    if (game.menuOpen) {
      game.menuOpen = false;
      return;
    }
    if (game.clickWorld(p.x, p.y)) return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (scene !== 'game' || !game) return;
  const p = toCanvas(e);
  game.mouseMove(p.x, p.y);
  if (game.menuOpen) {
    const act = hitRect(p.x, p.y);
    if (act?.startsWith('weapon:')) {
      const [, r, c] = act.split(':').map(Number) as [number, number, number];
      game.menuRow = r;
      game.menuCol = c;
    }
  }
  if (!drag) return;
  const k = VIEW_W / canvas.getBoundingClientRect().width;
  const dx = (e.clientX - drag.x) * k;
  const dy = (e.clientY - drag.y) * k;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  game.panCamera(-dx, -dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointerleave', () => {
  if (game) game.mouse.inside = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (scene !== 'game' || !game) return;
    const p = toCanvas(e);
    game.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  },
  { passive: false },
);

// ---------------------------------------------------------------- loop

const TICK = 1 / 60;
let last = performance.now();
let acc = 0;
let lastError = '';
function frame(now: number): void {
  requestAnimationFrame(frame);
  try {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= TICK) {
      input.poll();
      step();
      input.endTick();
      acc -= TICK;
    }
    draw();
  } catch (e) {
    acc = 0;
    const msg = String((e as Error).stack ?? e);
    if (msg !== lastError) {
      lastError = msg;
      console.error(e);
    }
  }
}
requestAnimationFrame(frame);
