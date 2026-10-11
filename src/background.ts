import { VIEW_H, VIEW_W, WORLD_H, WORLD_W } from './config.ts';
import { env } from './env.ts';
import type { ThemeDef } from './themes.ts';
import { fbm, hex, css, mixRGB, rng, TAU } from './util.ts';

interface Cloud {
  x: number;
  y: number;
  img: HTMLCanvasElement;
  depth: number;
}

interface Mote {
  x: number;
  y: number;
  vy: number;
  ph: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  ph: number;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

type Deco = 'palms' | 'castles' | 'datacenter' | 'none';

function ridge(w: number, h: number, color: string, seed: number, base: number, amp: number, scale: number, deco: Deco): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const tops: number[] = [];
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) {
    const y = base - (fbm(x / scale, 0.5, seed, 4) * 0.5 + 0.5) * amp;
    tops.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  const topAt = (x: number): number => tops[Math.max(0, Math.min(tops.length - 1, Math.floor(x / 2)))] ?? base;
  const r = (k: number): number => (Math.sin(k * 12.9898 + seed) * 43758.5453) % 1;
  if (deco === 'palms') {
    for (let x = 30; x < w; x += 40 + Math.floor(Math.abs(r(x)) * 50)) {
      const ty = topAt(x);
      const hgt = 18 + (x % 13);
      const lean = ((x * 7) % 9) - 4;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, ty + 2);
      ctx.quadraticCurveTo(x + lean * 0.5, ty - hgt * 0.5, x + lean, ty - hgt);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI - Math.PI + 0.3 * Math.sin(k);
        ctx.beginPath();
        ctx.moveTo(x + lean, ty - hgt);
        ctx.quadraticCurveTo(x + lean + Math.cos(a) * 6, ty - hgt + Math.sin(a) * 6 - 2, x + lean + Math.cos(a) * 11, ty - hgt + Math.sin(a) * 8 + 4);
        ctx.stroke();
      }
    }
  } else if (deco === 'castles') {
    for (let x = 60; x < w; x += 150 + Math.floor(Math.abs(r(x)) * 160)) {
      const ty = topAt(x) + 4;
      const tw = 46 + Math.floor(Math.abs(r(x + 1)) * 40);
      ctx.fillRect(x - tw / 2, ty - 22, tw, 30);
      for (let k = -tw / 2; k < tw / 2; k += 6) ctx.fillRect(x + k, ty - 26, 3, 4);
      for (const side of [-1, 1]) {
        const tx = x + side * (tw / 2);
        const th = 34 + Math.floor(Math.abs(r(x + side)) * 16);
        ctx.fillRect(tx - 6, ty - th, 12, th + 8);
        ctx.beginPath();
        ctx.moveTo(tx - 8, ty - th);
        ctx.lineTo(tx, ty - th - 12);
        ctx.lineTo(tx + 8, ty - th);
        ctx.fill();
        ctx.fillRect(tx, ty - th - 20, 1, 8);
        ctx.fillRect(tx + 1, ty - th - 20, 5, 3);
      }
    }
  } else if (deco === 'datacenter') {
    for (let x = 10; x < w; x += 22 + Math.floor(Math.abs(r(x)) * 30)) {
      const ty = topAt(x) + 6;
      const bw = 14 + Math.floor(Math.abs(r(x + 2)) * 16);
      const bh = 20 + Math.floor(Math.abs(r(x + 3)) * 70);
      ctx.fillRect(x, ty - bh, bw, bh + 10);
      if (Math.abs(r(x + 4)) > 0.6) ctx.fillRect(x + bw / 2, ty - bh - 10, 1, 10);
    }
  }
  return c;
}

function cloudSprite(seed: number, top: string, bottom: string): HTMLCanvasElement {
  const w = 90 + (seed % 5) * 14;
  const h = 34;
  const [c, ctx] = makeCanvas(w, h);
  const t = hex(top);
  const b = hex(bottom);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 9; i++) {
      const x = 14 + (i / 8) * (w - 28) + Math.sin(seed + i * 3) * 4;
      const y = h * 0.62 - Math.sin((i / 8) * Math.PI) * 10 + Math.cos(seed * 2 + i) * 2;
      const r = 8 + Math.sin((i / 8) * Math.PI) * 7;
      ctx.fillStyle = pass === 0 ? css(b, 0.9) : css(mixRGB(t, b, 0.25), 1);
      ctx.beginPath();
      ctx.arc(x, y + (pass === 0 ? 2 : -1), r, 0, TAU);
      ctx.fill();
    }
  }
  return c;
}

