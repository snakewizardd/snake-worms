// Small procedural sprites: held weapons, weapon-menu icons, and the sheep.
import { TAU } from './util.ts';

type Ctx = CanvasRenderingContext2D;

const r = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number): void => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};
const circ = (ctx: Ctx, c: string, x: number, y: number, rad: number): void => {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, TAU);
  ctx.fill();
};
const ov = (ctx: Ctx, c: string, x: number, y: number, rx: number, ry: number): void => {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
};

export function drawSheep(ctx: Ctx, x: number, y: number, facing: number, time: number, cape = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  if (cape) {
    const flap = Math.sin(time * 0.5) * 1.5;
    ctx.fillStyle = '#d6262e';
    ctx.beginPath();
    ctx.moveTo(-1, -4);
    ctx.lineTo(-10, -3 + flap);
    ctx.lineTo(-9, 1 + flap);
    ctx.lineTo(-1, -1);
    ctx.fill();
  }
  const step = Math.sin(time * 0.6) * 1.2;
  r(ctx, '#222', -4 + step * 0.5, 2, 1.4, 3);
  r(ctx, '#222', 2 - step * 0.5, 2, 1.4, 3);
  circ(ctx, '#9c978d', 0, -0.5, 5.6);
  for (const [dx, dy] of [[-3, -2], [0, -3.4], [3, -2], [-2.5, 1], [2.5, 1], [0, 0]] as Array<[number, number]>) circ(ctx, '#f4f1ea', dx, dy - 0.5, 2.5);
  ov(ctx, '#2a2420', 5, -1.5, 2.6, 2.1);
  r(ctx, '#ffffff', 5.4, -2.6, 1, 1);
  r(ctx, '#2a2420', 3.5, -4, 1.4, 1);
  ctx.restore();
}

