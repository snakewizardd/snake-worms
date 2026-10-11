import { env } from './env.ts';
import { css, hex, rng, TAU } from './util.ts';
import type { RGB } from './util.ts';
import type { Terrain } from './terrain.ts';
import { drawText } from './font.ts';

export type PKind = 'smoke' | 'fire' | 'debris' | 'spark' | 'drop' | 'bubble' | 'dust' | 'ring' | 'flash' | 'wool' | 'poison' | 'tracer' | 'sparkle';

export interface Particle {
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: RGB;
  grav: number;
  drag: number;
  wind: number;
}

interface Word {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
  outline: string;
  scale: number;
  rise: number;
  pop: boolean;
}

const WORDS = ['POW!', 'BAM!', 'KABOOM!', 'WHUMP!', 'BLAM!', 'BOOM!', 'KRAK!', 'THOOM!'];
const FIRE_A = hex('#fff6a8');
const FIRE_B = hex('#ffa53a');
const FIRE_C = hex('#d2401f');
const SMOKE = hex('#5d5a63');
let WATER = hex('#7fc4e0');
export function setWaterColor(c: string): void {
  WATER = hex(c);
}
const WHITE = hex('#ffffff');

export class Particles {
  list: Particle[] = [];
  words: Word[] = [];

  add(kind: PKind, x: number, y: number, vx: number, vy: number, life: number, size: number, color: RGB, grav = 0, drag = 0.98, wind = 0): void {
    if (this.list.length > 1800) this.list.shift();
    this.list.push({ kind, x, y, vx, vy, life, max: life, size, color, grav, drag, wind });
  }

