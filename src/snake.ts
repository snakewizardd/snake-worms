import { PHYS } from './config.ts';
import type { TeamDef } from './config.ts';
import { env } from './env.ts';
import type { Terrain } from './terrain.ts';
import type { Particles } from './particles.ts';
import type { OutfitId } from './themes.ts';
import { drawDealWithIt, drawOutfit, outfitCoversEye } from './outfits.ts';
import { drawHeldItem } from './items.ts';
import { sfx } from './audio.ts';
import { clamp, rng, smoothstep, TAU } from './util.ts';

export interface Team {
  def: TeamDef;
  index: number;
  snakes: Snake[];
  cursor: number;
  cpu: boolean;
  ammo: Map<string, number>;
  weapon: string;
}

export interface World {
  terrain: Terrain;
  particles: Particles;
  onLand(s: Snake, impact: number, kind: AirKind): void;
  onDrown(s: Snake): void;
}

export type SnakeState = 'ground' | 'air' | 'rope' | 'jet' | 'drown' | 'dead';
export type AirKind = 'fall' | 'jump' | 'flip' | 'tumble';
export type Expr = 'normal' | 'fear' | 'hurt' | 'dizzy' | 'happy' | 'sad';
export type HeldItem = string | null;

const R = PHYS.snakeRadius;
const STEP_ORDER = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];

// Rest pose of the spine (tail tip -> head), facing right, origin at the ground under the body.
const BASE: Array<[number, number]> = [
  [-11, -1.2],
  [-7.5, -1.7],
  [-3.6, -2.3],
  [0.4, -2.7],
  [2.8, -6.3],
  [1.6, -10.2],
  [3.2, -13.4],
];

export class Snake {
  readonly team: Team;
  readonly name: string;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  state: SnakeState = 'ground';
  airKind: AirKind = 'fall';
  hp: number;
  displayHp: number;
  pendingDmg = 0;
  hurtThisTurn = false;

  aim = -0.35;
  angle = 0;
  spin = 0;
  curl = 0;
  crouch = 0;
  crouchT = 0;
  pendingJump: 'jump' | 'flip' | null = null;
  moveDir = 0;
  moving = false;
  walkAcc = 0;
  walkPhase = 0;
  private stepCount = 0;
  landSquash = 0;
  stretch = 0;
  stuckT = 0;
  drownT = 0;
  dying = 0;
  celebrate = 0;

  time = rng.int(0, 1000);
  readonly phaseSeed = rng.range(0, TAU);
  blinkT = rng.int(60, 240);
  tongueT = rng.int(30, 200);
  tongue = 0;
  mouth = 0;
  expr: Expr = 'normal';
  exprT = 0;
  dizzy = 0;
  lookX = 0;
  lookY = 0;
  held: HeldItem = null;
  heldAim = 0;
  outfit: OutfitId = 'none';
  poisoned = false;
  shadesT = 0;

  ropeX = 0;
  ropeY = 0;
  ropeLen = 0;
  ropeSwing = 0;
  ropeReel = 0;
  jetFuel = 0;
  jetX = 0;
  jetUp = false;

  constructor(team: Team, name: string, x: number, y: number, hp: number) {
    this.team = team;
    this.name = name;
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.displayHp = hp;
    this.lookX = x + 20;
    this.lookY = y;
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'drown';
  }

  get settled(): boolean {
    if (this.state === 'dead') return true;
    if (this.state === 'drown') return false;
    return this.state === 'ground' && this.crouchT === 0;
  }

  setExpr(e: Expr, ticks: number): void {
    this.expr = e;
    this.exprT = ticks;
  }

  say(line: Parameters<typeof sfx.voice>[0], force = false): void {
    sfx.voice(line, this.team.def.voicePitch, force);
    this.mouth = 1;
  }

