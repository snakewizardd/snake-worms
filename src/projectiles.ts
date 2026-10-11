import { PHYS, WORLD_W } from './config.ts';
import { env } from './env.ts';
import type { Terrain } from './terrain.ts';
import type { Particles } from './particles.ts';
import type { Snake } from './snake.ts';
import type { ThemeDef } from './themes.ts';
import { sfx } from './audio.ts';
import { drawSheep } from './items.ts';
import { clamp, rng, TAU } from './util.ts';

export interface ProjWorld {
  terrain: Terrain;
  particles: Particles;
  snakes: Snake[];
  wind: number;
  sim: boolean;
  theme: ThemeDef;
  control: { steer: number; fire: boolean };
  explode(x: number, y: number, radius: number, damage: number, knock: number): void;
  spawn(p: Projectile): void;
  flames(x: number, y: number, n: number, spread: number): void;
  poison(x: number, y: number, r: number): void;
}

export abstract class Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive = true;
  age = 0;
  angle = 0;
  readonly owner: Snake | null;
  readonly feared = new Set<Snake>();
  /** Player keeps steering/detonating it, so the turn waits. */
  controllable = false;
  /** Fuse seconds shown over it, or 0. */
  showFuse = 0;

  constructor(x: number, y: number, vx: number, vy: number, owner: Snake | null) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.owner = owner;
  }

  abstract update(w: ProjWorld): void;
  abstract draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void;

  protected hitSnake(w: ProjWorld, r = 2): boolean {
    for (const s of w.snakes) {
      if (!s.alive) continue;
      if (s === this.owner && this.age < 14) continue;
      if (Math.hypot(s.x - this.x, s.y - 3 - this.y) < PHYS.snakeRadius + r + 1) return true;
    }
    return false;
  }

  protected scare(w: ProjWorld): void {
    if (w.sim) return;
    for (const s of w.snakes) {
      if (!s.alive || this.feared.has(s) || s === this.owner) continue;
      if (Math.hypot(s.x - this.x, s.y - this.y) < 70 && this.age > 8) {
        this.feared.add(s);
        s.setExpr('fear', 60);
        s.say('fear');
      }
    }
  }

  protected sink(w: ProjWorld): boolean {
    if (this.y > env.waterY) {
      if (!w.sim) {
        sfx.splash(false);
        w.particles.splash(this.x, false);
      }
      this.alive = false;
      return true;
    }
    if (this.x < -300 || this.x > WORLD_W + 300 || this.y > 2000) {
      this.alive = false;
      return true;
    }
    return false;
  }

  /** Moves with substeps; returns contact normal if it touched terrain. */
  protected moveBounce(w: ProjWorld, r: number, bounce: number, friction: number): { nx: number; ny: number; impact: number } | null {
    let contact: { nx: number; ny: number; impact: number } | null = null;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx / steps;
      const ny = this.y + this.vy / steps;
      const h = w.terrain.circleHit(nx, ny, r);
      if (!h.hit) {
        this.x = nx;
        this.y = ny;
        continue;
      }
      const vn = this.vx * h.nx + this.vy * h.ny;
      if (vn < 0) {
        this.vx -= (1 + bounce) * vn * h.nx;
        this.vy -= (1 + bounce) * vn * h.ny;
        const tx = -h.ny;
        const ty = h.nx;
        const vt = this.vx * tx + this.vy * ty;
        const vn2 = this.vx * h.nx + this.vy * h.ny;
        this.vx = tx * vt * friction + h.nx * vn2;
        this.vy = ty * vt * friction + h.ny * vn2;
        contact = { nx: h.nx, ny: h.ny, impact: -vn };
      }
      const emb = w.terrain.circleHit(this.x, this.y, r);
      if (emb.hit) {
        this.x += emb.nx;
        this.y += emb.ny;
      }
      break;
    }
    return contact;
  }
}

// ---------------------------------------------------------------- rockets

export type RocketKind = 'rocket' | 'homing' | 'venom';

export class Rocket extends Projectile {
  readonly kind: RocketKind;
  tx = 0;
  ty = 0;

