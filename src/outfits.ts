// Head accessories, drawn in head-local space: facing +x, head centered near (0.5, 0), top of head at y = -4.
import type { OutfitId } from './themes.ts';
import { TAU } from './util.ts';

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, color: string, pts: number[]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
  ctx.fill();
}

function ell(ctx: Ctx, color: string, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Drawn before the eye so it can sit behind it. */
export function outfitCoversEye(id: OutfitId): boolean {
  return id === 'knight';
}

export function drawOutfit(ctx: Ctx, id: OutfitId, time: number): void {
  switch (id) {
    case 'tophat':
      rect(ctx, '#0d0d0d', -4.5, -5.4, 11, 1.8);
      rect(ctx, '#0d0d0d', -2.4, -12.5, 6.2, 7.5);
      rect(ctx, '#c0392b', -2.4, -6.8, 6.2, 1.3);
      rect(ctx, '#3a3a3a', -1.8, -12, 1, 4.6);
      break;
    case 'crown':
      poly(ctx, '#a37a12', [-3.6, -4.2, 4.6, -4.2, 4.6, -7, 3.6, -10.2, 2.4, -7, 0.5, -11, -1.4, -7, -2.6, -10.2, -3.6, -7]);
      poly(ctx, '#f5c542', [-3, -4.8, 4, -4.8, 4, -6.8, 3.4, -9, 2.3, -6.6, 0.5, -10, -1.3, -6.6, -2.4, -9, -3, -6.8]);
      rect(ctx, '#e8263a', 0, -6.4, 1, 1);
      rect(ctx, '#3ab0ff', -2.2, -6, 1, 1);
      rect(ctx, '#3ab0ff', 2.6, -6, 1, 1);
      break;
    case 'party':
      poly(ctx, '#7a1446', [-3.2, -3.6, 4.2, -3.6, 0.4, -13.8]);
      poly(ctx, '#ff4fa3', [-2.4, -4.2, 3.4, -4.2, 0.4, -12.6]);
      rect(ctx, '#ffe14d', -1.4, -7, 3.6, 1);
      rect(ctx, '#4bd0ff', -0.4, -10, 1.6, 1);
      ell(ctx, '#ffe14d', 0.4, -13.6, 1.6, 1.6);
      break;
    case 'viking':
      poly(ctx, '#e9e1cc', [-3.4, -4.6, -7.6, -10.5, -6.6, -5.2]);
      poly(ctx, '#e9e1cc', [4.4, -4.6, 8.6, -10.5, 7.6, -5.2]);
      ctx.fillStyle = '#5d6670';
      ctx.beginPath();
      ctx.ellipse(0.5, -3.6, 5.2, 4, 0, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath();
      ctx.ellipse(0.5, -3.6, 4.3, 3.2, 0, Math.PI, TAU);
      ctx.fill();
      rect(ctx, '#6b4b2a', -4.6, -4.2, 10.2, 1.4);
      rect(ctx, '#c9cfd6', -1, -6.4, 1, 1);
      break;
    case 'knight':
      ell(ctx, '#3d4249', 0.5, -0.4, 6.2, 5.4);
      ell(ctx, '#a7adb5', 0.5, -0.4, 5.3, 4.6);
      rect(ctx, '#c9cfd6', -2.5, -4, 4, 1);
      rect(ctx, '#15181c', -0.2, -2.1, 6, 1.4);
      rect(ctx, '#15181c', 2.6, 1, 1, 1);
      rect(ctx, '#15181c', 4.2, 1, 1, 1);
      ell(ctx, '#7a1414', -2.4, -6.8, 4.2, 2, -0.5);
      ell(ctx, '#d63b3b', -2.4, -7.2, 3.5, 1.5, -0.5);
      break;
    case 'wizard':
      ell(ctx, '#24124a', 0.5, -4.4, 7, 1.8);
      poly(ctx, '#24124a', [-3.6, -4.4, 4.6, -4.4, 2, -10.5, -4.2, -15, -1, -9.5]);
      poly(ctx, '#5a32b0', [-2.8, -4.9, 3.8, -4.9, 1.4, -10, -3.6, -13.8, -0.6, -9.2]);
      ell(ctx, '#5a32b0', 0.5, -4.5, 6, 1.2);
      rect(ctx, '#ffe14d', 0.5, -8, 1, 1);
      rect(ctx, '#ffe14d', -1.6, -11, 1, 1);
      rect(ctx, '#ffe14d', 2.2, -6, 1, 1);
      break;
    case 'jester': {
      const sway = Math.sin(time * 0.1) * 0.8;
      poly(ctx, '#d33b3b', [-3.5, -3.6, 1, -4, -6.8 + sway, -11]);
      poly(ctx, '#2fae54', [0, -4, 5, -3.6, 8 + sway, -11]);
      rect(ctx, '#f2c14e', -4, -4.6, 9.5, 1.4);
      ell(ctx, '#ffe14d', -6.8 + sway, -11, 1.4, 1.4);
      ell(ctx, '#ffe14d', 8 + sway, -11, 1.4, 1.4);
      break;
    }
    case 'plague':
      poly(ctx, '#7a6a50', [3.4, -2, 12, 1.4, 3.4, 2.4]);
      poly(ctx, '#e9e0c8', [3.8, -1.4, 11, 1.3, 3.8, 1.6]);
      rect(ctx, '#171717', -5.2, -5.2, 11.4, 1.5);
      rect(ctx, '#262626', -3, -9.6, 7, 4.6);
      ctx.strokeStyle = '#3a2e1e';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0.8, -1.3, 2.8, 0, TAU);
      ctx.stroke();
      break;
    case 'vr':
      rect(ctx, '#111114', -4.8, -2.6, 4.4, 1.3);
      rect(ctx, '#2b2b33', -0.8, -3.6, 7.2, 4.2);
      rect(ctx, '#45455a', -0.4, -3.2, 6.4, 1);
      rect(ctx, '#4bf6ff', 6, -3.4, 1, 3.8);
      if ((time >> 4) % 2) rect(ctx, '#ff4b6b', 0.4, -0.2, 1, 1);
      break;
    case 'laser': {
      ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(time * 0.3));
      ell(ctx, '#ff2a2a', 0.8, -1.3, 1.5, 1.5);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ff3a3a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(1.6, -1.3);
      ctx.lineTo(22, -1.3 + Math.sin(time * 0.7) * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'galaxy': {
      ctx.globalAlpha = 0.35;
      ell(ctx, '#ff8ad8', 0, -7, 6, 4.5);
      ctx.globalAlpha = 1;
      ell(ctx, '#c040a0', 0, -6.6, 4.4, 3.2);
      ell(ctx, '#ff9ae0', 0, -6.9, 3.8, 2.7);
      ctx.strokeStyle = '#c040a0';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-2.4, -7);
      ctx.quadraticCurveTo(-1, -9, 0, -7);
      ctx.quadraticCurveTo(1, -5, 2.4, -7);
      ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const a = time * 0.08 + (k * TAU) / 3;
        rect(ctx, '#bff4ff', Math.cos(a) * 6.5, -7 + Math.sin(a) * 3.5, 1, 1);
      }
      break;
    }
    case 'antenna':
      rect(ctx, '#444', 0.2, -11, 0.9, 7.5);
      ell(ctx, (time >> 5) % 2 ? '#ff4b6b' : '#7dff7d', 0.6, -11.6, 1.5, 1.5);
      break;
    case 'propeller': {
      ctx.fillStyle = '#c23b3b';
      ctx.beginPath();
      ctx.ellipse(0.5, -3.6, 4.6, 2.8, 0, Math.PI, TAU);
      ctx.fill();
      rect(ctx, '#3d7fe0', -1.2, -6, 3.4, 2.4);
      rect(ctx, '#666', 0.2, -8, 0.8, 2);
      const w = Math.abs(Math.cos(time * 0.6)) * 5 + 0.5;
      rect(ctx, '#ffe14d', 0.6 - w, -8.4, w * 2, 1);
      break;
    }
    case 'cowboy':
      ell(ctx, '#3a2210', 0.5, -4.4, 8.2, 2);
      ell(ctx, '#7a4a22', 0.5, -4.6, 7.4, 1.4);
      poly(ctx, '#8a5a2a', [-2.6, -4.6, 3.6, -4.6, 3.8, -9, 2, -10, 0.5, -8.8, -1, -10, -2.8, -9]);
      rect(ctx, '#3a2210', -2.6, -5.8, 6.4, 1);
      break;
    case 'shades':
      rect(ctx, '#0a0a0a', -1.2, -2.8, 6.8, 2.6);
      rect(ctx, '#0a0a0a', -4.4, -2.2, 3.4, 0.9);
      rect(ctx, '#6a6a6a', 0, -2.4, 1.2, 0.8);
      break;
    case 'straw':
      ell(ctx, '#9a7a30', 0.5, -4.3, 7.8, 1.8);
      ell(ctx, '#e8c66a', 0.5, -4.5, 7, 1.3);
      ell(ctx, '#d9b14f', 0.5, -6, 3.8, 2.2);
      rect(ctx, '#c0392b', -3.2, -5.4, 7.4, 1);
      break;
    case 'flower':
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 + 0.3;
        ell(ctx, '#ff4f7a', -2.2 + Math.cos(a) * 1.7, -4.6 + Math.sin(a) * 1.7, 1.4, 1.4);
      }
      ell(ctx, '#ffe14d', -2.2, -4.6, 0.9, 0.9);
      break;
    case 'headset':
      ctx.strokeStyle = '#1d1d22';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, -0.5, 5.4, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ell(ctx, '#2d2d35', -2.4, -0.2, 2, 2.4);
      rect(ctx, '#4bf6ff', -3.2, -0.4, 1, 1);
      ctx.beginPath();
      ctx.moveTo(-2, 1.4);
      ctx.quadraticCurveTo(1, 4, 4, 2.6);
      ctx.stroke();
      ell(ctx, '#111', 4.2, 2.6, 0.9, 0.9);
      break;
    default:
      break;
  }
}

/** The "deal with it" pixel shades that descend onto a snake after a kill. */
export function drawDealWithIt(ctx: Ctx, t: number): void {
  const drop = Math.max(0, 1 - t / 30);
  const dy = -12 * drop * drop;
  rect(ctx, '#000000', -2.2, -3 + dy, 9, 1);
  rect(ctx, '#000000', -1.6, -2 + dy, 3, 2);
  rect(ctx, '#000000', 2.6, -2 + dy, 3, 2);
  rect(ctx, '#ffffff', -1.1, -2 + dy, 1, 1);
  rect(ctx, '#ffffff', 3.1, -2 + dy, 1, 1);
}