/** Weapon held in the snake's mouth, drawn along +x (the aim direction). */
export function drawHeldItem(ctx: Ctx, id: string, time: number): void {
  switch (id) {
    case 'bazooka':
      r(ctx, '#1e2410', 2, -2.5, 15, 5);
      r(ctx, '#6b7d34', 3, -1.5, 13, 3);
      r(ctx, '#9fb055', 3, -1.5, 13, 1);
      r(ctx, '#2b3216', 15, -3, 2, 6);
      r(ctx, '#2b3216', 7, -4, 2, 2);
      break;
    case 'homing':
      r(ctx, '#202428', 2, -2.5, 15, 5);
      r(ctx, '#a9b4bf', 3, -1.5, 13, 3);
      r(ctx, '#e8eef4', 3, -1.5, 13, 1);
      r(ctx, '#d83a3a', 14, -2, 3, 4);
      r(ctx, '#202428', 6, -5, 4, 3);
      r(ctx, (time >> 3) % 2 ? '#ff4b4b' : '#661010', 7, -4.5, 2, 1);
      break;
    case 'venom':
      r(ctx, '#0f2a0a', 2, -2.5, 13, 5);
      r(ctx, '#3fbf2a', 3, -1.5, 11, 3);
      r(ctx, '#b6ff6a', 3, -1.5, 11, 1);
      circ(ctx, '#7dff4a', 16, 0, 2.5);
      break;
    case 'grenade':
      circ(ctx, '#14200f', 6, 0, 3);
      circ(ctx, '#3f6b2a', 6, 0, 2.2);
      r(ctx, '#c9c9c9', 5, -4, 2, 1.5);
      break;
    case 'cluster':
      circ(ctx, '#151515', 6, 0, 3.2);
      circ(ctx, '#4a4a52', 6, 0, 2.4);
      r(ctx, '#ffd24b', 5, -1, 1, 1);
      r(ctx, '#ffd24b', 7, 1, 1, 1);
      r(ctx, '#c9c9c9', 5, -4.2, 2, 1.5);
      break;
    case 'melon':
      ov(ctx, '#0f3a10', 7, 0, 5, 3.8);
      ov(ctx, '#3a9a2a', 7, 0, 4.2, 3);
      r(ctx, '#0f3a10', 4, -0.4, 6, 0.8);
      r(ctx, '#0f3a10', 5, -2, 4, 0.7);
      r(ctx, '#0f3a10', 5, 1.4, 4, 0.7);
      break;
    case 'holyEgg':
      ov(ctx, '#8a6a10', 6.5, 0, 3.6, 4.4);
      ov(ctx, '#ffe27a', 6.5, 0, 2.9, 3.7);
      r(ctx, '#ffffff', 6, -2.4, 1, 4.6);
      r(ctx, '#ffffff', 4.6, -1.2, 3.8, 1);
      if ((time >> 3) % 2) r(ctx, '#ffffff', 9, -4, 1, 1);
      break;
    case 'petrol':
      r(ctx, '#3a2a10', 3, -2.8, 9, 5.6);
      r(ctx, '#c08a3a', 4, -2, 7, 4);
      r(ctx, '#e0d0b0', 12, -1, 3, 2);
      circ(ctx, (time >> 2) % 2 ? '#ffd24b' : '#ff7a2a', 15.5, -1, 1.5);
      break;
    case 'dynamite':
      r(ctx, '#5a0f0f', 3, -2.5, 10, 5);
      r(ctx, '#d6312b', 4, -1.6, 8, 3.2);
      r(ctx, '#ffe9a0', 5, -0.4, 6, 0.8);
      r(ctx, '#3a3a3a', 13, -0.5, 3, 1);
      break;
    case 'mine':
      ov(ctx, '#1a1a1a', 7, 1, 5, 2.6);
      ov(ctx, '#4a4f55', 7, 0.6, 4.2, 1.9);
      r(ctx, '#ff3a3a', 6.5, -1.6, 1, 1);
      break;
    case 'shotgun':
      r(ctx, '#2a1a0e', -1, -1, 7, 3);
      r(ctx, '#8a5a2a', 0, -0.4, 6, 2);
      r(ctx, '#2a2a2e', 5, -2, 13, 3);
      r(ctx, '#6a6a72', 6, -1.4, 11, 1);
      break;
    case 'sheep':
    case 'skySheep':
      drawSheep(ctx, 9, 0, 1, time, id === 'skySheep');
      break;
    case 'airStrike':
    case 'sheepRain':
    case 'piano':
    case 'doomsday':
      r(ctx, '#1a1a1a', 4, -3.5, 7, 7);
      r(ctx, '#3a3a40', 5, -2.5, 5, 5);
      r(ctx, (time >> 3) % 2 ? '#ff4b4b' : '#4bff6b', 6, -1.5, 3, 1.4);
      r(ctx, '#1a1a1a', 9, -8, 1, 5);
      break;
    case 'teleport':
      r(ctx, '#3a2a10', 2, -0.6, 11, 1.4);
      circ(ctx, '#bff4ff', 14, 0, 2);
      if ((time >> 2) % 2) r(ctx, '#ffffff', 15, -3, 1, 1);
      break;
    case 'girder':
      r(ctx, '#4a5260', 2, -2, 16, 4);
      r(ctx, '#8d9aab', 3, -1.2, 14, 2.4);
      r(ctx, '#4a5260', 6, -0.4, 1, 1);
      r(ctx, '#4a5260', 13, -0.4, 1, 1);
      break;
    case 'surrender':
      r(ctx, '#6a5030', 2, -0.5, 14, 1);
      r(ctx, '#ffffff', 12, -8, 8, 7.5 + Math.sin(time * 0.3));
      break;
    default:
      break;
  }
}

/** 18x18 icon for the weapon menu, centered on (cx, cy). */
export function drawWeaponIcon(ctx: Ctx, id: string, cx: number, cy: number, time: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  switch (id) {
    case 'tailWhip':
      ctx.strokeStyle = '#ffd24b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, 6);
      ctx.quadraticCurveTo(0, -10, 7, -2);
      ctx.stroke();
      r(ctx, '#ffffff', 5, -5, 2, 1);
      r(ctx, '#ffffff', 7, -1, 2, 1);
      break;
    case 'jetpack':
      r(ctx, '#2a2a30', -4, -6, 8, 10);
      r(ctx, '#9aa3ad', -3, -5, 6, 8);
      circ(ctx, (time >> 2) % 2 ? '#ffd24b' : '#ff7a2a', 0, 6, 2.5);
      break;
    case 'vine':
      ctx.strokeStyle = '#6fbf3a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, 7);
      ctx.quadraticCurveTo(6, 2, -2, -7);
      ctx.stroke();
      r(ctx, '#8be04a', 1, -1, 3, 2);
      r(ctx, '#8be04a', -4, 3, 3, 2);
      break;
    case 'skip':
      r(ctx, '#ffffff', -6, -5, 3, 10);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-1, -6);
      ctx.lineTo(7, 0);
      ctx.lineTo(-1, 6);
      ctx.fill();
      break;
    default:
      ctx.translate(-9, 0);
      drawHeldItem(ctx, id, time);
  }
  ctx.restore();
}