  jump(kind: 'jump' | 'flip'): void {
    if (this.state !== 'ground' || this.crouchT > 0) return;
    this.pendingJump = kind;
    this.crouchT = PHYS.crouchTicks;
    sfx.coil();
  }

  /** Failsafe so a wedged snake can never stall the turn. */
  forceGround(): void {
    if (this.state !== 'air') return;
    this.state = 'ground';
    this.vx = 0;
    this.vy = 0;
    this.spin = 0;
    this.airKind = 'fall';
  }

  knock(ix: number, iy: number): void {
    if (!this.alive) return;
    this.state = 'air';
    this.airKind = 'tumble';
    this.vx += ix;
    this.vy += iy;
    this.y -= 1;
    this.crouchT = 0;
    this.pendingJump = null;
    this.setExpr('hurt', 50);
  }

  update(w: World): void {
    this.time++;
    if (--this.blinkT < -6) this.blinkT = rng.int(120, 320);
    if (--this.tongueT <= 0) {
      this.tongueT = rng.int(110, 280);
      this.tongue = 20;
    }
    if (this.tongue > 0) this.tongue--;
    this.mouth *= 0.86;
    this.landSquash *= 0.8;
    if (this.exprT > 0 && --this.exprT === 0) this.expr = 'normal';
    if (this.dizzy > 0) this.dizzy--;
    if (this.celebrate > 0) this.celebrate--;
    if (this.shadesT > 0) this.shadesT--;

    if (this.state === 'ground') this.updateGround(w);
    else if (this.state === 'air') this.updateAir(w);
    else if (this.state === 'rope') this.updateRope(w);
    else if (this.state === 'jet') this.updateJet(w);
    else if (this.state === 'drown') this.updateDrown(w);
    if ((this.state === 'ground' || this.state === 'rope' || this.state === 'jet') && this.y > env.waterY + 2) this.enterWater(w);
    this.moveDir = 0;
  }

  /** Fires a vine that sticks to the first terrain within range. */
  startRope(t: Terrain, aimX: number, aimY: number, maxLen: number): boolean {
    const hx = this.x;
    const hy = this.y - 6;
    for (let d = 6; d < maxLen; d += 2) {
      const x = hx + aimX * d;
      const y = hy + aimY * d;
      if (t.solid(x, y)) {
        this.ropeX = x;
        this.ropeY = y;
        this.ropeLen = Math.max(14, Math.hypot(this.x - x, this.y - y));
        if (this.state === 'ground') this.y -= 1;
        this.state = 'rope';
        this.crouchT = 0;
        this.pendingJump = null;
        return true;
      }
    }
    return false;
  }

  releaseRope(): void {
    if (this.state !== 'rope') return;
    this.state = 'air';
    this.airKind = 'fall';
    this.vy -= 0.8;
  }

  startJet(fuel: number): void {
    if (this.state !== 'ground' && this.state !== 'air') return;
    this.state = 'jet';
    this.jetFuel = fuel;
    this.y -= 2;
    this.vy = Math.min(this.vy, -1);
    this.crouchT = 0;
    this.pendingJump = null;
    sfx.jetStart();
  }

  endJet(): void {
    if (this.state !== 'jet') return;
    this.state = 'air';
    this.airKind = 'fall';
    sfx.jetStop();
  }

