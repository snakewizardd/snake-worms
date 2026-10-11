import { AIM, PHYS, VIEW_H, VIEW_W, WORLD_H, WORLD_W } from './config.ts';
import { env } from './env.ts';
import type { Game } from './game.ts';
import type { Snake, Team } from './snake.ts';
import { drawText } from './font.ts';
import { drawWeaponIcon } from './items.ts';
import { MENU_ROWS, WEAPON_BY_ID, weaponName } from './weapons.ts';
import type { WeaponId } from './weapons.ts';
import { clamp, rng, TAU } from './util.ts';

export interface UiRect {
  x: number;
  y: number;
  w: number;
  h: number;
  act: string;
}

/** Clickable regions from the last frame, consumed by main.ts. */
export const ui: { rects: UiRect[] } = { rects: [] };

const MINI = { x: VIEW_W - 134, y: 4, w: 130, h: 61 };
const miniCache = new WeakMap<Game, { canvas: HTMLCanvasElement; version: number; at: number }>();

function sumHp(t: Team): number {
  return t.snakes.reduce((a, s) => a + (s.alive ? s.displayHp : 0), 0);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

export function renderGame(ctx: CanvasRenderingContext2D, g: Game): void {
  ui.rects = [];
  g.terrain.flush();
  const c = g.cam;
  const z = c.z;
  const vw = VIEW_W / z;
  const vh = VIEW_H / z;
  const sx = c.shake ? rng.range(-c.shake, c.shake) : 0;
  const sy = c.shake ? rng.range(-c.shake, c.shake) : 0;
  const cx = c.x + sx;
  const cy = c.y + sy;
  const bd = g.backdrop;
  ctx.imageSmoothingEnabled = false;
  if (bd) bd.drawBack(ctx, Math.max(0, Math.min(WORLD_W - VIEW_W, cx + vw / 2 - VIEW_W / 2)), Math.max(0, Math.min(WORLD_H - VIEW_H, cy + vh / 2 - VIEW_H / 2)), g.tick);

  ctx.save();
  ctx.scale(z, z);
  ctx.imageSmoothingEnabled = z < 0.99;
  if (bd) bd.drawWaterBack(ctx, cx, cy, g.tick, vw, vh);
  const tc = g.terrain.canvas;
  if (tc) {
    const x0 = Math.max(0, Math.floor(cx));
    const y0 = Math.max(0, Math.floor(cy));
    const x1 = Math.min(WORLD_W, Math.ceil(cx + vw));
    const y1 = Math.min(WORLD_H, Math.ceil(cy + vh));
    if (x1 > x0 && y1 > y0) ctx.drawImage(tc, x0, y0, x1 - x0, y1 - y0, x0 - cx, y0 - cy, x1 - x0, y1 - y0);
  }
  ctx.imageSmoothingEnabled = false;
  for (const p of g.props) p.draw(ctx, cx, cy, g.tick, g.theme);
  for (const f of g.flameList) f.draw(ctx, cx, cy, g.tick);
  for (const s of g.snakes) if (s !== g.active) s.draw(ctx, cx, cy);
  if (g.active) g.active.draw(ctx, cx, cy);
  for (const p of g.projectiles) p.draw(ctx, cx, cy, g.tick);
  g.particles.draw(ctx, cx, cy);
  drawAim(ctx, g, cx, cy);
  drawTargetCursor(ctx, g, cx, cy);
  drawGhosts(ctx, g, cx, cy);
  if (bd) bd.drawWaterFront(ctx, cx, cy, g.tick, vw, vh);
  ctx.restore();

  const toS = (x: number, y: number): [number, number] => [(x - cx) * z, (y - cy) * z];
  drawLabels(ctx, g, toS);
  drawThinking(ctx, g, toS);
  for (const p of g.projectiles) {
    if (p.showFuse > 0) {
      const [px, py] = toS(p.x, p.y);
      drawText(ctx, String(p.showFuse), px, py - 16, { align: 'center' });
    }
  }
  for (const p of g.popups) {
    const age = 100 - p.life;
    const [px, py] = toS(p.s.x, p.s.y);
    drawText(ctx, p.text, px, py - 46 - Math.min(age, 40) * 0.5, { color: p.color, scale: age < 6 ? 3 : 2, align: 'center', alpha: Math.min(1, p.life / 15) });
  }
  drawBubbles(ctx, g, toS);
  drawOffscreen(ctx, g, toS);
  if (bd) bd.drawMotes(ctx);
  drawHud(ctx, g);
  drawMinimap(ctx, g);
  if (g.menuOpen && g.active) drawWeaponMenu(ctx, g);
  if (g.paused) drawPause(ctx, g);
  if (g.debug) drawDebug(ctx, g);
}

function drawAim(ctx: CanvasRenderingContext2D, g: Game, cx: number, cy: number): void {
  const s = g.active;
  if (!s || !s.held || !(g.phase === 'play' || g.phase === 'intro') || g.cursorMode || g.menuOpen) return;
  const def = WEAPON_BY_ID[g.weapon];
  const usesAim = def.usage === 'charge' || (def.usage === 'targetCharge' && g.targetSet) || g.weapon === 'shotgun' || g.weapon === 'vine';
  if (!usesAim) return;
  const dx = Math.cos(s.aim) * s.facing;
  const dy = Math.sin(s.aim);
  const hx = s.x - cx;
  const hy = s.y - 7 - cy;
  const guide = g.settings.aimGuide;
  if (guide !== 'off' && !s.team.cpu && (def.usage === 'charge' || g.weapon === 'homing')) {
    const p = g.charging ? Math.max(0.06, g.power) : 0.6;
    const v = p * (def.maxSpeed ?? 10);
    let x = s.x + dx * 11;
    let y = s.y - 7 + dy * 11;
    let vx = dx * v;
    let vy = dy * v;
    const windy = g.weapon === 'bazooka' || g.weapon === 'venom';
    const n = guide === 'long' ? 80 : 24;
    ctx.fillStyle = g.charging ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    for (let t = 0; t < n; t++) {
      if (windy) vx += g.wind * PHYS.windAccel * (g.weapon === 'venom' ? 0.6 : 1);
      vy += PHYS.gravity;
      x += vx;
      y += vy;
      if (g.terrain.solid(x, y) || y > env.waterY) break;
      if (t % 2 === 0) ctx.fillRect(Math.round(x - cx), Math.round(y - cy), 1, 1);
    }
  }
  if (g.charging) {
    const n = Math.floor(g.power * 16);
    for (let i = 0; i < n; i++) {
      const t = i / 16;
      const d = 9 + i * 2.2;
      ctx.fillStyle = `rgb(255,${Math.round(230 - t * 200)},${Math.round(60 - t * 60)})`;
      ctx.beginPath();
      ctx.arc(hx + dx * d, hy + dy * d, 1 + t * 2.2, 0, TAU);
      ctx.fill();
    }
  }
  const pulse = 1 + Math.sin(g.tick * 0.2) * 0.4;
  const x = Math.round(hx + dx * AIM.crosshairDist);
  const y = Math.round(hy + dy * AIM.crosshairDist);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 3.5 + pulse, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#ff3b3b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 3.5 + pulse, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y - 1, 1, 3);
  ctx.fillRect(x - 1, y, 3, 1);
}

function drawTargetCursor(ctx: CanvasRenderingContext2D, g: Game, cx: number, cy: number): void {
  const s = g.active;
  if (!s || !(g.phase === 'play' || g.phase === 'intro') || g.menuOpen) return;
  const showTarget = g.targeting && (g.cursorMode || (!s.team.cpu && g.mouse.inside));
  const lockedHoming = g.weapon === 'homing' && g.targetSet;
  if (!showTarget && !lockedHoming) return;
  const x = g.tx - cx;
  const y = g.ty - cy;
  const t = g.tick;
  if (g.weapon === 'girder' && showTarget) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(g.girderAngle);
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 0.2);
    ctx.fillStyle = '#4a5260';
    ctx.fillRect(-32, -3.5, 64, 7);
    ctx.fillStyle = '#8d9aab';
    ctx.fillRect(-31, -2.5, 62, 5);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }
  if (g.weapon === 'teleport' && showTarget) {
    const ok = g.terrain.free(g.tx, g.ty, PHYS.snakeRadius + 1) && g.ty < env.waterY - 10;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = ok ? '#bff4ff' : '#ff4b4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 6 + Math.sin(t * 0.3), 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const r = 7 + Math.sin(t * 0.25) * 1.5;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = lockedHoming ? '#ff4b4b' : '#ffe14d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillRect(x - r - 4, y, 4, 1);
  ctx.fillRect(x + r, y, 4, 1);
  ctx.fillRect(x, y - r - 4, 1, 4);
  ctx.fillRect(x, y + r, 1, 4);
  if (g.weapon === 'airStrike' && showTarget) {
    const d = s.facing;
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(x - d * 18, y - 26);
    ctx.lineTo(x - d * 8, y - 22);
    ctx.lineTo(x - d * 16, y - 18);
    ctx.fill();
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, g: Game, toS: (x: number, y: number) => [number, number]): void {
  const small = g.cam.z < 0.55;
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const [sx, sy] = toS(s.x, s.y);
    if (sx < -40 || sx > VIEW_W + 40 || sy < -40 || sy > VIEW_H + 60) continue;
    const x = Math.round(sx);
    const def = s.team.def;
    const hpText = String(s.displayHp);
    const w = hpText.length * 6 + 4;
    const y = Math.round(sy - (small ? 22 : 34 * Math.max(0.7, g.cam.z)));
    if (!small) drawText(ctx, s.name, x, y, { color: def.light, align: 'center' });
    ctx.fillStyle = '#000';
    ctx.fillRect(x - w / 2 - 1, y + 9, w + 2, 11);
    ctx.fillStyle = s.poisoned ? '#3a9a2a' : def.color;
    ctx.fillRect(x - w / 2, y + 10, w, 9);
    drawText(ctx, hpText, x, y + 10, { color: '#fff', outline: null, align: 'center' });
    if (s === g.active && g.arrowT > 0) {
      const ay = y - 12 - Math.abs(Math.sin(g.tick * 0.15)) * 5;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x - 6, ay - 1);
      ctx.lineTo(x + 6, ay - 1);
      ctx.lineTo(x, ay + 7);
      ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.moveTo(x - 4, ay);
      ctx.lineTo(x + 4, ay);
      ctx.lineTo(x, ay + 5);
      ctx.fill();
    }
  }
}

