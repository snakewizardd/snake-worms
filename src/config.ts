// Core physics and feel numbers. Match rules live in settings.ts, world skins + teams in themes.ts,
// weapon stats in weapons.ts / projectiles.ts. Tweak any of these while `npm run dev` is running.

export const GAME_TITLE = 'SNAKES';

export const VIEW_W = 640;
export const VIEW_H = 360;
export const WORLD_W = 1920;
export const WORLD_H = 900;
export const WATER_Y = 830;

export const PHYS = {
  gravity: 0.2,
  maxSpeed: 13,
  snakeRadius: 5,
  walkSpeed: 0.6,
  maxClimb: 5,
  jumpVX: 1.7,
  jumpVY: -3.4,
  flipVX: 0.9,
  flipVY: -4.7,
  crouchTicks: 6,
  fallDamageSpeed: 6.2,
  fallDamagePerSpeed: 7,
  tumbleBounce: 0.38,
  tumbleFriction: 0.7,
  windAccel: 0.045,
};

export const AIM = {
  speed: 0.022,
  fastSpeed: 0.045,
  fastAfterTicks: 18,
  chargeTicks: 70,
  crosshairDist: 38,
};

export const DEATH_BLAST = { radius: 22, damage: 15, knock: 4 };

export interface TeamDef {
  name: string;
  color: string;
  dark: string;
  light: string;
  pattern: string;
  voicePitch: number;
  tail: 'rattle' | 'plain';
  snakes: string[];
}