  private updateRope(w: World): void {
    const t = w.terrain;
    this.vy += PHYS.gravity;
    const dx = this.x - this.ropeX;
    const dy = this.y - this.ropeY;
    const d = Math.hypot(dx, dy) || 1;
    // Swinging pushes along the tangent; reeling changes the vine length.
    this.vx += (-dy / d) * this.ropeSwing * 0.09 * (dy > 0 ? 1 : 0.4);
    this.vy += (dx / d) * this.ropeSwing * 0.09 * (dy > 0 ? 1 : 0.4);
    this.ropeLen = clamp(this.ropeLen + this.ropeReel * 1.6, 12, 260);
    this.vx *= 0.995;
    this.vy *= 0.995;
    const px = this.x;
    const py = this.y;
    let nx = this.x + this.vx;
    let ny = this.y + this.vy;
    const ndx = nx - this.ropeX;
    const ndy = ny - this.ropeY;
    const nd = Math.hypot(ndx, ndy) || 1;
    if (nd > this.ropeLen) {
      nx = this.ropeX + (ndx / nd) * this.ropeLen;
      ny = this.ropeY + (ndy / nd) * this.ropeLen;
      const rx = ndx / nd;
      const ry = ndy / nd;
      const radial = this.vx * rx + this.vy * ry;
      if (radial > 0) {
        this.vx -= radial * rx;
        this.vy -= radial * ry;
      }
    }
    if (t.circleHit(nx, ny, PHYS.snakeRadius).hit) {
      this.x = px;
      this.y = py;
      this.vx *= -0.3;
      this.vy *= -0.3;
      const emb = t.circleHit(this.x, this.y, PHYS.snakeRadius);
      if (emb.hit) {
        this.x += emb.nx;
        this.y += emb.ny;
      }
    } else {
      this.x = nx;
      this.y = ny;
    }
    this.facing = this.vx >= 0 ? 1 : -1;
    this.angle = Math.atan2(this.ropeX - this.x, -(this.ropeY - this.y)) * 0.5;
    this.ropeSwing = 0;
    this.ropeReel = 0;
  }

  private updateJet(w: World): void {
    const t = w.terrain;
    const thrusting = this.jetFuel > 0 && (this.jetUp || this.jetX !== 0);
    this.vy += PHYS.gravity;
    if (this.jetFuel > 0) {
      if (this.jetUp) this.vy -= 0.34;
      this.vx += this.jetX * 0.1;
      if (thrusting) this.jetFuel--;
    }
    this.vx = clamp(this.vx * 0.985, -3.2, 3.2);
    this.vy = clamp(this.vy, -3.2, 5);
    if (this.jetX !== 0) this.facing = this.jetX > 0 ? 1 : -1;
    sfx.jetLevel(thrusting ? 1 : 0);
    if (thrusting && this.time % 2 === 0) {
      w.particles.add('fire', this.x - this.facing * 3, this.y + 4, -this.vx * 0.3, 1.5 + Math.random(), 10, 2, [255, 200, 90], 0.02, 0.95);
      w.particles.add('smoke', this.x - this.facing * 3, this.y + 6, (Math.random() - 0.5) * 0.4, 1, 30, 2, [120, 120, 130], -0.01, 0.97, 0.01);
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx / steps;
      const ny = this.y + this.vy / steps;
      const h = t.circleHit(nx, ny, PHYS.snakeRadius);
      if (!h.hit) {
        this.x = nx;
        this.y = ny;
        continue;
      }
      const vn = this.vx * h.nx + this.vy * h.ny;
      if (h.ny < -0.55 && !this.jetUp && vn < 0) {
        sfx.jetStop();
        this.airKind = 'jump';
        this.land(w, Math.min(-vn, 2));
        return;
      }
      if (vn < 0) {
        this.vx -= 1.3 * vn * h.nx;
        this.vy -= 1.3 * vn * h.ny;
      }
      break;
    }
    const emb = t.circleHit(this.x, this.y, PHYS.snakeRadius);
    if (emb.hit) {
      this.x += emb.nx;
      this.y += emb.ny;
    }
    if (this.jetFuel <= 0 && !thrusting) this.endJet();
    this.jetUp = false;
    this.jetX = 0;
  }

  private supported(t: Terrain): boolean {
    for (let dx = -2; dx <= 2; dx++) if (t.solid(this.x + dx, this.y + R + 1)) return true;
    // Wedged in a crevice: terrain below pushes up even if the column under the center is empty.
    const h = t.circleHit(this.x, this.y + 1.5, R);
    return h.hit && h.ny < -0.3;
  }

