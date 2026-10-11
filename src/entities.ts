import { PHYS } from './config.ts';
import { env } from './env.ts';
import type { Terrain } from './terrain.ts';
import type { Particles } from './particles.ts';
import type { Snake, Team } from './snake.ts';
import type { ThemeDef } from './themes.ts';
import { sfx } from './audio.ts';
import { drawText } from './font.ts';
import { rng, TAU } from './util.ts';

export interface EntWorld {
  terrain: Terrain;
  particles: Particles;
  snakes: Snake[];
  props: Prop[];
  wind: number;
  theme: ThemeDef;
  explode(x: number, y: number, radius: number, damage: number, knock: number): void;
  flames(x: number, y: number, n: number, spread: number): void;
  damage(s: Snake, amount: number): void;
  collect(p: Prop, s: Snake): void;
}

export type PropKind = 'mine' | 'barrel' | 'crate' | 'grave';

export class Prop {
  readonly kind: PropKind;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  readonly r: number;
  resting = false;
  sinking = false;
  alive = true;
  hp = 30;
  armT = 0;
  trigger = -1;
  chute = false;
  crate: 'weapon' | 'health' = 'weapon';
  team: Team | null = null;
  age = 0;

  constructor(kind: PropKind, x: number, y: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.r = kind === 'mine' ? 3 : kind === 'barrel' ? 6 : kind === 'crate' ? 6 : 6;
  }

  get settled(): boolean {
    if (!this.alive || this.sinking) return true;
    if (this.kind === 'mine' && this.trigger >= 0) return false;
    if (this.chute) return false;
    return this.resting;
  }