  constructor(x: number, y: number, vx: number, vy: number, owner: Snake | null, kind: RocketKind, tx = 0, ty = 0) {
    super(x, y, vx, vy, owner);
    this.kind = kind;
    this.tx = tx;
    this.ty = ty;
  }

  update(w: ProjWorld): void {
    this.age++;
    const homing = this.kind === 'homing' && this.age > 22 && this.age < 220;
    if (homing) {
      const want = Math.atan2(this.ty - this.y, this.tx - this.x);
      let cur = Math.atan2(this.vy, this.vx);
      let d = want - cur;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      cur += clamp(d, -0.09, 0.09);
      const sp = Math.min(8, Math.hypot(this.vx, this.vy) + 0.25);
      this.vx = Math.cos(cur) * sp;
      this.vy = Math.sin(cur) * sp;
      if (!w.sim && this.age === 23) sfx.mineBeep();
    } else {
      this.vx += w.wind * PHYS.windAccel * (this.kind === 'venom' ? 0.6 : this.kind === 'homing' ? 0 : 1);
      this.vy += PHYS.gravity;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      this.x += this.vx / steps;
      this.y += this.vy / steps;
      if (w.terrain.solid(this.x, this.y) || this.hitSnake(w)) {
        this.detonate(w);
        return;
      }
    }
    this.angle = Math.atan2(this.vy, this.vx);
    if (!w.sim && this.age % 2 === 0) {
      if (this.kind === 'venom') w.particles.add('poison', this.x, this.y, 0, 0, 25, 2, [125, 255, 74], 0, 0.95);
      else w.particles.trail(this.x - Math.cos(this.angle) * 5, this.y - Math.sin(this.angle) * 5);
    }
    this.scare(w);
    this.sink(w);
  }