  private clear(t: Terrain, x: number, foot: number): boolean {
    for (const k of [1, 3, 5, 7, 9, 11]) if (t.solid(x, foot - k)) return false;
    return true;
  }

  private step(t: Terrain, dir: number): 'ok' | 'blocked' | 'fall' {
    const nx = this.x + dir;
    const foot = this.y + R;
    for (const dy of STEP_ORDER) {
      if (dy < -PHYS.maxClimb || dy > PHYS.maxClimb) continue;
      const f = foot + dy;
      if (t.solid(nx, f + 1) && !t.solid(nx, f) && this.clear(t, nx, f)) {
        this.x = nx;
        this.y = f - R;
        return 'ok';
      }
    }
    for (let k = -12; k <= 0; k++) if (t.solid(nx, foot + k)) return 'blocked';
    this.x = nx;
    return 'fall';
  }

  private updateGround(w: World): void {
    const t = w.terrain;
    this.angle *= 0.78;
    if (Math.abs(this.angle) < 0.01) this.angle = 0;
    this.curl *= 0.85;
    this.stretch *= 0.7;

    if (this.crouchT > 0) {
      this.crouchT--;
      this.crouch = 1 - this.crouchT / PHYS.crouchTicks;
      if (this.crouchT === 0) this.launch(w);
      return;
    }
    this.crouch *= 0.6;

    let k = 0;
    while (k < 8 && t.solid(this.x, this.y + R)) {
      this.y--;
      k++;
    }
    if (!this.supported(t)) {
      this.state = 'air';
      this.airKind = 'fall';
      this.vx = 0;
      this.vy = 0;
      return;
    }

    if (this.moveDir !== 0 && this.dizzy === 0) {
      this.facing = this.moveDir > 0 ? 1 : -1;
      this.walkAcc += PHYS.walkSpeed;
      this.moving = true;
      while (this.walkAcc >= 1) {
        this.walkAcc -= 1;
        const r = this.step(t, this.facing);
        if (r === 'blocked') {
          this.walkAcc = 0;
          this.moving = false;
          break;
        }
        if (r === 'fall') {
          this.state = 'air';
          this.airKind = 'fall';
          this.vx = this.facing * 0.7;
          this.vy = 0;
          break;
        }
        this.walkPhase += 0.5;
        if (++this.stepCount % 8 === 0) sfx.slither();
      }
    } else {
      this.moving = false;
      this.walkAcc = 0;
    }
  }

  private launch(w: World): void {
    const kind = this.pendingJump;
    this.pendingJump = null;
    this.crouch = 0;
    this.y -= 1;
    this.state = 'air';
    if (kind === 'flip') {
      this.airKind = 'flip';
      this.vx = -this.facing * PHYS.flipVX;
      this.vy = PHYS.flipVY;
      this.spin = (-this.facing * TAU) / ((2 * -PHYS.flipVY) / PHYS.gravity);
    } else {
      this.airKind = 'jump';
      this.vx = this.facing * PHYS.jumpVX;
      this.vy = PHYS.jumpVY;
      this.spin = 0;
    }
    sfx.boing(kind === 'flip');
    if (rng.chance(0.35)) this.say('jump');
    w.particles.dust(this.x, this.y + R, 5);
  }

