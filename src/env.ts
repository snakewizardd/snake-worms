import { WATER_Y } from './config.ts';

/** Runtime world state that several modules read (water rises in sudden death). */
export const env = {
  waterY: WATER_Y,
};

export function resetEnv(): void {
  env.waterY = WATER_Y;
}