function drawGhosts(ctx: CanvasRenderingContext2D, g: Game, cx: number, cy: number): void {
  for (const gh of g.ghosts) {
    const a = Math.min(1, gh.life / gh.max) * (gh.label === 'GO' ? 1 : gh.label === 'SIM' ? 0.85 : 0.5);
    ctx.globalAlpha = a;
    ctx.fillStyle = gh.color;
    const p = gh.pts;
    for (let i = 0; i + 1 < p.length; i += 2) {
      if ((i / 2) % 2 === 1) continue;
      ctx.fillRect(Math.round(p[i]! - cx), Math.round(p[i + 1]! - cy), gh.label === 'SEARCH' ? 1 : 2, gh.label === 'SEARCH' ? 1 : 2);
    }
    const ex = p[p.length - 2]! - cx;
    const ey = p[p.length - 1]! - cy;
    ctx.strokeStyle = gh.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey - 5);
    ctx.lineTo(ex + 5, ey + 5);
    ctx.moveTo(ex + 5, ey - 5);
    ctx.lineTo(ex - 5, ey + 5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawThinking(ctx: CanvasRenderingContext2D, g: Game, toS: (x: number, y: number) => [number, number]): void {
  const s = g.active;
  if (!s || !g.thinking || g.thinking.team !== s.team || !s.alive) return;
  const [sx, sy] = toS(s.x, s.y);
  const dots = '.'.repeat(1 + (Math.floor(g.tick / 15) % 3));
  const secs = Math.floor((g.tick - g.thinking.since) / 60);
  const y = Math.round(sy - (g.cam.z < 0.55 ? 36 : 50 * Math.max(0.7, g.cam.z)));
  drawText(ctx, `${g.thinking.status}${dots} ${secs}S`, Math.round(sx), y, { color: s.team.def.light, align: 'center' });
}

function drawBubbles(ctx: CanvasRenderingContext2D, g: Game, toS: (x: number, y: number) => [number, number]): void {
  for (const b of g.bubbles) {
    const [sx, sy] = toS(b.s.x, b.s.y);
    const lines = wrap(b.text, 22);
    const w = Math.max(...lines.map((l) => l.length)) * 6 + 8;
    const h = lines.length * 9 + 5;
    const x = Math.round(clamp(sx - w / 2, 2, VIEW_W - w - 2));
    const y = Math.round(clamp(sy - 52 * Math.max(0.7, g.cam.z) - h, 2, VIEW_H - h - 40));
    const a = Math.min(1, b.life / 15);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.beginPath();
    ctx.moveTo(clamp(sx, x + 4, x + w - 4) - 4, y + h);
    ctx.lineTo(clamp(sx, x + 4, x + w - 4), y + h + 6);
    ctx.lineTo(clamp(sx, x + 4, x + w - 4) + 3, y + h);
    ctx.fill();
    ctx.fillStyle = '#fffdf2';
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    lines.forEach((l, i) => drawText(ctx, l, x + 4, y + 2 + i * 9, { color: '#1a1a1a', outline: null, alpha: a }));
  }
}

function drawOffscreen(ctx: CanvasRenderingContext2D, g: Game, toS: (x: number, y: number) => [number, number]): void {
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const [sx, sy] = toS(s.x, s.y);
    if (sx >= 0 && sx <= VIEW_W && sy >= 0 && sy <= VIEW_H) continue;
    const x = clamp(sx, 12, VIEW_W - 12);
    const y = clamp(sy, 76, VIEW_H - 72);
    const a = Math.atan2(sy - y, sx - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.fill();
    ctx.fillStyle = s === g.active ? '#ffffff' : s.team.def.color;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4.5);
    ctx.lineTo(-4, 4.5);
    ctx.fill();
    ctx.restore();
    const tx = clamp(x - Math.cos(a) * 14, 14, VIEW_W - 14);
    const ty = clamp(y - Math.sin(a) * 12 - 4, 70, VIEW_H - 76);
    drawText(ctx, String(s.displayHp), tx, ty, { color: s.team.def.light, align: 'center' });
  }
}

function hint(g: Game): string {
  const s = g.active;
  if (!s || s.team.cpu) return '';
  if (g.menuOpen) return 'ARROWS PICK  SPACE SELECT  TAB CLOSE';
  if (g.phase === 'guide') return 'LEFT/RIGHT STEER   SPACE: DETONATE / TAKE OFF';
  if (s.state === 'rope') return 'L/R SWING  UP/DOWN REEL  SPACE LET GO';
  if (s.state === 'jet') return 'UP THRUST  L/R STEER  SPACE STOP';
  if (g.phase === 'retreat') return 'RUN!';
  if (g.phase !== 'play' && g.phase !== 'intro') return '';
  if (g.cursorMode) return g.weapon === 'girder' ? 'ARROWS MOVE  SPACE PLACE  ESC CANCEL' : 'ARROWS MOVE TARGET  SPACE CONFIRM  ESC CANCEL';
  if (g.targeting) return g.weapon === 'girder' ? 'CLICK TO PLACE (UP/DOWN ROTATE)  OR SPACE + ARROWS' : 'CLICK THE MAP TO TARGET  OR SPACE + ARROWS';
  const def = WEAPON_BY_ID[g.weapon];
  if (def.usage === 'charge' || def.usage === 'targetCharge') return def.fuse ? 'HOLD SPACE POWER  1-5 FUSE  TAB WEAPONS' : 'HOLD SPACE FOR POWER  TAB WEAPONS';
  return 'SPACE TO USE   TAB WEAPONS';
}

function drawHud(ctx: CanvasRenderingContext2D, g: Game): void {
  const rows = [...g.teams].sort((a, b) => sumHp(b) - sumHp(a));
  const maxHp = Math.max(...g.teams.map((t) => t.snakes.length * g.settings.startHp));
  rows.forEach((t, i) => {
    const y = VIEW_H - 12 - (rows.length - 1 - i) * 11;
    const bw = Math.round((sumHp(t) / maxHp) * 110);
    drawText(ctx, t.def.name, VIEW_W / 2 - 8, y - 1, { color: t.def.light, align: 'right' });
    ctx.fillStyle = '#000';
    ctx.fillRect(VIEW_W / 2 - 1, y - 1, 112, 9);
    ctx.fillStyle = t.def.color;
    ctx.fillRect(VIEW_W / 2, y, Math.min(110, bw), 7);
    ctx.fillStyle = t.def.light;
    ctx.fillRect(VIEW_W / 2, y, Math.min(110, bw), 1);
  });

  const s = g.active;
  const live = g.phase === 'intro' || g.phase === 'play' || g.phase === 'retreat' || g.phase === 'guide';
  if (s && live) {
    const retreat = g.phase === 'retreat';
    const sec = Math.max(0, Math.ceil((retreat ? g.retreatT : g.turnT) / 60));
    const warn = !retreat && sec <= 5 && g.tick % 30 < 15;
    ctx.fillStyle = '#000';
    ctx.fillRect(6, VIEW_H - 32, 34, 26);
    ctx.fillStyle = warn ? '#d02020' : s.team.def.color;
    ctx.fillRect(7, VIEW_H - 31, 32, 24);
    ctx.fillStyle = '#000';
    ctx.fillRect(9, VIEW_H - 29, 28, 20);
    drawText(ctx, g.phase === 'guide' ? '--' : String(sec), 23, VIEW_H - 27, { color: retreat ? '#ffd84a' : '#fff', scale: 2, align: 'center' });
    if (s.team.cpu && !s.team.clanker) {
      drawText(ctx, 'CPU', 23, VIEW_H - 42, { color: s.team.def.light, align: 'center' });
      drawText(ctx, 'HOLD SPACE: FAST FORWARD', 6, VIEW_H - 54, { color: '#99aaaa' });
    }
    const h = hint(g);
    if (h) {
      const w = h.length * 6 + 6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(4, VIEW_H - 47, w, 11);
      drawText(ctx, h, 7, VIEW_H - 46, { color: '#d8e8ff' });
    }
  }

  const wx = VIEW_W - 112;
  const wy = VIEW_H - 16;
  drawText(ctx, 'WIND', wx - 4, wy - 1, { align: 'right', color: '#cfe8ff' });
  ctx.fillStyle = '#000';
  ctx.fillRect(wx - 1, wy - 1, 104, 10);
  ctx.fillStyle = '#20305a';
  ctx.fillRect(wx, wy, 102, 8);
  const len = Math.round(Math.abs(g.wind) * 50);
  const dir = g.wind >= 0 ? 1 : -1;
  const mid = wx + 51;
  ctx.fillStyle = '#4fa3ff';
  ctx.fillRect(dir > 0 ? mid : mid - len, wy + 1, len, 6);
  ctx.fillStyle = '#d6ecff';
  const off = Math.floor(g.tick / 3) % 6;
  for (let i = 0; i < len; i += 6) {
    const px = dir > 0 ? mid + ((i + off) % Math.max(1, len)) : mid - ((i + off) % Math.max(1, len)) - 2;
    ctx.fillRect(px, wy + 3, 2, 2);
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(mid, wy - 1, 1, 10);

  if (s && (g.phase === 'intro' || g.phase === 'play')) {
    const id = g.weapon;
    const def = WEAPON_BY_ID[id];
    const ammo = s.team.ammo.get(id) ?? 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(4, 4, 172, def.fuse ? 34 : 24);
    ctx.fillStyle = '#1c2340';
    ctx.fillRect(6, 6, 20, 20);
    drawWeaponIcon(ctx, id, 16, 16, g.tick);
    drawText(ctx, weaponName(id, g.theme), 30, 7, { color: '#ffe14d' });
    drawText(ctx, ammo < 0 ? 'UNLIMITED' : `AMMO ${ammo}`, 30, 16, { color: '#aaaabb' });
    if (def.fuse) drawText(ctx, `FUSE ${g.fuse}S (1-5)`, 8, 27, { color: '#fff' });
    if (!s.team.cpu) drawText(ctx, 'TAB', 172, 7, { color: '#99aaaa', align: 'right' });
    if (!s.team.cpu) ui.rects.push({ x: 4, y: 4, w: 172, h: 24, act: 'menu' });
  }

  g.feed.forEach((m, i) => drawText(ctx, m.text, VIEW_W / 2, 6 + i * 11, { color: m.color, align: 'center', alpha: Math.min(1, m.life / 20) }));

  let by = 80;
  for (const b of g.banners) {
    const age = b.max - b.life;
    const scale = age < 6 ? 4 : 3;
    const bob = Math.sin(g.tick * 0.08) * 2;
    drawText(ctx, b.text, VIEW_W / 2, by + bob, { color: b.color, scale, align: 'center', alpha: Math.min(1, b.life / 20) });
    by += 34;
  }

  if (g.phase === 'over' && g.phaseT > 90 && g.tick % 60 < 44) {
    drawText(ctx, g.settings.mode === 'arena' ? 'ESC: BACK TO MENU' : 'ENTER: REMATCH ON A NEW ISLAND    ESC: MAIN MENU', VIEW_W / 2, by + 6, { align: 'center' });
  }
  if (g.phase === 'over' && g.endReason) drawText(ctx, g.endReason, VIEW_W / 2, by - 8, { align: 'center', color: '#c8d0ff' });
  if (g.suddenDeath) drawText(ctx, 'SUDDEN DEATH', VIEW_W - 136, 70, { color: '#ff6a6a' });
}

function drawMinimap(ctx: CanvasRenderingContext2D, g: Game): void {
  const m = MINI;
  let cache = miniCache.get(g);
  if (!cache) {
    const canvas = document.createElement('canvas');
    canvas.width = m.w;
    canvas.height = m.h;
    cache = { canvas, version: -1, at: -999 };
    miniCache.set(g, cache);
  }
  if (cache.version !== g.terrain.version && g.tick - cache.at > 12 && g.terrain.canvas) {
    const c2 = cache.canvas.getContext('2d')!;
    c2.clearRect(0, 0, m.w, m.h);
    c2.imageSmoothingEnabled = true;
    c2.drawImage(g.terrain.canvas, 0, 0, WORLD_W, WORLD_H, 0, 0, m.w, m.h);
    cache.version = g.terrain.version;
    cache.at = g.tick;
  }
  const kx = m.w / WORLD_W;
  const ky = m.h / WORLD_H;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(m.x - 1, m.y - 1, m.w + 2, m.h + 2);
  ctx.fillStyle = 'rgba(20,24,50,0.7)';
  ctx.fillRect(m.x, m.y, m.w, m.h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cache.canvas, m.x, m.y);
  ctx.imageSmoothingEnabled = false;
  const wy = m.y + env.waterY * ky;
  ctx.fillStyle = 'rgba(80,150,220,0.55)';
  ctx.fillRect(m.x, wy, m.w, m.y + m.h - wy);
  for (const p of g.props) {
    if (p.kind !== 'crate') continue;
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(m.x + p.x * kx - 1, m.y + p.y * ky - 1, 2, 2);
  }
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const x = m.x + s.x * kx;
    const y = m.y + s.y * ky;
    if (s === g.active && g.tick % 30 < 15) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    ctx.fillStyle = s.team.def.color;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  ctx.fillStyle = '#fff';
  for (const p of g.projectiles) ctx.fillRect(m.x + p.x * kx, m.y + p.y * ky, 1, 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  const vx = m.x + Math.max(0, g.cam.x) * kx;
  const vy = m.y + Math.max(0, g.cam.y) * ky;
  ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.min(m.w, g.viewW * kx), Math.min(m.h, g.viewH * ky));
  ui.rects.push({ x: m.x, y: m.y, w: m.w, h: m.h, act: 'minimap' });
}

function drawWeaponMenu(ctx: CanvasRenderingContext2D, g: Game): void {
  const team = g.active!.team;
  const pw = 330;
  const ph = MENU_ROWS.length * 25 + 62;
  const px = Math.round(VIEW_W / 2 - pw / 2);
  const py = 44;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
  ctx.fillStyle = '#141a33';
  ctx.fillRect(px, py, pw, ph);
  drawText(ctx, 'WEAPONS', px + pw / 2, py + 4, { color: '#ffe14d', align: 'center', scale: 2 });
  MENU_ROWS.forEach(([label, ids], r) => {
    const y = py + 24 + r * 25;
    drawText(ctx, label, px + 8, y + 7, { color: '#7f8fc0' });
    ids.forEach((id, c) => {
      const x = px + 92 + c * 26;
      const sel = r === g.menuRow && c === g.menuCol;
      const avail = g.isAvailable(id, team);
      ctx.fillStyle = sel ? '#ffe14d' : '#000';
      ctx.fillRect(x - 1, y - 1, 24, 24);
      ctx.fillStyle = avail ? (id === g.weapon ? '#2f4a8a' : '#262f55') : '#1a1a22';
      ctx.fillRect(x, y, 22, 22);
      ctx.globalAlpha = avail ? 1 : 0.3;
      drawWeaponIcon(ctx, id, x + 11, y + 11, g.tick);
      ctx.globalAlpha = 1;
      const ammo = team.ammo.get(id) ?? 0;
      const def = WEAPON_BY_ID[id];
      if (g.round <= def.delay) drawText(ctx, `R${def.delay + 1}`, x + 22, y + 14, { color: '#ff8a8a', align: 'right' });
      else if (ammo > 0) drawText(ctx, String(ammo), x + 22, y + 14, { color: '#fff', align: 'right' });
      ui.rects.push({ x, y, w: 22, h: 22, act: `weapon:${r}:${c}` });
    });
  });
  const id = MENU_ROWS[g.menuRow]![1][g.menuCol]! as WeaponId;
  const def = WEAPON_BY_ID[id];
  const y = py + 24 + MENU_ROWS.length * 25 + 2;
  drawText(ctx, weaponName(id, g.theme), px + 8, y, { color: '#ffe14d' });
  const lines = wrap(def.desc, 52);
  lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, px + 8, y + 11 + i * 10, { color: '#d8d8e8' }));
}