  private updateAir(w: World): void {
    const t = w.terrain;
    this.vy += PHYS.gravity;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > PHYS.maxSpeed) {
      this.vx *= PHYS.maxSpeed / sp;
      this.vy *= PHYS.maxSpeed / sp;
    }
    if (this.airKind === 'tumble') {
      this.spin = this.vx * 0.14;
      this.curl = Math.min(1, this.curl + 0.2);
      this.stretch = 0;
    } else {
      this.stretch = clamp(Math.abs(this.vy) * 0.05, 0, 0.3);
    }
    this.angle += this.spin;

    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil(speed));
    const sx = this.vx / steps;
    const sy = this.vy / steps;
    const startX = this.x;
    const startY = this.y;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx;
      const ny = this.y + sy;
      const h = t.circleHit(nx, ny, R);
      if (!h.hit) {
        this.x = nx;
        this.y = ny;
        continue;
      }
      const vn = this.vx * h.nx + this.vy * h.ny;
      if (vn >= 0) {
        this.x = nx;
        this.y = ny;
        continue;
      }
      const impact = -vn;
      const floor = h.ny < -0.55;
      if (floor && (this.airKind !== 'tumble' || speed < 2.4)) {
        this.land(w, impact);
        return;
      }
      if (speed < 2.5) {
        // Slow contact with a steep face: slide along it instead of bouncing in place.
        this.vx = (this.vx - vn * h.nx) * 0.92;
        this.vy = (this.vy - vn * h.ny) * 0.92;
        if (this.airKind === 'jump' || this.airKind === 'flip') {
          this.airKind = 'fall';
          this.spin = 0;
        }
        break;
      }
      const e = this.airKind === 'tumble' ? PHYS.tumbleBounce : 0.12;
      this.vx -= (1 + e) * vn * h.nx;
      this.vy -= (1 + e) * vn * h.ny;
      this.vx *= PHYS.tumbleFriction + 0.15;
      this.vy *= PHYS.tumbleFriction + 0.15;
      if (this.airKind === 'jump' || this.airKind === 'flip') {
        this.airKind = 'fall';
        this.spin = 0;
      }
      if (impact > 1.2) {
        sfx.land(impact / 8);
        w.particles.dust(this.x + h.nx * -R, this.y + h.ny * -R, 3, 0.6);
      }
      break;
    }

    if (Math.hypot(this.x - startX, this.y - startY) < 0.35) {
      if (++this.stuckT > 20) this.land(w, 0);
    } else this.stuckT = 0;

    const emb = t.circleHit(this.x, this.y, R);
    if (emb.hit && this.state === 'air') {
      this.x += emb.nx;
      this.y += emb.ny;
    }
    if (this.y > env.waterY + 2 && this.state === 'air') this.enterWater(w);
  }

  private land(w: World, impact: number): void {
    const t = w.terrain;
    for (let k = 0; k < 4; k++) {
      if (!t.solid(this.x, this.y + R + 1) && !t.circleHit(this.x, this.y + 1, R).hit) this.y++;
      else break;
    }
    const kind = this.airKind;
    this.state = 'ground';
    this.vx = 0;
    this.vy = 0;
    this.spin = 0;
    this.stuckT = 0;
    this.landSquash = clamp(impact / 5, 0.15, 1);
    if (kind === 'flip') this.angle = 0;
    if (kind === 'tumble' && impact > 1) {
      this.dizzy = 50;
      this.setExpr('dizzy', 50);
    }
    this.airKind = 'fall';
    w.onLand(this, impact, kind);
  }

  private enterWater(w: World): void {
    this.state = 'drown';
    this.drownT = 0;
    this.vx *= 0.2;
    this.vy = 0;
    w.onDrown(this);
  }

  private updateDrown(w: World): void {
    this.drownT++;
    this.y += 0.32;
    this.x += this.vx;
    this.vx *= 0.95;
    this.angle = Math.sin(this.drownT * 0.15) * 0.4;
    this.curl = Math.min(1, this.curl + 0.05);
    if (this.drownT % 9 === 0) w.particles.bubbles(this.x, this.y - 6, 1);
    if (this.drownT > 130) this.state = 'dead';
  }

  // ----------------------------------------------------------------- drawing

  private spine(): Array<[number, number]> {
    const t = this.time / 60;
    const pts = BASE.map(([x, y]) => [x, y] as [number, number]);
    const idle = this.moving ? 0.3 : 1;
    const br = Math.sin(t * 2.4 + this.phaseSeed) * 0.35;
    for (let i = 4; i < 7; i++) pts[i]![1] += br * ((i - 3) / 3);
    const sw = Math.sin(t * 1.3 + this.phaseSeed) * 0.55 * idle;
    pts[5]![0] += sw * 0.6;
    pts[6]![0] += sw;

    if (this.moving) {
      const ph = this.walkPhase;
      for (let i = 0; i < 4; i++) {
        pts[i]![1] += Math.sin(ph + i * 1.7) * 0.9 * (1 - i / 5) - 0.3;
        pts[i]![0] += Math.cos(ph + i * 1.7) * 0.7;
      }
      pts[5]![0] += 0.6;
      pts[6]![0] += 1.0;
      pts[6]![1] -= Math.abs(Math.sin(ph * 0.5)) * 0.9;
    }

    if (this.celebrate > 0) {
      const b = Math.abs(Math.sin(this.celebrate * 0.25)) * 3;
      for (let i = 3; i < 7; i++) pts[i]![1] -= b * ((i - 2) / 4);
    }

    if (this.held) {
      const a = this.heldAim;
      pts[6]![0] += Math.cos(a) * 1.4 - 1.0;
      pts[6]![1] += Math.sin(a) * 1.8;
      pts[5]![1] += Math.sin(a) * 0.6;
    }

    const k = Math.max(this.crouch, this.landSquash);
    if (k > 0.01) {
      for (let i = 0; i < 7; i++) {
        pts[i]![0] *= 1 + 0.22 * k;
        if (i >= 3) pts[i]![1] *= 1 - 0.45 * k;
      }
    }
    if (this.stretch > 0.01) {
      for (const p of pts) {
        p[1] *= 1 + this.stretch;
        p[0] *= 1 - this.stretch * 0.5;
      }
    }
    if (this.curl > 0.01) {
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.85 + (i / 6) * Math.PI * 1.55;
        const cx = Math.cos(a) * 5.5;
        const cy = -5.5 + Math.sin(a) * 5.5;
        pts[i]![0] += (cx - pts[i]![0]) * this.curl;
        pts[i]![1] += (cy - pts[i]![1]) * this.curl;
      }
    }
    return pts;
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.state === 'dead') return;
    const def = this.team.def;
    if (this.state === 'rope') {
      const sx = this.x - camX;
      const sy = this.y - 6 - camY;
      const ax = this.ropeX - camX;
      const ay = this.ropeY - camY;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1f4a14';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.strokeStyle = '#6fbf3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      const len = Math.hypot(ax - sx, ay - sy);
      ctx.fillStyle = '#8be04a';
      for (let d = 10; d < len; d += 13) {
        const t = d / len;
        ctx.fillRect(Math.round(sx + (ax - sx) * t) + ((d / 13) % 2 ? 1 : -2), Math.round(sy + (ay - sy) * t), 2, 1);
      }
    }
    if (this.state === 'jet') {
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(Math.round(this.x - camX - this.facing * 5) - 2, Math.round(this.y - camY) - 3, 5, 8);
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(Math.round(this.x - camX - this.facing * 5) - 1, Math.round(this.y - camY) - 2, 3, 6);
    }
    const shake = this.dying > 0 ? Math.sin(this.dying * 1.7) * 1.2 : 0;
    const ox = this.x - camX + shake;
    const oy = this.y - camY;
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    const f = this.facing;
    const toWorld = (p: [number, number]): [number, number] => {
      const lx = p[0] * f;
      const ly = p[1] + R;
      return [ox + lx * cosA - ly * sinA, oy + lx * sinA + ly * cosA];
    };

    const local = this.spine();
    const pts = local.map(toWorld);
    const samples: Array<[number, number]> = [];
    const per = 5;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      for (let s = 0; s < per; s++) {
        const u = s / per;
        const u2 = u * u;
        const u3 = u2 * u;
        const cr = (a: number, b: number, c: number, d: number): number =>
          0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        samples.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const head = pts[pts.length - 1]!;
    samples.push(head);
    const n = samples.length;
    const width = (u: number): number => (u < 0.55 ? 0.7 + 2.1 * smoothstep(0, 0.55, u) : 2.8 - 0.55 * smoothstep(0.55, 1, u));

    const disc = (x: number, y: number, r: number): void => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    };

    ctx.fillStyle = def.dark;
    for (let i = 0; i < n - 1; i++) disc(samples[i]![0], samples[i]![1], width(i / (n - 1)) + 1);

    if (def.tail === 'rattle') {
      const tip = samples[0]!;
      const nxt = samples[2]!;
      const dx = tip[0] - nxt[0];
      const dy = tip[1] - nxt[1];
      const len = Math.hypot(dx, dy) || 1;
      const shakeR = this.celebrate > 0 || this.expr === 'fear' || this.tongue > 0 ? Math.sin(this.time * 2.1) * 0.8 : 0;
      for (let k = 1; k <= 3; k++) {
        const x = tip[0] + (dx / len) * k * 1.7 + shakeR * (-dy / len);
        const y = tip[1] + (dy / len) * k * 1.7 + shakeR * (dx / len);
        ctx.fillStyle = def.dark;
        disc(x, y, 1.9 - k * 0.2);
        ctx.fillStyle = '#e8d6a0';
        disc(x, y, 1.2 - k * 0.15);
      }
    }

    ctx.fillStyle = def.color;
    for (let i = 0; i < n - 1; i++) disc(samples[i]![0], samples[i]![1], width(i / (n - 1)));

    const bx = f * 0.7;
    for (let i = 1; i < n - 1; i++) {
      const [x0, y0] = samples[i - 1]!;
      const [x1, y1] = samples[i + 1]!;
      let tx = x1 - x0;
      let ty = y1 - y0;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      let nx = -ty;
      let ny = tx;
      if (nx * bx + ny * 0.7 < 0) {
        nx = -nx;
        ny = -ny;
      }
      const w = width(i / (n - 1));
      const [x, y] = samples[i]!;
      ctx.fillStyle = def.light;
      disc(x + nx * w * 0.5, y + ny * w * 0.5, w * 0.45);
      if (i % 3 === 0 && i < n - 4) {
        ctx.fillStyle = def.pattern;
        ctx.fillRect(Math.round(x - nx * w * 0.35 - 0.5), Math.round(y - ny * w * 0.35 - 0.5), 1, 1);
      }
    }

    const neck = samples[n - 3]!;
    let headAng = Math.atan2(head[1] - neck[1], head[0] - neck[0]);
    const forward = f > 0 ? 0 : Math.PI;
    headAng = forward + (this.held ? this.heldAim * f * 0.5 : 0) + this.angle;
    if (this.curl > 0.3) headAng = Math.atan2(head[1] - neck[1], head[0] - neck[0]);

    ctx.save();
    ctx.translate(head[0], head[1]);
    ctx.rotate(headAng);
    if (f < 0 && this.curl <= 0.3) ctx.scale(1, -1);
    this.drawHead(ctx, head, headAng, f);
    ctx.restore();

    if (this.held) this.drawHeld(ctx, head);
  }

  private drawHeld(ctx: CanvasRenderingContext2D, head: [number, number]): void {
    const a = this.facing > 0 ? this.heldAim : Math.PI - this.heldAim;
    ctx.save();
    ctx.translate(head[0], head[1] + 0.5);
    ctx.rotate(a);
    if (this.facing < 0) ctx.scale(1, -1);
    drawHeldItem(ctx, this.held ?? '', this.time);
    ctx.restore();
  }

  private drawHead(ctx: CanvasRenderingContext2D, head: [number, number], headAng: number, f: number): void {
    const def = this.team.def;
    const ell = (x: number, y: number, rx: number, ry: number): void => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();
    };
    ctx.fillStyle = def.dark;
    ell(0.5, 0, 5, 4);
    ctx.fillStyle = def.color;
    ell(0.5, 0, 4, 3);
    ctx.fillStyle = def.light;
    ell(1.3, 1.5, 3, 1.3);

    if (this.tongue > 0) {
      const ext = Math.sin((this.tongue / 20) * Math.PI) * 5;
      const flick = Math.sin(this.tongue * 1.6) * 0.8;
      ctx.strokeStyle = '#ff3b6b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, 1);
      ctx.lineTo(4 + ext, 1 + flick);
      ctx.lineTo(4 + ext + 1.5, 0 + flick);
      ctx.moveTo(4 + ext, 1 + flick);
      ctx.lineTo(4 + ext + 1.5, 2 + flick);
      ctx.stroke();
    }
    if (this.mouth > 0.1) {
      ctx.fillStyle = '#3a0612';
      ctx.beginPath();
      ctx.moveTo(1.5, 0.8);
      ctx.lineTo(5, 0.2);
      ctx.lineTo(5, 0.8 + this.mouth * 2.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = def.dark;
    ctx.fillRect(3.5, -1, 1, 1);
    if (this.poisoned) {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 0.1);
      ctx.fillStyle = '#6dff3a';
      ell(0.5, 0, 4, 3);
      ctx.globalAlpha = 1;
    }
    if (outfitCoversEye(this.outfit)) drawOutfit(ctx, this.outfit, this.time);
    else {
      this.drawEye(ctx, head, headAng, f);
      drawOutfit(ctx, this.outfit, this.time);
    }
    if (this.shadesT > 0) drawDealWithIt(ctx, 240 - this.shadesT);
  }

  private drawEye(ctx: CanvasRenderingContext2D, head: [number, number], headAng: number, f: number): void {
    const def = this.team.def;
    const ell = (x: number, y: number, rx: number, ry: number): void => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();
    };
    const ex = 0.8;
    const ey = -1.3;
    const fear = this.expr === 'fear';
    const er = fear ? 2.3 : 1.8;
    const blinking = this.blinkT < 0;
    if (this.expr === 'hurt' || this.expr === 'sad') {
      ctx.strokeStyle = '#1a0a05';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex - 1.5, ey - 1.2);
      ctx.lineTo(ex + 1.3, ey);
      ctx.lineTo(ex - 1.5, ey + 1.2);
      ctx.stroke();
      return;
    }
    if (blinking) {
      ctx.fillStyle = '#1a0a05';
      ctx.fillRect(ex - 1.8, ey, 3.6, 1);
      return;
    }
    ctx.fillStyle = '#1a0a05';
    ell(ex, ey, er + 0.7, er + 0.7);
    ctx.fillStyle = '#ffffff';
    ell(ex, ey, er, er);
    let px: number;
    let py: number;
    if (this.expr === 'dizzy') {
      const a = this.time * 0.3;
      px = Math.cos(a) * 0.8;
      py = Math.sin(a) * 0.8;
    } else {
      let dx = this.lookX - head[0];
      let dy = this.lookY - head[1];
      const c = Math.cos(-headAng);
      const s = Math.sin(-headAng);
      const lx = dx * c - dy * s;
      let ly = dx * s + dy * c;
      if (f < 0 && this.curl <= 0.3) ly = -ly;
      const len = Math.hypot(lx, ly) || 1;
      dx = lx / len;
      dy = ly / len;
      px = dx * 0.85;
      py = dy * 0.85;
    }
    ctx.fillStyle = '#120804';
    ell(ex + px, ey + py, fear ? 0.6 : 1.0, fear ? 0.6 : 1.0);
    if (this.expr === 'happy') {
      ctx.fillStyle = def.color;
      ctx.fillRect(ex - 2, ey + 0.6, 4, 2);
    }
  }
}
