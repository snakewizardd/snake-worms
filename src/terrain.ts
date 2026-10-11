import { WATER_Y } from './config.ts';
import { env } from './env.ts';
import type { ThemeDef } from './themes.ts';
import { fbm, hash2, hex, mixRGB, packABGR, smoothstep, vnoise, Rng } from './util.ts';
import type { RGB } from './util.ts';

export interface Hit {
  hit: boolean;
  nx: number;
  ny: number;
}

const RING: Array<[number, number]> = [];
for (let i = 0; i < 16; i++) RING.push([Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
const INNER: Array<[number, number]> = [];
for (let i = 0; i < 6; i++) INNER.push([Math.cos((i / 6) * Math.PI * 2) * 0.5, Math.sin((i / 6) * Math.PI * 2) * 0.5]);

const MAT_SOIL = 0;
const MAT_STRUCT = 1;
const MAT_STEEL = 2;
const STEEL = hex('#8d9aab');
const STEEL_DARK = hex('#4a5260');
const LEDS: RGB[] = [hex('#4bf6ff'), hex('#7dff7d'), hex('#ff4b6b'), hex('#ffd24b')];

interface Pal {
  soilDark: RGB; soilLight: RGB; strata: RGB; stone: RGB; stoneLight: RGB;
  grassDark: RGB; grassLight: RGB; edge: RGB; scorch: RGB; structDark: RGB; structLight: RGB;
}

export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly theme: ThemeDef;
  readonly mask: Uint8Array;
  private readonly depth: Uint8Array;
  private readonly mat: Uint8Array;
  private readonly pal: Pal;
  canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private px: Uint32Array | null = null;
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Bumped on every change so the minimap knows to refresh. */
  version = 0;

  constructor(w: number, h: number, seed: number, theme: ThemeDef) {
    this.w = w;
    this.h = h;
    this.seed = seed;
    this.theme = theme;
    this.mask = new Uint8Array(w * h);
    this.depth = new Uint8Array(w * h);
    this.mat = new Uint8Array(w * h);
    this.pal = {
      soilDark: hex(theme.soilDark), soilLight: hex(theme.soilLight), strata: hex(theme.soilStrata),
      stone: hex(theme.stone), stoneLight: hex(theme.stoneLight), grassDark: hex(theme.grassDark),
      grassLight: hex(theme.grassLight), edge: hex(theme.edge), scorch: hex(theme.scorch),
      structDark: hex(theme.structDark), structLight: hex(theme.structLight),
    };
    let s = seed;
    for (let attempt = 0; attempt < 12; attempt++) {
      this.generate(s);
      const ratio = this.landRatio();
      if (ratio > 0.3 && ratio < 0.62) break;
      s = (s * 1103515245 + 12345) >>> 0;
    }
    this.removeSpecks(500);
    if (theme.structure !== 'none') this.stampStructures(new Rng(seed ^ 0x7777));
    this.computeDepth();
    if (typeof document !== 'undefined') this.paint();
  }

  solid(x: number, y: number): boolean {
    x |= 0;
    y |= 0;
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
    return this.mask[y * this.w + x] !== 0;
  }

  circleHit(cx: number, cy: number, r: number): Hit {
    let nx = 0;
    let ny = 0;
    let hit = false;
    for (const [dx, dy] of RING) {
      if (this.solid(cx + dx * r, cy + dy * r)) {
        hit = true;
        nx -= dx;
        ny -= dy;
      }
    }
    for (const [dx, dy] of INNER) {
      if (this.solid(cx + dx * r, cy + dy * r)) {
        hit = true;
        nx -= dx * 2;
        ny -= dy * 2;
      }
    }
    if (this.solid(cx, cy)) hit = true;
    if (!hit) return { hit, nx: 0, ny: 0 };
    const len = Math.hypot(nx, ny);
    if (len < 1e-4) return { hit, nx: 0, ny: -1 };
    return { hit, nx: nx / len, ny: ny / len };
  }

  /** True if a circle at (x, y) touches nothing. */
  free(x: number, y: number, r: number): boolean {
    return !this.circleHit(x, y, r).hit;
  }

  private landRatio(): number {
    let n = 0;
    const lim = WATER_Y * this.w;
    for (let i = 0; i < lim; i++) n += this.mask[i]!;
    return n / lim;
  }

  private generate(seed: number): void {
    const { w, h } = this;
    const step = 4;
    const gw = Math.ceil(w / step) + 2;
    const gh = Math.ceil(h / step) + 2;
    const field = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x = gx * step;
        const y = gy * step;
        const nx = x / w;
        const ny = y / h;
        const side = smoothstep(0.03, 0.17, nx) * smoothstep(0.03, 0.17, 1 - nx);
        const base = fbm(x / 230, y / 200, seed, 4);
        const detail = fbm(x / 70, y / 70, seed + 7, 3) * 0.4;
        let v = base * 1.5 + detail + (ny - 0.5) * 3.4 - (1 - side) * 3.0;
        const cave = fbm(x / 120 + 31, y / 60 + 17, seed + 3, 3);
        if (ny > 0.42 && cave > 0.3) v -= (cave - 0.3) * 7;
        const chasm = Math.abs(vnoise(x / 300, 0.5, seed + 11));
        if (chasm < 0.06 && ny < 0.8) v -= (0.06 - chasm) * 14;
        field[gy * gw + gx] = v;
      }
    }
    const mask = this.mask;
    for (let y = 0; y < h; y++) {
      const gy = y / step;
      const gy0 = gy | 0;
      const fy = gy - gy0;
      for (let x = 0; x < w; x++) {
        const gx = x / step;
        const gx0 = gx | 0;
        const fx = gx - gx0;
        const i0 = gy0 * gw + gx0;
        const a = field[i0]!;
        const b = field[i0 + 1]!;
        const c = field[i0 + gw]!;
        const d = field[i0 + gw + 1]!;
        let v = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
        v += (hash2(x, y, seed) - 0.5) * 0.05;
        mask[y * w + x] = v > 0.05 ? 1 : 0;
      }
    }
  }

  private removeSpecks(minSize: number): void {
    const { w, h, mask } = this;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const comp: number[] = [];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      comp.length = 0;
      while (sp > 0) {
        const i = stack[--sp]!;
        comp.push(i);
        const x = i % w;
        const y = (i / w) | 0;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
      }
      if (comp.length < minSize) for (const i of comp) mask[i] = 0;
    }
  }

  private computeDepth(): void {
    const { w, h, mask, depth } = this;
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        run = mask[i] ? Math.min(255, run + 1) : 0;
        depth[i] = run;
      }
    }
  }

  surfaceY(x: number, from = 0): number {
    for (let y = Math.max(0, from); y < this.h; y++) if (this.solid(x, y)) return y;
    return -1;
  }

  private stampStructures(r: Rng): void {
    const count = r.int(3, 5);
    const placed: number[] = [];
    for (let attempt = 0; attempt < 60 && placed.length < count; attempt++) {
      const x = r.int(160, this.w - 160);
      if (placed.some((p) => Math.abs(p - x) < 160)) continue;
      const top = this.surfaceY(x, 30);
      if (top < 0 || top > WATER_Y - 120) continue;
      const bw = this.theme.structure === 'towers' ? r.int(22, 32) : r.int(18, 26);
      const bh = r.int(40, 72);
      let groundL = this.surfaceY(x - (bw >> 1), 30);
      let groundR = this.surfaceY(x + (bw >> 1), 30);
      if (groundL < 0) groundL = top;
      if (groundR < 0) groundR = top;
      const base = Math.max(top, groundL, groundR) + 6;
      const y0 = base - bh - 6;
      if (y0 < 20) continue;
      placed.push(x);
      for (let y = y0; y < base; y++) {
        for (let xx = x - (bw >> 1); xx <= x + (bw >> 1); xx++) {
          if (xx < 0 || xx >= this.w) continue;
          const i = y * this.w + xx;
          this.mask[i] = 1;
          this.mat[i] = MAT_STRUCT;
        }
      }
      if (this.theme.structure === 'towers') {
        // Crenellations on top and a few windows punched through.
        for (let xx = x - (bw >> 1); xx <= x + (bw >> 1); xx++) {
          if (((xx - x + 64) >> 2) % 2 === 0) continue;
          for (let y = y0; y < y0 + 4; y++) this.mask[y * this.w + xx] = 0;
        }
        for (let wy = y0 + 12; wy < base - 16; wy += 16) {
          for (let y = wy; y < wy + 7; y++) for (let xx = x - 1; xx <= x + 1; xx++) this.mask[y * this.w + xx] = 0;
        }
      }
    }
  }

  baseColor(x: number, y: number): RGB {
    const xi = x | 0;
    const yi = y | 0;
    const inside = xi >= 0 && yi >= 0 && xi < this.w && yi < this.h;
    const i = inside ? yi * this.w + xi : 0;
    const m = inside ? this.mat[i]! : MAT_SOIL;
    const p = this.pal;
    const s = this.seed;
    const grain = hash2(x, y, s + 51);
    if (m === MAT_STEEL) {
      const rivet = (xi % 10 === 3) && (yi % 4 === 2);
      return rivet ? STEEL_DARK : mixRGB(STEEL, STEEL_DARK, grain * 0.25);
    }
    if (m === MAT_STRUCT) {
      if (this.theme.structure === 'towers') {
        const by = Math.floor(y / 6);
        const off = by & 1 ? 5 : 0;
        const mortar = yi % 6 === 0 || (xi + off) % 10 === 0;
        if (mortar) return mixRGB(p.structDark, p.edge, 0.4);
        return mixRGB(p.structDark, p.structLight, 0.35 + hash2(Math.floor((x + off) / 10), by, s + 80) * 0.5 + grain * 0.1);
      }
      const slat = xi % 4 === 0;
      const led = yi % 9 === 4 && xi % 6 === 2;
      if (led) return LEDS[Math.floor(hash2(xi, yi, s + 81) * LEDS.length)]!;
      return slat ? p.structLight : mixRGB(p.structDark, p.structLight, grain * 0.3);
    }
    const n = vnoise(x / 11, y / 11, s + 50) * 0.5 + 0.5;
    const n2 = vnoise(x / 34, y / 30, s + 54) * 0.5 + 0.5;
    const depth = inside ? this.depth[i]! : 0;
    let c = mixRGB(p.soilDark, p.soilLight, n2 * 0.55 + n * 0.3 + grain * 0.15);
    const pattern = this.theme.pattern;
    if (pattern === 'circuit') {
      const cx = Math.floor(x / 8);
      const cy = Math.floor(y / 8);
      const h = hash2(cx, cy, s + 90);
      const chip = vnoise(x / 26, y / 18, s + 91) > 0.62;
      if (chip) {
        const edgeChip = vnoise(x / 26, y / 18, s + 91) < 0.66;
        return edgeChip ? p.stoneLight : mixRGB(hex('#0b0b12'), hex('#22222e'), grain * 0.5);
      }
      if ((h < 0.35 && yi % 8 === 4) || (h > 0.35 && h < 0.6 && xi % 8 === 4)) c = mixRGB(p.stone, p.stoneLight, grain * 0.4);
      if (xi % 8 === 4 && yi % 8 === 4 && h > 0.8) c = p.stoneLight;
      return mixRGB(c, p.soilDark, smoothstep(10, 80, depth) * 0.4);
    }
    if (pattern === 'brick' && vnoise(x / 70, y / 55, s + 70) > 0.05) {
      const by = Math.floor(y / 7);
      const off = by & 1 ? 7 : 0;
      const mortar = yi % 7 === 0 || (xi + off) % 14 === 0;
      if (mortar) c = mixRGB(p.soilDark, p.edge, 0.3);
      else c = mixRGB(p.stone, p.stoneLight, hash2(Math.floor((x + off) / 14), by, s + 71) * 0.45 + grain * 0.1);
      return mixRGB(c, p.soilDark, smoothstep(10, 70, depth) * 0.5);
    }
    const strata = 0.5 + 0.5 * Math.sin(y * 0.09 + vnoise(x / 60, y / 60, s + 52) * 5);
    if (strata > 0.86) c = mixRGB(c, p.strata, 0.6);
    c = mixRGB(c, p.soilDark, smoothstep(10, 70, depth) * 0.45);
    const stone = vnoise(x / 15, y / 11, s + 53);
    if (stone > 0.74) {
      const edge = stone < 0.78;
      const top = vnoise(x / 15, (y - 2) / 11, s + 53) <= 0.74;
      c = edge ? mixRGB(p.stone, p.edge, 0.55) : top ? mixRGB(p.stone, p.stoneLight, 0.5) : mixRGB(p.stone, p.soilDark, grain * 0.25);
    }
    return c;
  }

  private paint(): void {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(this.w, this.h);
    const px = new Uint32Array(img.data.buffer);
    this.canvas = canvas;
    this.ctx = ctx;
    this.img = img;
    this.px = px;
    this.repaint(0, 0, this.w - 1, this.h - 1, true);
    ctx.putImageData(img, 0, 0);
  }

  /** Recolors a rectangle from the mask; grass only on fresh generation. */
  private repaint(x0: number, y0: number, x1: number, y1: number, grass: boolean): void {
    const px = this.px;
    if (!px) return;
    const { w, mask } = this;
    const p = this.pal;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!mask[i]) {
          if (!grass) px[i] = 0;
          continue;
        }
        let c = this.baseColor(x, y);
        if (!this.solid(x - 1, y) || !this.solid(x + 1, y) || !this.solid(x, y + 1)) c = mixRGB(c, p.edge, 0.55);
        px[i] = packABGR(c);
      }
    }
    if (!grass) return;
    for (let x = x0; x <= x1; x++) {
      for (let y = Math.max(1, y0); y <= y1; y++) {
        const i = y * w + x;
        if (!mask[i] || mask[i - w] || this.mat[i] !== MAT_SOIL) continue;
        const depth = 3 + Math.floor(hash2(x, y, this.seed + 60) * 3);
        for (let k = 0; k < depth && y + k < this.h; k++) {
          const j = i + k * w;
          if (!mask[j]) break;
          px[j] = packABGR(mixRGB(p.grassLight, p.grassDark, k / depth + hash2(x, y + k, 61) * 0.2));
        }
        const tuft = hash2(x, y, this.seed + 62);
        if (tuft > 0.55 && this.theme.pattern !== 'circuit') {
          const th = tuft > 0.9 ? 3 : tuft > 0.75 ? 2 : 1;
          for (let k = 1; k <= th && y - k >= 0; k++) px[i - k * w] = packABGR(mixRGB(p.grassLight, p.grassDark, k / 4));
        }
      }
    }
  }

  /** Removes a disc of terrain. Returns sampled debris colors for particles. */
  carve(cx: number, cy: number, r: number): RGB[] {
    const { w, h, mask } = this;
    const debris: RGB[] = [];
    const rim = r + 3;
    const x0 = Math.max(0, Math.floor(cx - rim));
    const x1 = Math.min(w - 1, Math.ceil(cx + rim));
    const y0 = Math.max(0, Math.floor(cy - rim));
    const y1 = Math.min(h - 1, Math.ceil(cy + rim));
    const r2 = r * r;
    const rim2 = rim * rim;
    const px = this.px;
    let removed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        const i = y * w + x;
        if (d2 <= r2) {
          if (mask[i]) {
            removed++;
            if (debris.length < 40 && ((x * 7 + y * 13) & 31) === 0) debris.push(this.baseColor(x, y));
          }
          mask[i] = 0;
          if (px) px[i] = 0;
        }
      }
    }
    if (px) {
      const scorch = this.pal.scorch;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          const i = y * w + x;
          if (d2 > r2 && d2 <= rim2 && mask[i]) {
            const t = 1 - (Math.sqrt(d2) - r) / 3;
            px[i] = packABGR(mixRGB(this.baseColor(x, y), scorch, 0.35 + 0.5 * t));
          } else if (d2 <= r2 + 2 * r && d2 > r2 && !mask[i]) px[i] = 0;
        }
      }
      this.markDirty(x0, y0, x1, y1);
    }
    if (removed) this.version++;
    return debris;
  }

  /** Stamps a steel beam. Returns false if it would bury a body (caller passes a check). */
  stampGirder(cx: number, cy: number, angle: number, len: number, blocked: (x: number, y: number) => boolean): boolean {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const pts: number[] = [];
    for (let t = -len / 2; t <= len / 2; t += 0.5) {
      for (let k = -3; k <= 3; k += 0.5) {
        const x = Math.round(cx + ca * t - sa * k);
        const y = Math.round(cy + sa * t + ca * k);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if (blocked(x, y)) return false;
        pts.push(y * this.w + x);
      }
    }
    let x0 = this.w;
    let y0 = this.h;
    let x1 = 0;
    let y1 = 0;
    for (const i of pts) {
      this.mask[i] = 1;
      this.mat[i] = MAT_STEEL;
      const x = i % this.w;
      const y = (i / this.w) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    this.repaint(Math.max(0, x0 - 1), Math.max(0, y0 - 1), Math.min(this.w - 1, x1 + 1), Math.min(this.h - 1, y1 + 1), false);
    this.markDirty(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
    this.version++;
    return true;
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(this.w - 1, x1);
    y1 = Math.min(this.h - 1, y1);
    if (!this.dirty) this.dirty = { x0, y0, x1, y1 };
    else {
      this.dirty.x0 = Math.min(this.dirty.x0, x0);
      this.dirty.y0 = Math.min(this.dirty.y0, y0);
      this.dirty.x1 = Math.max(this.dirty.x1, x1);
      this.dirty.y1 = Math.max(this.dirty.y1, y1);
    }
  }

  flush(): void {
    if (!this.dirty || !this.ctx || !this.img) return;
    const d = this.dirty;
    this.ctx.putImageData(this.img, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
    this.dirty = null;
  }

  /** Standing spots on the surface, spaced apart, above the water. */
  findSpawns(count: number, minDist: number, rng: Rng, avoid: Array<{ x: number; y: number }> = []): Array<{ x: number; y: number }> {
    const spots: Array<{ x: number; y: number }> = [];
    for (let attempt = 0; attempt < 5000 && spots.length < count; attempt++) {
      const x = rng.int(80, this.w - 80);
      let y = -1;
      for (let yy = 30; yy < env.waterY - 40; yy++) {
        if (this.solid(x, yy) && !this.solid(x, yy - 1)) {
          y = yy;
          break;
        }
      }
      if (y < 0) continue;
      let clear = true;
      for (let dy = 1; dy <= 22 && clear; dy++) for (let dx = -6; dx <= 6; dx++) if (this.solid(x + dx, y - dy)) { clear = false; break; }
      if (!clear) continue;
      let flat = 0;
      for (let dx = -4; dx <= 4; dx++) if (this.solid(x + dx, y + 2)) flat++;
      if (flat < 7) continue;
      const d = minDist * (attempt > 3000 ? 0.5 : 1);
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < d)) continue;
      if (avoid.some((s) => Math.hypot(s.x - x, s.y - y) < d * 0.6)) continue;
      spots.push({ x, y });
    }
    return spots;
  }
}
