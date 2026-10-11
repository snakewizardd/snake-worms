import type { ThemeDef } from './themes.ts';

export type WeaponId =
  | 'bazooka' | 'homing' | 'venom'
  | 'grenade' | 'cluster' | 'melon' | 'holyEgg' | 'petrol'
  | 'dynamite' | 'mine'
  | 'shotgun' | 'tailWhip'
  | 'sheep' | 'skySheep' | 'sheepRain'
  | 'airStrike' | 'piano' | 'doomsday'
  | 'teleport' | 'girder' | 'jetpack' | 'vine'
  | 'skip' | 'surrender';

/** charge: hold fire for power. target: pick a spot. targetCharge: pick a spot, then charge. instant: fires on press. */
export type Usage = 'charge' | 'instant' | 'target' | 'targetCharge';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  usage: Usage;
  ammo: number;
  delay: number;
  fuse?: boolean;
  maxSpeed?: number;
  /** False for tools that keep your turn going (jetpack, vine). */
  endsTurn: boolean;
  crate: number;
}

export const WEAPON_LIST: WeaponDef[] = [
  { id: 'bazooka', name: 'BAZOOKA', desc: 'CLASSIC ROCKET. THE WIND PUSHES IT. RESPECT THE WIND.', usage: 'charge', ammo: -1, delay: 0, maxSpeed: 12, endsTurn: true, crate: 0 },
  { id: 'homing', name: 'HOMING MISSILE', desc: 'PICK A TARGET, THEN FIRE. IT FINDS ITS WAY. MOSTLY.', usage: 'targetCharge', ammo: 1, delay: 0, maxSpeed: 9, endsTurn: true, crate: 6 },
  { id: 'venom', name: 'VENOM SPIT', desc: 'LOBBED GOO. SMALL BOOM, BIG POISON. -5 HP EVERY TURN.', usage: 'charge', ammo: 2, delay: 0, maxSpeed: 10, endsTurn: true, crate: 6 },
  { id: 'grenade', name: 'GRENADE', desc: 'BOUNCY. NO WIND. PICK A FUSE WITH 1-5.', usage: 'charge', ammo: -1, delay: 0, fuse: true, maxSpeed: 10, endsTurn: true, crate: 0 },
  { id: 'cluster', name: 'CLUSTER BOMB', desc: 'GRENADE THAT SPLITS INTO 5 ANGRY LITTLE BOMBS.', usage: 'charge', ammo: 2, delay: 0, fuse: true, maxSpeed: 10, endsTurn: true, crate: 8 },
  { id: 'melon', name: 'MEGA MELON', desc: 'BURSTS INTO HUGE EXPLODING SLICES. FRUIT IS VIOLENT.', usage: 'charge', ammo: 1, delay: 3, fuse: true, maxSpeed: 9, endsTurn: true, crate: 3 },
  { id: 'holyEgg', name: 'HOLY EGG', desc: 'A CHOIR SINGS. THEN EVERYTHING NEARBY STOPS EXISTING.', usage: 'charge', ammo: 1, delay: 2, maxSpeed: 9, endsTurn: true, crate: 3 },
  { id: 'petrol', name: 'FIRE BOTTLE', desc: 'SMASHES INTO A PUDDLE OF FIRE. CRISPY.', usage: 'charge', ammo: 2, delay: 0, maxSpeed: 10, endsTurn: true, crate: 6 },
  { id: 'dynamite', name: 'DYNAMITE', desc: 'DROP IT AT YOUR FEET. RUN. 5 SECOND FUSE. HUGE.', usage: 'instant', ammo: 1, delay: 0, endsTurn: true, crate: 7 },
  { id: 'mine', name: 'MINE', desc: 'DROP IT. ANYONE WHO WANDERS CLOSE GETS A SURPRISE.', usage: 'instant', ammo: 2, delay: 0, endsTurn: true, crate: 6 },
  { id: 'shotgun', name: 'SHOTGUN', desc: 'TWO STRAIGHT SHOTS PER TURN. NO WIND, NO GRAVITY, NO MERCY.', usage: 'instant', ammo: -1, delay: 0, endsTurn: true, crate: 0 },
  { id: 'tailWhip', name: 'TAIL WHIP', desc: 'POINT BLANK SLAP. GREAT FOR KNOCKING SNAKES INTO THE SEA.', usage: 'instant', ammo: -1, delay: 0, endsTurn: true, crate: 0 },
  { id: 'sheep', name: 'SHEEP', desc: 'A SHEEP RUNS AT THEM. PRESS FIRE TO DETONATE THE SHEEP.', usage: 'instant', ammo: 1, delay: 0, endsTurn: true, crate: 7 },
  { id: 'skySheep', name: 'SKY SHEEP', desc: 'FIRE AGAIN TO TAKE OFF. STEER WITH LEFT/RIGHT. FIRE TO BOOM.', usage: 'instant', ammo: 1, delay: 2, endsTurn: true, crate: 4 },
  { id: 'sheepRain', name: 'SHEEP RAIN', desc: 'IT IS RAINING SHEEP. PICK A SPOT. HALLELUJAH.', usage: 'target', ammo: 1, delay: 3, endsTurn: true, crate: 3 },
  { id: 'airStrike', name: 'AIR STRIKE', desc: 'FIVE MISSILES FROM THE SKY. PICK A SPOT.', usage: 'target', ammo: 1, delay: 2, endsTurn: true, crate: 5 },
  { id: 'piano', name: 'PIANO DROP', desc: 'A GRAND PIANO FALLS THROUGH THE ISLAND. PLAYS A SONG.', usage: 'target', ammo: 1, delay: 2, endsTurn: true, crate: 3 },
  { id: 'doomsday', name: 'DOOMSDAY', desc: 'METEORS RAIN ON EVERYONE FOR 8 SECONDS. INCLUDING YOU.', usage: 'instant', ammo: 1, delay: 6, endsTurn: true, crate: 1 },
  { id: 'teleport', name: 'TELEPORT', desc: 'PICK ANY OPEN SPOT. YOU ARE NOW THERE. ENDS YOUR ATTACK.', usage: 'target', ammo: 2, delay: 0, endsTurn: true, crate: 5 },
  { id: 'girder', name: 'GIRDER', desc: 'PLACE A STEEL BEAM. UP/DOWN TO ROTATE. BRIDGES AND BUNKERS.', usage: 'target', ammo: 2, delay: 0, endsTurn: true, crate: 5 },
  { id: 'jetpack', name: 'JETPACK', desc: 'FLY! UP TO THRUST, LEFT/RIGHT TO STEER. KEEPS YOUR TURN.', usage: 'instant', ammo: 2, delay: 0, endsTurn: false, crate: 5 },
  { id: 'vine', name: 'VINE SWING', desc: 'SHOOT A VINE AT THE AIM. SWING L/R, REEL U/D, SPACE TO LET GO.', usage: 'instant', ammo: 5, delay: 0, endsTurn: false, crate: 5 },
  { id: 'skip', name: 'SKIP TURN', desc: 'DO NOTHING. LET THEM COOK.', usage: 'instant', ammo: -1, delay: 0, endsTurn: true, crate: 0 },
  { id: 'surrender', name: 'RAGE QUIT', desc: 'YOUR WHOLE TEAM GIVES UP. DRAMATICALLY.', usage: 'instant', ammo: -1, delay: 0, endsTurn: true, crate: 0 },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPON_LIST.map((w) => [w.id, w])) as Record<WeaponId, WeaponDef>;

export const MENU_ROWS: Array<[string, WeaponId[]]> = [
  ['ROCKETS', ['bazooka', 'homing', 'venom']],
  ['THROWN', ['grenade', 'cluster', 'melon', 'holyEgg', 'petrol']],
  ['PLACED', ['dynamite', 'mine']],
  ['CLOSE', ['shotgun', 'tailWhip']],
  ['ANIMALS', ['sheep', 'skySheep', 'sheepRain']],
  ['FROM ABOVE', ['airStrike', 'piano', 'doomsday']],
  ['TOOLS', ['teleport', 'girder', 'jetpack', 'vine']],
  ['GIVE UP', ['skip', 'surrender']],
];

export function weaponName(id: WeaponId, theme: ThemeDef): string {
  return theme.weaponNames[id] ?? WEAPON_BY_ID[id].name;
}

export function startingAmmo(): Map<string, number> {
  return new Map(WEAPON_LIST.map((w) => [w.id, w.ammo]));
}