  update(w: EntWorld): void {
    this.age++;
    if (this.sinking) {
      this.y += 0.3;
      if (this.y > env.waterY + 60) this.alive = false;
      return;
    }
    if (this.kind === 'mine') this.updateMine(w);
    if (this.kind === 'barrel' && this.hp <= 0) {
      this.alive = false;
      w.explode(this.x, this.y, 34, 30, 6);
      w.flames(this.x, this.y - 4, 16, 2.2);
      return;
    }
    if (this.kind === 'crate') {
      for (const s of w.snakes) {
        if (s.alive && Math.hypot(s.x - this.x, s.y - this.y) < this.r + 7) {
          this.alive = false;
          w.collect(this, s);
          return;
        }
      }
    }
    if (!this.alive) return;
    if (this.resting) {
      if (w.terrain.circleHit(this.x, this.y + 1, this.r).hit) return;
      this.resting = false;
    }
    if (this.chute) {
      this.vy = Math.min(this.vy + 0.05, 0.9);
      this.vx = w.wind * 0.5 + Math.sin(this.age * 0.05) * 0.3;
    } else this.vy += PHYS.gravity;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy)));
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx / steps;
      const ny = this.y + this.vy / steps;
      const h = w.terrain.circleHit(nx, ny, this.r);
      if (!h.hit) {
        this.x = nx;
        this.y = ny;
        continue;
      }
      const vn = this.vx * h.nx + this.vy * h.ny;
      if (vn < 0) {
        if (this.chute || (h.ny < -0.5 && Math.hypot(this.vx, this.vy) < 1.6)) {
          this.chute = false;
          this.vx = 0;
          this.vy = 0;
          this.resting = true;
          sfx.land(0.15);
        } else {
          this.vx -= 1.35 * vn * h.nx;
          this.vy -= 1.35 * vn * h.ny;
          this.vx *= 0.75;
        }
      }
      break;
    }
    const emb = w.terrain.circleHit(this.x, this.y, this.r);
    if (emb.hit && !this.resting) {
      this.x += emb.nx;
      this.y += emb.ny;
    }
    if (this.y > env.waterY) {
      this.sinking = true;
      this.chute = false;
      w.particles.splash(this.x, false);
      sfx.splash(false);
    }
  }

  private updateMine(w: EntWorld): void {
    if (this.armT > 0) {
      this.armT--;
      return;
    }
    if (this.trigger < 0) {
      for (const s of w.snakes) {
        if (s.alive && Math.hypot(s.x - this.x, s.y - this.y) < 26) {
          this.trigger = 60;
          sfx.mineBeep();
          s.setExpr('fear', 60);
          break;
        }
      }
      return;
    }
    this.trigger--;
    if (this.trigger % 10 === 0) sfx.mineBeep();
    if (this.trigger <= 0) {
      this.alive = false;
      w.explode(this.x, this.y, 30, 45, 7);
    }
  }

  /** Reaction to a nearby explosion. */
  hit(x: number, y: number, reach: number, damage: number, knock: number): void {
    const d = Math.hypot(this.x - x, this.y - y);
    if (d >= reach || this.sinking || !this.alive) return;
    const f = 1 - d / reach;
    this.vx += d > 0.5 ? ((this.x - x) / d) * knock * f : 0;
    this.vy -= knock * f * 0.8 + 0.5;
    this.resting = false;
    this.chute = false;
    if (this.kind === 'barrel') this.hp -= damage * f + 5;
    if (this.kind === 'mine' && this.armT === 0) this.trigger = Math.min(this.trigger < 0 ? 999 : this.trigger, 8);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, theme: ThemeDef): void {
    const x = Math.round(this.x - cx);
    const y = Math.round(this.y - cy);
    switch (this.kind) {
      case 'mine': {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.ellipse(x, y + 1, 5, 3, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#4a4f55';
        ctx.beginPath();
        ctx.ellipse(x, y + 0.5, 4, 2, 0, 0, TAU);
        ctx.fill();
        const blink = this.trigger >= 0 ? (time >> 2) % 2 : (time >> 5) % 2;
        ctx.fillStyle = blink ? '#ff2a2a' : '#5a0a0a';
        ctx.fillRect(x - 0.5, y - 2, 1.5, 1.5);
        if (this.trigger >= 0) drawText(ctx, String(Math.ceil(this.trigger / 60 * 1)), x, y - 14, { color: '#ff6a6a', align: 'center' });
        break;
      }
      case 'barrel': {
        const [body, band] = theme.barrel;
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 6, y - 7, 12, 14);
        ctx.fillStyle = body;
        ctx.fillRect(x - 5, y - 6, 10, 12);
        ctx.fillStyle = band;
        ctx.fillRect(x - 5, y - 4, 10, 1.5);
        ctx.fillRect(x - 5, y + 2.5, 10, 1.5);
        if (theme.id === 'acc') {
          ctx.fillStyle = '#4bf6ff';
          ctx.fillRect(x - 1, y - 2, 2, 3);
          ctx.fillRect(x - 2, y - 1, 1, 1);
        } else {
          ctx.fillStyle = '#ffe14d';
          ctx.fillRect(x - 1, y - 2, 2, 2);
          ctx.fillStyle = '#000';
          ctx.fillRect(x - 0.5, y - 1.5, 1, 1);
        }
        break;
      }
      case 'crate': {
        if (this.chute) {
          ctx.strokeStyle = '#ddd';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x - 6, y - 6);
          ctx.lineTo(x - 10, y - 20);
          ctx.moveTo(x + 6, y - 6);
          ctx.lineTo(x + 10, y - 20);
          ctx.stroke();
          ctx.fillStyle = this.crate === 'health' ? '#ffffff' : '#e8463a';
          ctx.beginPath();
          ctx.arc(x, y - 20, 12, Math.PI, TAU);
          ctx.fill();
          ctx.fillStyle = this.crate === 'health' ? '#e8463a' : '#ffffff';
          ctx.fillRect(x - 2, y - 31, 4, 11);
        }
        const health = this.crate === 'health';
        const wood = theme.id === 'acc' ? '#2a2a3a' : theme.id === 'medieval' ? '#7a4a22' : '#9a6a32';
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 7, y - 7, 14, 14);
        ctx.fillStyle = health ? '#f2f2f2' : wood;
        ctx.fillRect(x - 6, y - 6, 12, 12);
        if (health) {
          ctx.fillStyle = '#e02a2a';
          ctx.fillRect(x - 1.5, y - 4, 3, 8);
          ctx.fillRect(x - 4, y - 1.5, 8, 3);
        } else {
          ctx.fillStyle = theme.id === 'acc' ? '#4bf6ff' : '#ffd24b';
          ctx.fillRect(x - 6, y - 1, 12, 2);
          ctx.fillRect(x - 1, y - 6, 2, 12);
          if (theme.id === 'medieval') {
            ctx.fillStyle = '#ffd24b';
            ctx.fillRect(x - 6, y - 6, 12, 2);
          }
        }
        break;
      }
      case 'grave': {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1.4, 1.4);
        ctx.lineCap = 'round';
        const path = (): void => {
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const a = (i / 24) * TAU * 1.5;
            const rr = 1.2 + (i / 24) * 3.8;
            const px = Math.cos(a) * rr;
            const py = Math.sin(a) * rr * 0.75 + 1;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        };
        ctx.strokeStyle = '#4b4030';
        ctx.lineWidth = 3.5;
        path();
        ctx.stroke();
        ctx.strokeStyle = '#efe3c4';
        ctx.lineWidth = 2;
        path();
        ctx.stroke();
        ctx.fillStyle = '#4b4030';
        ctx.beginPath();
        ctx.ellipse(-5.5, 1, 2.6, 2, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#efe3c4';
        ctx.beginPath();
        ctx.ellipse(-5.5, 1, 1.8, 1.3, 0, 0, TAU);
        ctx.fill();
        if (this.team) {
          ctx.fillStyle = this.team.def.color;
          ctx.fillRect(-1, -6, 1, 4);
          ctx.fillRect(0, -6, 3, 2);
        }
        ctx.restore();
        break;
      }
    }
  }
}