  private detonate(w: ProjWorld): void {
    this.alive = false;
    if (this.kind === 'venom') {
      w.explode(this.x, this.y, 16, 12, 3);
      w.poison(this.x, this.y, 42);
    } else if (this.kind === 'homing') w.explode(this.x, this.y, 30, 48, 7);
    else w.explode(this.x, this.y, 32, 50, 7.5);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    ctx.save();
    ctx.translate(this.x - cx, this.y - cy);
    ctx.rotate(this.angle);
    if (this.kind === 'venom') {
      ctx.fillStyle = '#1f5a10';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#7dff4a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 2.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e0ffc0';
      ctx.fillRect(1, -1, 1, 1);
    } else {
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(-5, -2.5, 10, 5);
      ctx.fillStyle = this.kind === 'homing' ? '#c9d2dc' : '#c23b2c';
      ctx.fillRect(-4, -1.5, 7, 3);
      ctx.fillStyle = this.kind === 'homing' ? ((time >> 2) % 2 ? '#ff3a3a' : '#ffffff') : '#e7e7e7';
      ctx.fillRect(2, -1.5, 3, 3);
      ctx.fillStyle = '#7a7a7a';
      ctx.fillRect(-6, -3.5, 2, 2);
      ctx.fillRect(-6, 1.5, 2, 2);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- thrown things

export type ThrownKind = 'grenade' | 'cluster' | 'melon' | 'holyEgg' | 'petrol' | 'dynamite' | 'clusterBit' | 'melonSlice';

const THROWN: Record<ThrownKind, { r: number; bounce: number; friction: number; impact: boolean }> = {
  grenade: { r: 2.5, bounce: 0.5, friction: 0.82, impact: false },
  cluster: { r: 2.8, bounce: 0.5, friction: 0.82, impact: false },
  melon: { r: 4, bounce: 0.35, friction: 0.8, impact: false },
  holyEgg: { r: 3.5, bounce: 0.3, friction: 0.75, impact: false },
  petrol: { r: 2.5, bounce: 0, friction: 0, impact: true },
  dynamite: { r: 3, bounce: 0.15, friction: 0.6, impact: false },
  clusterBit: { r: 1.5, bounce: 0, friction: 0, impact: true },
  melonSlice: { r: 3, bounce: 0, friction: 0, impact: true },
};

export class Thrown extends Projectile {
  readonly kind: ThrownKind;
  fuse: number;
  private lastSecond: number;
  private choir = 0;
  resting = false;

  constructor(x: number, y: number, vx: number, vy: number, owner: Snake | null, kind: ThrownKind, fuseSeconds: number) {
    super(x, y, vx, vy, owner);
    this.kind = kind;
    this.fuse = Math.round(fuseSeconds * 60);
    this.lastSecond = fuseSeconds;
    this.showFuse = kind === 'holyEgg' || THROWN[kind].impact ? 0 : fuseSeconds;
  }

  update(w: ProjWorld): void {
    this.age++;
    const cfg = THROWN[this.kind];
    if (this.choir > 0) {
      this.choir--;
      this.vx *= 0.9;
      if (!w.sim && this.choir % 6 === 0) w.particles.sparkle(this.x, this.y - 4, 3, '#fff6a8');
      if (this.choir === 0) this.detonate(w);
      return;
    }
    if (!cfg.impact) {
      this.fuse--;
      const sec = Math.ceil(this.fuse / 60);
      this.showFuse = this.kind === 'holyEgg' ? 0 : sec;
      if (sec < this.lastSecond) {
        this.lastSecond = sec;
        if (!w.sim) sfx.fuseTick();
      }
      if (this.fuse <= 0) {
        if (this.kind === 'holyEgg') {
          this.choir = w.sim ? 1 : 70;
          if (!w.sim) sfx.choir();
          return;
        }
        this.detonate(w);
        return;
      }
    }
    this.vy += PHYS.gravity;
    if (this.kind === 'dynamite' && !w.sim && this.age % 3 === 0) w.particles.add('spark', this.x + 3, this.y - 3, rng.range(-0.6, 0.6), rng.range(-1.2, -0.3), 12, 1, [255, 220, 90], 0.05, 0.97);
    if (cfg.impact) {
      const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
      for (let i = 0; i < steps; i++) {
        this.x += this.vx / steps;
        this.y += this.vy / steps;
        if (w.terrain.solid(this.x, this.y) || (this.age > 6 && this.hitSnake(w, cfg.r))) {
          this.detonate(w);
          return;
        }
      }
    } else {
      const c = this.moveBounce(w, cfg.r, cfg.bounce, cfg.friction);
      if (c && c.impact > 0.8 && !w.sim) {
        sfx.clink(c.impact);
        w.particles.dust(this.x, this.y, 1, 0.4);
      }
      this.resting = Math.hypot(this.vx, this.vy) < 0.25 && !!c;
      if (this.resting) {
        this.vx = 0;
        this.vy = 0;
      }
    }
    this.angle += this.vx * 0.25;
    this.scare(w);
    this.sink(w);
  }

  private detonate(w: ProjWorld): void {
    this.alive = false;
    const { x, y } = this;
    switch (this.kind) {
      case 'grenade':
        w.explode(x, y, 32, 50, 7.5);
        break;
      case 'cluster':
        w.explode(x, y, 22, 25, 5);
        for (let i = 0; i < 5; i++) w.spawn(new Thrown(x, y - 4, rng.range(-2.4, 2.4), rng.range(-5, -2.5), this.owner, 'clusterBit', 0));
        break;
      case 'melon':
        w.explode(x, y, 30, 40, 6);
        for (let i = 0; i < 5; i++) w.spawn(new Thrown(x, y - 4, (i - 2) * 1.1 + rng.range(-0.4, 0.4), rng.range(-8, -6), this.owner, 'melonSlice', 0));
        break;
      case 'holyEgg':
        w.explode(x, y, 70, 100, 12);
        break;
      case 'petrol':
        if (!w.sim) sfx.burstGlass();
        w.explode(x, y, 6, 4, 1);
        w.flames(x, y - 3, 22, 2.4);
        break;
      case 'dynamite':
        w.explode(x, y, 55, 75, 10);
        break;
      case 'clusterBit':
        w.explode(x, y, 16, 20, 4);
        break;
      case 'melonSlice':
        w.explode(x, y, 34, 45, 8);
        break;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    ctx.save();
    ctx.translate(this.x - cx, this.y - cy);
    ctx.rotate(this.angle);
    const c = (col: string, r: number): void => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
    };
    switch (this.kind) {
      case 'grenade':
        c('#0e160a', 3.4);
        c('#3f6b2a', 2.5);
        ctx.fillStyle = '#bdbdbd';
        ctx.fillRect(-1, -4.5, 2, 1.5);
        break;
      case 'cluster':
        c('#111', 3.6);
        c('#4a4a52', 2.7);
        ctx.fillStyle = '#ffd24b';
        ctx.fillRect(-1, -1, 1, 1);
        ctx.fillRect(1, 1, 1, 1);
        break;
      case 'clusterBit':
        c('#111', 2.2);
        c('#ffd24b', 1.2);
        break;
      case 'melon':
        ctx.fillStyle = '#0f3a10';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.4, 4.4, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#3a9a2a';
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.6, 3.6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0f3a10';
        ctx.fillRect(-4, -0.4, 8, 0.8);
        ctx.fillRect(-3, -2.2, 6, 0.7);
        ctx.fillRect(-3, 1.6, 6, 0.7);
        break;
      case 'melonSlice':
        ctx.fillStyle = '#2a7a1a';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = '#ff4a5a';
        ctx.beginPath();
        ctx.arc(0, 0.4, 3.2, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillRect(-1.5, 1.2, 1, 1);
        ctx.fillRect(1, 1.6, 1, 1);
        break;
      case 'holyEgg': {
        ctx.rotate(-this.angle);
        if (this.choir > 0) {
          ctx.globalAlpha = 0.4;
          c('#fff6a8', 10 + Math.sin(time * 0.4) * 2);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#8a6a10';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.8, 4.8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3, 4, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-0.5, -2.5, 1, 5);
        ctx.fillRect(-2, -1.2, 4, 1);
        break;
      }
      case 'petrol':
        ctx.fillStyle = '#3a2a10';
        ctx.fillRect(-4, -2.5, 8, 5);
        ctx.fillStyle = '#c08a3a';
        ctx.fillRect(-3, -1.8, 6, 3.6);
        ctx.fillStyle = (time >> 2) % 2 ? '#ffd24b' : '#ff7a2a';
        ctx.fillRect(4, -1.5, 3, 3);
        break;
      case 'dynamite':
        ctx.fillStyle = '#5a0f0f';
        ctx.fillRect(-5, -2.5, 10, 5);
        ctx.fillStyle = '#d6312b';
        ctx.fillRect(-4, -1.6, 8, 3.2);
        ctx.fillStyle = '#ffe9a0';
        ctx.fillRect(-3, -0.4, 6, 0.8);
        break;
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- sheep

export class Sheep extends Projectile {
  readonly sky: boolean;
  dir: number;
  mode: 'walk' | 'fly' = 'walk';
  private fuel = 600;
  flyAngle = 0;
  private nextBleat = 30;

  constructor(x: number, y: number, dir: number, owner: Snake | null, sky: boolean) {
    super(x, y, dir * 1.2, -1.5, owner);
    this.dir = dir;
    this.sky = sky;
    this.controllable = true;
  }

  update(w: ProjWorld): void {
    this.age++;
    if (!w.sim && --this.nextBleat <= 0) {
      this.nextBleat = rng.int(50, 110);
      sfx.bleat(this.mode === 'fly' ? 1.3 : 1);
    }
    const fire = this.age > 8 && w.control.fire;
    if (this.mode === 'fly') {
      this.flyAngle += w.control.steer * 0.075;
      this.vx = Math.cos(this.flyAngle) * 4.2;
      this.vy = Math.sin(this.flyAngle) * 4.2;
      this.fuel--;
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        this.x += this.vx / steps;
        this.y += this.vy / steps;
        if (w.terrain.solid(this.x, this.y) || this.hitSnake(w, 4)) {
          this.boom(w);
          return;
        }
      }
      if (!w.sim && this.age % 3 === 0) w.particles.add('wool', this.x - this.vx, this.y - this.vy, 0, 0, 20, 1.5, [244, 241, 234], 0, 0.9);
      if (fire || this.fuel <= 0) {
        if (this.fuel <= 0) {
          this.mode = 'walk';
          this.controllable = false;
        } else {
          this.boom(w);
          return;
        }
      }
    } else {
      if (fire) {
        if (this.sky) {
          this.mode = 'fly';
          this.flyAngle = this.dir > 0 ? -Math.PI / 3 : (-Math.PI * 2) / 3;
          if (!w.sim) sfx.whoosh();
        } else {
          this.boom(w);
          return;
        }
      }
      this.vy += PHYS.gravity;
      const onGround = w.terrain.solid(this.x, this.y + 6);
      if (onGround) {
        this.vx = this.dir * 1.1;
        let climbed = false;
        for (let k = 0; k <= 6; k++) {
          if (!w.terrain.solid(this.x + this.dir * 4, this.y + 5 - k)) {
            this.y -= k;
            climbed = true;
            break;
          }
        }
        if (!climbed) this.vy = -3.4;
        else if (this.vy > 0) this.vy = 0;
      }
      const c = this.moveBounce(w, 5, 0.1, 0.9);
      if (c && c.ny < -0.5) this.vy = Math.min(this.vy, 0);
      if (this.age > 480) {
        this.boom(w);
        return;
      }
      if (w.sim && this.hitSnake(w, 6)) {
        this.boom(w);
        return;
      }
    }
    this.angle = this.mode === 'fly' ? this.flyAngle : 0;
    this.scare(w);
    if (this.sink(w) && !w.sim) sfx.bleat(1.6);
  }

  private boom(w: ProjWorld): void {
    this.alive = false;
    if (!w.sim) w.particles.wool(this.x, this.y, 30);
    w.explode(this.x, this.y, this.sky ? 45 : 50, this.sky ? 60 : 70, 9);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    const x = this.x - cx;
    const y = this.y - cy;
    if (this.mode === 'fly') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.flyAngle);
      drawSheep(ctx, 0, 0, 1, time, true);
      ctx.restore();
    } else drawSheep(ctx, x, y, this.dir, this.age, this.sky);
  }
}

export class FallingSheep extends Projectile {
  private bounces = 0;
  private sinceTouch = -1;
  private readonly spin = rng.range(-0.15, 0.15);

  update(w: ProjWorld): void {
    this.age++;
    this.vy += PHYS.gravity;
    this.angle += this.spin;
    const c = this.moveBounce(w, 5, 0.55, 0.8);
    if (c && c.impact > 1) {
      this.bounces++;
      if (this.sinceTouch < 0) this.sinceTouch = 0;
      if (!w.sim) sfx.bleat(1.1 + this.bounces * 0.15);
    }
    if (this.sinceTouch >= 0) this.sinceTouch++;
    // A sheep wedged in a crevice may never register a bounce; it always goes off eventually.
    if (this.bounces >= 3 || this.sinceTouch > 70 || this.age > 420 || (this.age > 5 && this.hitSnake(w, 5))) {
      this.alive = false;
      if (!w.sim) w.particles.wool(this.x, this.y, 18);
      w.explode(this.x, this.y, 30, 30, 6);
      return;
    }
    if (this.sink(w) && !w.sim) sfx.bleat(1.7);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    ctx.save();
    ctx.translate(this.x - cx, this.y - cy);
    ctx.rotate(this.angle);
    drawSheep(ctx, 0, 0, this.vx >= 0 ? 1 : -1, time);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- from above

export class AirMissile extends Projectile {
  skin: string = 'island';

  update(w: ProjWorld): void {
    this.age++;
    this.vy += PHYS.gravity * 0.6;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      this.x += this.vx / steps;
      this.y += this.vy / steps;
      if (w.terrain.solid(this.x, this.y) || this.hitSnake(w, 3)) {
        this.alive = false;
        w.explode(this.x, this.y, 26, 30, 6);
        return;
      }
    }
    this.angle = Math.atan2(this.vy, this.vx);
    if (!w.sim && this.age % 3 === 0) w.particles.trail(this.x, this.y - 4);
    this.scare(w);
    this.sink(w);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    const th = this.skin;
    ctx.save();
    ctx.translate(this.x - cx, this.y - cy);
    if (th === 'medieval') {
      ctx.fillStyle = '#3a3630';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#7a746a';
      ctx.beginPath();
      ctx.arc(-0.8, -0.8, 3.2, 0, TAU);
      ctx.fill();
    } else if (th === 'acc') {
      ctx.fillStyle = '#1c1c28';
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.fillRect(-1.5, -3, 3, 6);
      ctx.fillStyle = (time >> 2) % 2 ? '#4bf6ff' : '#ff4b6b';
      ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.fillStyle = '#9aa3ad';
      const w = Math.abs(Math.cos(time * 0.9)) * 3 + 1;
      ctx.fillRect(-6 - w / 2, -3, w, 1);
      ctx.fillRect(6 - w / 2, -3, w, 1);
    } else {
      ctx.rotate(this.angle);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(-5, -2.5, 10, 5);
      ctx.fillStyle = '#5a6b7a';
      ctx.fillRect(-4, -1.5, 7, 3);
      ctx.fillStyle = '#e7e7e7';
      ctx.fillRect(2, -1.5, 3, 3);
    }
    ctx.restore();
  }
}

const PIANO_NOTES = [523.3, 440, 392, 329.6, 261.6, 196];

export class Piano extends Projectile {
  private hits = 0;
  private cool = 0;

  update(w: ProjWorld): void {
    this.age++;
    this.vy = Math.min(this.vy + PHYS.gravity, 7);
    if (this.cool > 0) this.cool--;
    const steps = Math.max(1, Math.ceil(this.vy));
    for (let i = 0; i < steps; i++) {
      this.y += this.vy / steps;
      if (this.cool === 0 && (w.terrain.solid(this.x, this.y + 6) || this.hitSnake(w, 8))) {
        if (!w.sim) sfx.pianoNote(PIANO_NOTES[this.hits % PIANO_NOTES.length]!);
        w.explode(this.x, this.y + 4, 30, 30, 6);
        this.hits++;
        this.vy = 2;
        this.cool = 8;
        if (this.hits >= 5) {
          this.alive = false;
          return;
        }
        break;
      }
    }
    this.sink(w);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.translate(this.x - cx, this.y - cy);
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.moveTo(-12, -6);
    ctx.lineTo(8, -6);
    ctx.quadraticCurveTo(14, -6, 13, 2);
    ctx.lineTo(-12, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(-12, 2, 18, 3);
    ctx.fillStyle = '#050505';
    for (let k = -11; k < 6; k += 3) ctx.fillRect(k, 2, 1, 2);
    ctx.fillRect(-11, 5, 2, 6);
    ctx.fillRect(8, 2, 2, 9);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(-10, -5, 18, 1);
    ctx.restore();
  }
}

export class Meteor extends Projectile {
  update(w: ProjWorld): void {
    this.age++;
    this.vy += PHYS.gravity * 0.4;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      this.x += this.vx / steps;
      this.y += this.vy / steps;
      if (w.terrain.solid(this.x, this.y) || this.hitSnake(w, 3)) {
        this.alive = false;
        w.explode(this.x, this.y, 24, 25, 5);
        return;
      }
    }
    if (!w.sim) {
      w.particles.add('fire', this.x, this.y, rng.range(-0.3, 0.3), rng.range(-0.6, 0), rng.int(8, 16), rng.range(2, 4), [255, 190, 80], 0, 0.9);
      if (this.age % 2 === 0) w.particles.add('smoke', this.x, this.y, 0, -0.2, 40, 3, [70, 60, 70], -0.01, 0.97, 0.01);
    }
    this.sink(w);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = '#3a1a0a';
    ctx.beginPath();
    ctx.arc(this.x - cx, this.y - cy, 4.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ff8a2a';
    ctx.beginPath();
    ctx.arc(this.x - cx - 1, this.y - cy - 1, 2.8, 0, TAU);
    ctx.fill();
  }
}

/** Invisible spawner that rains meteors across the island. */
export class MeteorStorm extends Projectile {
  update(w: ProjWorld): void {
    this.age++;
    if (this.age % 9 === 0) {
      const x = rng.range(40, WORLD_W - 40);
      w.spawn(new Meteor(x, -30, rng.range(-1.5, 1.5) + w.wind, rng.range(3, 5), null));
      if (!w.sim && this.age % 27 === 0) sfx.whistle();
    }
    if (this.age > 480) this.alive = false;
  }

  draw(): void {}
}