function drawPause(ctx: CanvasRenderingContext2D, g: Game): void {
  ctx.fillStyle = 'rgba(8,10,30,0.78)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (g.showControls) {
    drawText(ctx, 'CONTROLS', VIEW_W / 2, 18, { scale: 2, align: 'center', color: '#ffe14d' });
    const lines: Array<[string, string]> = [
      ['LEFT / RIGHT', 'SLITHER'],
      ['UP / DOWN', 'AIM'],
      ['HOLD SPACE', 'POWER UP, RELEASE TO FIRE'],
      ['ENTER / BACKSPACE', 'JUMP / BACKFLIP'],
      ['TAB  (OR CLICK TOP-LEFT)', 'WEAPON MENU'],
      ['Q / E', 'PREV / NEXT WEAPON'],
      ['1 - 5', 'FUSE'],
      ['CLICK MAP', 'TARGET (AIR STRIKE, TELEPORT...)'],
      ['MOUSE WHEEL  + / -  Z', 'ZOOM'],
      ['WASD  DRAG  SCREEN EDGE', 'LOOK AROUND'],
      ['C', 'CAMERA BACK TO YOUR SNAKE'],
      ['CLICK MINIMAP', 'JUMP CAMERA THERE'],
      ['HOLD SPACE (CPU TURN)', 'FAST FORWARD'],
      ['K', 'SAVE SCREENSHOT'],
      ['M  F', 'MUTE  FULLSCREEN'],
    ];
    lines.forEach(([k, v], i) => {
      drawText(ctx, k, VIEW_W / 2 - 10, 48 + i * 13, { align: 'right', color: '#9fd0ff' });
      drawText(ctx, v, VIEW_W / 2 + 10, 48 + i * 13, { color: '#fff' });
    });
    drawText(ctx, 'GAMEPAD: STICK MOVE/AIM  A FIRE  B JUMP  X BACKFLIP  Y WEAPONS  RB NEXT  LB FUSE  R-STICK LOOK', VIEW_W / 2, VIEW_H - 40, { align: 'center', color: '#bbbbbb' });
    drawText(ctx, 'ESC OR ENTER TO GO BACK', VIEW_W / 2, VIEW_H - 24, { align: 'center', color: '#ffe14d' });
    return;
  }
  drawText(ctx, 'PAUSED', VIEW_W / 2, 50, { scale: 3, align: 'center', color: '#ffe14d' });
  g.pauseItems().forEach((item, i) => {
    const y = 110 + i * 22;
    const sel = i === g.pauseSel;
    drawText(ctx, sel ? `> ${item} <` : item, VIEW_W / 2, y, { scale: 2, align: 'center', color: sel ? '#ffe14d' : '#ffffff' });
    ui.rects.push({ x: VIEW_W / 2 - 110, y: y - 2, w: 220, h: 20, act: `pause:${i}` });
  });
  drawText(ctx, `${g.theme.name}  -  ROUND ${g.round}`, VIEW_W / 2, VIEW_H - 30, { align: 'center', color: '#8888aa' });
}

function drawDebug(ctx: CanvasRenderingContext2D, g: Game): void {
  const lines = [
    `SEED ${g.seed}  TURN ${g.turnCount} R${g.round}  PHASE ${g.phase} ${g.phaseT}  ZOOM ${g.cam.z.toFixed(2)}`,
    `WIND ${g.wind.toFixed(2)}  PART ${g.particles.list.length}  PROJ ${g.projectiles.length}  PROPS ${g.props.length}  FIRE ${g.flameList.length}  WATER ${Math.round(env.waterY)}`,
    ...g.snakes.map((s: Snake) => `${s.name} ${s.state} HP ${s.hp} PEND ${s.pendingDmg} ${Math.round(s.x)},${Math.round(s.y)}${s.poisoned ? ' POISON' : ''}`),
  ];
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(4, 70, 420, lines.length * 10 + 4);
  lines.forEach((l, i) => drawText(ctx, l, 6, 72 + i * 10, { color: '#7dff7d', outline: null }));
}