export class Flame {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  stuck = false;
  alive = true;
  private readonly ph = rng.range(0, TAU);

  constructor(x: number, y: number, vx: number, vy: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = rng.int(200, 320);
  }

  update(w: EntWorld, tick: number): void {
    this.life--;
    if (this.life <= 0 || this.y > env.waterY) {
      this.alive = false;
      if (this.y > env.waterY) w.particles.add('smoke', this.x, env.waterY - 2, 0, -0.6, 30, 3, [220, 220, 230], -0.01, 0.97);
      return;
    }
    const t = w.terrain;
    if (this.stuck && !t.solid(this.x, this.y + 1) && !t.solid(this.x, this.y + 2)) this.stuck = false;
    if (!this.stuck) {
      this.vy += 0.15;
      this.vx += w.wind * 0.01;
      this.x += this.vx;
      this.y += this.vy;
      if (t.solid(this.x, this.y)) {
        this.y -= this.vy;
        this.x -= this.vx;
        this.stuck = true;
      } else if (t.solid(this.x, this.y + 1)) this.stuck = true;
      if (this.stuck) {
        this.vx = 0;
        this.vy = 0;
      }
    } else if ((tick + Math.floor(this.ph * 10)) % 40 === 0) {
      t.carve(this.x, this.y + 1, 2.2);
    }
    if (tick % 12 === 0) {
      for (const s of w.snakes) {
        if (s.alive && Math.abs(s.x - this.x) < 7 && Math.abs(s.y + 2 - this.y) < 9) {
          w.damage(s, 2);
          if (s.state === 'ground') s.setExpr('hurt', 20);
        }
      }
      for (const p of w.props) if (p.kind === 'barrel' && Math.hypot(p.x - this.x, p.y - this.y) < 11) p.hp -= 4;
    }
    if (tick % 7 === 0) w.particles.add('smoke', this.x, this.y - 3, 0, -0.4, 25, 1.5, [60, 55, 60], -0.01, 0.97, 0.01);
    if (tick % 25 === 0 && rng.chance(0.3)) sfx.crackle();
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    const x = this.x - cx;
    const y = this.y - cy;
    const fl = Math.sin(time * 0.6 + this.ph);
    const s = Math.min(1, this.life / 60);
    ctx.fillStyle = '#d2401f';
    ctx.beginPath();
    ctx.arc(x, y - 1, 2.6 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffa53a';
    ctx.beginPath();
    ctx.arc(x + fl * 0.5, y - 2.5, 1.9 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff6a8';
    ctx.beginPath();
    ctx.arc(x - fl * 0.4, y - 3.5, 1 * s, 0, TAU);
    ctx.fill();
  }
}