export class Backdrop {
  private sky: HTMLCanvasElement;
  private far: HTMLCanvasElement;
  private near: HTMLCanvasElement;
  private clouds: Cloud[] = [];
  private motes: Mote[] = [];
  private stars: Star[] = [];
  private leds: Array<{ x: number; y: number; c: string; ph: number }> = [];
  private readonly farF = 0.12;
  private readonly nearF = 0.28;
  readonly theme: ThemeDef;

  constructor(seed: number, theme: ThemeDef) {
    this.theme = theme;
    const [sky, sctx] = makeCanvas(1, VIEW_H);
    const g = sctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(0.55, theme.sky[1]);
    g.addColorStop(1, theme.sky[2]);
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 1, VIEW_H);
    this.sky = sky;
    const farW = Math.ceil(VIEW_W + (WORLD_W - VIEW_W) * this.farF) + 4;
    const nearW = Math.ceil(VIEW_W + (WORLD_W - VIEW_W) * this.nearF) + 4;
    const farDeco: Deco = theme.bg === 'datacenter' ? 'datacenter' : 'none';
    this.far = ridge(farW, VIEW_H, theme.mountainFar, seed + 1, VIEW_H * 0.72, 110, 160, farDeco);
    this.near = ridge(nearW, VIEW_H, theme.mountainNear, seed + 2, VIEW_H * 0.86, 70, 90, theme.bg);
    const cloudTop = theme.bg === 'datacenter' ? '#5a1a6a' : theme.bg === 'castles' ? '#9a8c9c' : '#f7c6b3';
    const cloudBottom = theme.bg === 'datacenter' ? '#20082e' : theme.bg === 'castles' ? '#3a3448' : '#8f6a9e';
    for (let i = 0; i < 9; i++) {
      this.clouds.push({ x: rng.range(0, WORLD_W), y: rng.range(10, VIEW_H * 0.45), img: cloudSprite(seed + i * 17, cloudTop, cloudBottom), depth: rng.range(0.25, 0.55) });
    }
    for (let i = 0; i < 80; i++) this.stars.push({ x: rng.range(0, VIEW_W), y: rng.range(0, VIEW_H * 0.45), ph: rng.range(0, TAU) });
    const moteColors = theme.ambient === 'embers' ? ['#ffb04a', '#ff7a2a', '#ffd27a'] : theme.ambient === 'bits' ? ['#4bf6ff', '#7dff7d', '#ff6bf0'] : ['#7ccf3e', '#a6d84a', '#e0b24a', '#5fae3a'];
    for (let i = 0; i < 30; i++) {
      this.motes.push({ x: rng.range(0, VIEW_W), y: rng.range(0, VIEW_H), vy: rng.range(0.15, 0.45), ph: rng.range(0, TAU), color: rng.pick(moteColors) });
    }
    if (theme.bg === 'datacenter') {
      for (let i = 0; i < 90; i++) this.leds.push({ x: rng.range(0, farW), y: rng.range(VIEW_H * 0.45, VIEW_H * 0.85), c: rng.pick(['#4bf6ff', '#ff4b6b', '#7dff7d', '#ffd24b']), ph: rng.range(0, TAU) });
    }
  }

  update(wind: number): void {
    for (const c of this.clouds) {
      c.x += wind * 0.6 * c.depth + 0.05;
      if (c.x > WORLD_W + 200) c.x = -200;
      if (c.x < -200) c.x = WORLD_W + 200;
    }
    const amb = this.theme.ambient;
    for (const l of this.motes) {
      l.ph += 0.05;
      l.x += wind * (amb === 'bits' ? 0.6 : 2.2) + Math.sin(l.ph) * 0.4;
      l.y += amb === 'embers' ? -l.vy : l.vy * (amb === 'bits' ? 2 : 1) + Math.cos(l.ph * 0.7) * 0.15;
      if (l.x > VIEW_W + 8) l.x = -8;
      if (l.x < -8) l.x = VIEW_W + 8;
      if (l.y > VIEW_H + 8) {
        l.y = -8;
        l.x = rng.range(0, VIEW_W);
      }
      if (l.y < -8) {
        l.y = VIEW_H + 8;
        l.x = rng.range(0, VIEW_W);
      }
    }
  }

  drawBack(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number): void {
    ctx.drawImage(this.sky, 0, 0, VIEW_W, VIEW_H);
    const skyT = Math.max(0, camY) / Math.max(1, WORLD_H - VIEW_H);
    for (const s of this.stars) {
      const a = 0.4 + 0.4 * Math.sin(time * 0.05 + s.ph);
      ctx.fillStyle = `rgba(255,240,220,${a * (1 - skyT * 0.6)})`;
      ctx.fillRect(Math.round(s.x), Math.round(s.y - camY * 0.05), 1, 1);
    }
    const sx = VIEW_W * 0.78 - camX * 0.03;
    const sy = VIEW_H * 0.58 - camY * 0.08;
    const sunR = this.theme.synthSun ? 42 : 26;
    if (!this.theme.synthSun) {
      ctx.fillStyle = 'rgba(255,170,120,0.25)';
      ctx.beginPath();
      ctx.arc(sx, sy, 40, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = this.theme.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, sunR, 0, TAU);
    ctx.fill();
    if (this.theme.synthSun) {
      ctx.fillStyle = '#ffd04a';
      ctx.beginPath();
      ctx.arc(sx, sy, sunR, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = this.theme.sky[1];
      for (let k = 0; k < 7; k++) {
        const yy = sy + 4 + k * 6;
        ctx.fillRect(sx - sunR, yy, sunR * 2, 1 + k * 0.5);
      }
    }
    const yShift = (WORLD_H - VIEW_H - camY) * 0.15;
    const farX = -Math.round(camX * this.farF);
    ctx.drawImage(this.far, farX, Math.round(yShift));
    for (const l of this.leds) {
      if (Math.sin(time * 0.08 + l.ph) < 0.2) continue;
      ctx.fillStyle = l.c;
      ctx.fillRect(Math.round(l.x + farX), Math.round(l.y + yShift), 1, 1);
    }
    for (const c of this.clouds) {
      const cx = c.x - camX * c.depth;
      const cy = c.y - camY * c.depth * 0.3;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(c.img, Math.round(cx), Math.round(cy));
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.near, -Math.round(camX * this.nearF), Math.round(yShift * 1.6));
  }

  /** Waves are drawn inside the zoomed world transform, so they take the visible world size. */
  drawWaterBack(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number, vw = VIEW_W, vh = VIEW_H): void {
    this.waves(ctx, camX, camY, time, -10, 2.5, 0.022, 0.025, this.theme.waterDeep, 1, vw, vh);
    this.waves(ctx, camX, camY, time, -5, 2.5, 0.03, -0.03, this.theme.waterMid, 0.9, vw, vh);
  }

  drawWaterFront(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number, vw = VIEW_W, vh = VIEW_H): void {
    this.waves(ctx, camX, camY, time, 0, 3, 0.035, 0.04, this.theme.waterMid, 0.75, vw, vh);
    this.drawWaterFrontLow(ctx, camX, camY, time, vw, vh);
  }

  drawWaterFrontLow(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number, vw = VIEW_W, vh = VIEW_H): void {
    this.waves(ctx, camX, camY, time, 8, 3, 0.028, -0.035, this.theme.waterDeep, 0.85, vw, vh);
    this.waves(ctx, camX, camY, time, 18, 2, 0.04, 0.05, this.theme.waterDeep, 0.95, vw, vh);
  }

  private waves(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number, off: number, amp: number, freq: number, speed: number, color: string, alpha: number, vw: number, vh: number): void {
    const base = env.waterY + off - camY;
    if (base > vh + 6) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-2, vh + 2);
    const step = vw > VIEW_W * 1.5 ? 8 : 4;
    for (let x = -2; x <= vw + step; x += step) {
      const wx = x + camX;
      const y = base + Math.sin(wx * freq + time * speed) * amp + Math.sin(wx * freq * 2.3 - time * speed * 1.7) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(vw + step, vh + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = this.theme.waterCrest;
    for (let x = 0; x <= vw; x += step) {
      const wx = x + camX;
      const y = base + Math.sin(wx * freq + time * speed) * amp + Math.sin(wx * freq * 2.3 - time * speed * 1.7) * amp * 0.4;
      if (Math.sin(wx * freq + time * speed) > 0.55) ctx.fillRect(x, Math.round(y), step, 1);
    }
    ctx.globalAlpha = 1;
  }

  drawMotes(ctx: CanvasRenderingContext2D): void {
    const amb = this.theme.ambient;
    for (const l of this.motes) {
      ctx.fillStyle = l.color;
      const s = Math.sin(l.ph * 2);
      if (amb === 'bits') {
        ctx.globalAlpha = 0.7;
        if (s > 0) ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 3);
        else {
          ctx.fillRect(Math.round(l.x), Math.round(l.y), 2, 1);
          ctx.fillRect(Math.round(l.x), Math.round(l.y) + 2, 2, 1);
          ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 3);
          ctx.fillRect(Math.round(l.x) + 2, Math.round(l.y), 1, 3);
        }
        ctx.globalAlpha = 1;
      } else if (amb === 'embers') {
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(s);
        ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 1);
        ctx.globalAlpha = 1;
      } else ctx.fillRect(Math.round(l.x), Math.round(l.y), s > 0 ? 2 : 1, s > 0 ? 1 : 2);
    }
  }
}