  explosion(x: number, y: number, r: number, debris: RGB[]): void {
    this.add('flash', x, y, 0, 0, 5, r * 1.3, FIRE_A);
    this.add('ring', x, y, 0, 0, 14, r * 1.6, WHITE);
    const n = Math.round(r * 0.7);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const s = rng.range(0.3, 2.2) * (r / 32);
      this.add('fire', x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, Math.cos(a) * s, Math.sin(a) * s - 0.3, rng.int(14, 30), rng.range(3, 7) * (r / 32), FIRE_A, -0.02, 0.92);
    }
    for (let i = 0; i < n * 0.8; i++) {
      const a = rng.range(0, TAU);
      const s = rng.range(0.2, 1.2);
      this.add('smoke', x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, Math.cos(a) * s, Math.sin(a) * s - 0.4, rng.int(40, 90), rng.range(4, 9) * (r / 32), SMOKE, -0.012, 0.96, 0.02);
    }
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, TAU);
      const s = rng.range(2, 5);
      this.add('spark', x, y, Math.cos(a) * s, Math.sin(a) * s - 1, rng.int(10, 24), 1, FIRE_B, 0.12, 0.97);
    }
    const cols = debris.length ? debris : [hex('#8a5a32')];
    for (let i = 0; i < Math.min(60, cols.length * 2 + 10); i++) {
      const a = rng.range(Math.PI * 1.05, Math.PI * 1.95);
      const s = rng.range(1.5, 5.5);
      this.add('debris', x + rng.range(-r, r) * 0.5, y + rng.range(-r, r) * 0.5, Math.cos(a) * s, Math.sin(a) * s, rng.int(60, 140), rng.pick([1, 2, 2, 3]), rng.pick(cols), 0.18, 0.995);
    }
    if (r >= 14) this.text(rng.pick(WORDS), x, y - r * 0.4, rng.pick(['#ffe14d', '#ffffff', '#ff8a3d']), 50, r > 50 ? 3 : 2, 0.35, '#3a0d0d');
  }

  text(text: string, x: number, y: number, color: string, life = 60, scale = 2, rise = 0.35, outline = '#000000'): void {
    this.words.push({ text, x, y, life, max: life, color, outline, scale, rise, pop: true });
  }

  wool(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const s = rng.range(0.5, 3.5);
      this.add('wool', x, y, Math.cos(a) * s, Math.sin(a) * s - 1.5, rng.int(50, 110), rng.range(1.5, 3.5), hex('#f4f1ea'), 0.04, 0.95, 0.03);
    }
  }

  poisonCloud(x: number, y: number, r: number): void {
    for (let i = 0; i < 24; i++) {
      const a = rng.range(0, TAU);
      const d = rng.range(0, r);
      this.add('poison', x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(-0.3, 0.3), rng.range(-0.5, -0.1), rng.int(50, 100), rng.range(3, 7), hex(rng.pick(['#7dff4a', '#3fbf2a', '#b6ff6a'])), -0.005, 0.97, 0.02);
    }
  }

  sparkle(x: number, y: number, n: number, color = '#bff4ff'): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const s = rng.range(0.3, 2.2);
      this.add('sparkle', x + rng.range(-4, 4), y + rng.range(-8, 4), Math.cos(a) * s, Math.sin(a) * s, rng.int(20, 45), 1, hex(color), 0, 0.93);
    }
  }

  tracer(x0: number, y0: number, x1: number, y1: number): void {
    this.add('tracer', x0, y0, x1, y1, 6, 1, hex('#fff2a0'), 0, 1);
  }

  splash(x: number, big: boolean): void {
    const n = big ? 40 : 16;
    for (let i = 0; i < n; i++) {
      const s = rng.range(1, big ? 5 : 3);
      const a = rng.range(-Math.PI * 0.85, -Math.PI * 0.15);
      this.add('drop', x + rng.range(-6, 6), env.waterY - 2, Math.cos(a) * s * 0.6, Math.sin(a) * s, rng.int(30, 60), rng.pick([1, 2]), WATER, 0.16, 0.99);
    }
    this.add('ring', x, env.waterY, 0, 0, 18, big ? 26 : 14, WATER);
  }

  bubbles(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) this.add('bubble', x + rng.range(-4, 4), y + rng.range(-3, 3), rng.range(-0.15, 0.15), rng.range(-0.9, -0.3), rng.int(40, 90), rng.pick([1, 1, 2]), WATER, 0, 0.99);
  }

  dust(x: number, y: number, n: number, spread = 1.2): void {
    for (let i = 0; i < n; i++) this.add('dust', x + rng.range(-4, 4), y, rng.range(-spread, spread), rng.range(-0.8, -0.1), rng.int(18, 34), rng.range(1.5, 3), hex('#c9b38f'), 0.01, 0.92);
  }

  trail(x: number, y: number): void {
    this.add('smoke', x, y, rng.range(-0.2, 0.2), rng.range(-0.3, 0), rng.int(25, 45), rng.range(1.5, 3), SMOKE, -0.01, 0.97, 0.015);
    if (rng.chance(0.5)) this.add('fire', x, y, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.int(5, 10), rng.range(1.5, 2.5), FIRE_A, 0, 0.9);
  }

  update(terrain: Terrain, wind: number): void {
    const out: Particle[] = [];
    for (const p of this.list) {
      p.life--;
      if (p.life <= 0) continue;
      if (p.kind === 'tracer') {
        out.push(p);
        continue;
      }
      p.vx = p.vx * p.drag + wind * p.wind;
      p.vy = p.vy * p.drag + p.grav;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === 'debris' && terrain.solid(p.x, p.y)) {
        p.y -= p.vy;
        p.vy *= -0.3;
        p.vx *= 0.5;
      }
      if ((p.kind === 'debris' || p.kind === 'drop' || p.kind === 'spark') && p.y > env.waterY) {
        if (p.kind === 'debris') {
          p.kind = 'bubble';
          p.color = WATER;
          p.vy = -0.4;
          p.grav = 0;
          p.life = Math.min(p.life, 30);
        } else continue;
      }
      if (p.kind === 'bubble' && p.y < env.waterY + 1) continue;
      if (p.kind === 'smoke') p.size += 0.08;
      out.push(p);
    }
    this.list = out;
    for (const w of this.words) {
      w.life--;
      w.y -= w.rise;
    }
    this.words = this.words.filter((w) => w.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    for (const p of this.list) {
      const t = p.life / p.max;
      const x = p.x - cx;
      const y = p.y - cy;
      switch (p.kind) {
        case 'smoke':
          ctx.fillStyle = css(p.color, 0.5 * t);
          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, TAU);
          ctx.fill();
          break;
        case 'fire': {
          const c = t > 0.6 ? FIRE_A : t > 0.3 ? FIRE_B : FIRE_C;
          ctx.fillStyle = css(c, Math.min(1, t * 1.5));
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.5, p.size * t), 0, TAU);
          ctx.fill();
          break;
        }
        case 'flash':
          ctx.fillStyle = css(p.color, t * 0.9);
          ctx.beginPath();
          ctx.arc(x, y, p.size * (1.2 - t * 0.4), 0, TAU);
          ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = css(p.color, t * 0.8);
          ctx.lineWidth = 2 * t + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, p.size * (1 - t * t), 0, TAU);
          ctx.stroke();
          break;
        case 'bubble':
          ctx.strokeStyle = css(p.color, 0.8);
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(x), Math.round(y), p.size, p.size);
          break;
        case 'dust':
          ctx.fillStyle = css(p.color, 0.6 * t);
          ctx.beginPath();
          ctx.arc(x, y, p.size * (1.4 - t * 0.4), 0, TAU);
          ctx.fill();
          break;
        case 'wool':
          ctx.fillStyle = css([200, 196, 188], Math.min(1, t * 2));
          ctx.beginPath();
          ctx.arc(x, y, p.size + 0.6, 0, TAU);
          ctx.fill();
          ctx.fillStyle = css(p.color, Math.min(1, t * 2));
          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, TAU);
          ctx.fill();
          break;
        case 'poison':
          ctx.fillStyle = css(p.color, 0.35 * t);
          ctx.beginPath();
          ctx.arc(x, y, p.size * (1.5 - t * 0.5), 0, TAU);
          ctx.fill();
          break;
        case 'tracer':
          ctx.strokeStyle = css(p.color, t);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(p.vx - cx, p.vy - cy);
          ctx.stroke();
          break;
        case 'sparkle':
          if ((p.life >> 2) % 2) {
            ctx.fillStyle = css(p.color, t);
            ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
            ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
            ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
          }
          break;
        default:
          ctx.fillStyle = css(p.color, Math.min(1, t * 3));
          ctx.fillRect(Math.round(x), Math.round(y), p.size, p.size);
      }
    }
    for (const w of this.words) {
      const age = w.max - w.life;
      const scale = w.pop && age < 4 ? w.scale + 1 : w.scale;
      drawText(ctx, w.text, w.x - cx, w.y - cy - (age < 4 ? 4 : 0), { color: w.color, outline: w.outline, scale, align: 'center', alpha: Math.min(1, w.life / 12) });
    }
  }
}
