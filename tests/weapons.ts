// Fires every weapon through the player code path and checks it does its job: `node tests/weapons.ts`.
import { Game } from '../src/game.ts';
import type { Pad } from '../src/input.ts';
import { DEFAULTS } from '../src/settings.ts';
import { THEMES } from '../src/themes.ts';
import { WEAPON_LIST } from '../src/weapons.ts';

const idle: Pad = { isHeld: () => false, pressed: () => false, released: () => false, heldFor: () => 0 };
let failures = 0;

for (const def of WEAPON_LIST) {
  const id = def.id;
  try {
    const g = new Game(idle, { ...DEFAULTS, mode: 'hotseat', hazards: false, crates: false, snakesPerTeam: 2, suddenDeath: 0 }, THEMES.island, 4242);
    for (let i = 0; i < 45; i++) g.update();
    if (g.phase !== 'play') throw new Error(`not in play (phase ${g.phase})`);
    const s = g.active!;
    const e = g.snakes.filter((o) => o.alive && o.team !== s.team).sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0]!;
    g.round = 10;
    if ((s.team.ammo.get(id) ?? 0) >= 0) s.team.ammo.set(id, 5);
    if (!g.selectWeapon(id)) throw new Error('could not select');
    s.facing = e.x >= s.x ? 1 : -1;
    s.aim = -0.5;
    const before = g.terrain.mask.reduce((a, b) => a + b, 0);
    const turn = g.turnCount;
    const hpBefore = g.snakes.reduce((a, o) => a + o.hp, 0);
    let note = '';
    switch (def.usage) {
      case 'charge':
        g.fireCharged(0.7);
        break;
      case 'targetCharge':
        g.tx = e.x;
        g.ty = e.y;
        g.confirmTarget();
        if (!g.targetSet) throw new Error('target not locked');
        g.fireCharged(0.7);
        break;
      case 'target':
        g.tx = e.x;
        g.ty = e.y - 40;
        if (id === 'teleport') {
          g.tx = e.x + 30;
          g.ty = e.y - 60;
          while (!g.terrain.free(g.tx, g.ty, 6) && g.ty > 10) g.ty -= 5;
        }
        g.confirmTarget();
        if (id === 'teleport') note = Math.hypot(s.x - g.tx, s.y - g.ty) < 1 ? 'moved' : 'DID NOT MOVE';
        break;
      case 'instant': {
        if (id === 'vine') {
          let ok = false;
          for (let a = -1.5; a <= 1.5 && !ok; a += 0.1) {
            for (const f of [1, -1] as const) {
              s.aim = a;
              s.facing = f;
              if (g.useWeapon()) {
                ok = true;
                break;
              }
            }
          }
          note = s.state === 'rope' ? 'swinging' : 'NO ROPE';
          s.ropeSwing = 1;
          break;
        }
        if (id === 'tailWhip') {
          e.x = s.x + s.facing * 12;
          e.y = s.y;
        }
        const ok = g.useWeapon();
        if (!ok) throw new Error('useWeapon returned false');
        if (id === 'mine') note = g.props.some((p) => p.kind === 'mine') ? 'mine placed' : 'NO MINE';
        if (id === 'jetpack') note = s.state === 'jet' ? 'flying' : 'NOT FLYING';
        if (id === 'shotgun') {
          if (g.phase !== 'play' || g.shotsLeft !== 1) throw new Error('shotgun should keep the turn for a 2nd shot');
          g.useWeapon();
        }
        break;
      }
    }
    let t = 0;
    while (g.turnCount === turn && (g.phase as string) !== 'over' && t < 4500) {
      if (id === 'jetpack' && s.state === 'jet') s.jetUp = t % 60 < 30;
      g.update();
      t++;
    }
    const after = g.terrain.mask.reduce((a, b) => a + b, 0);
    const hpAfter = g.snakes.reduce((a, o) => a + o.hp, 0);
    const carved = before - after;
    const offensive = !['teleport', 'girder', 'jetpack', 'vine', 'skip', 'surrender', 'mine'].includes(id);
    const problems: string[] = [];
    if (g.turnCount === turn && (g.phase as string) !== 'over') problems.push('turn never ended');
    if (offensive && carved <= 0 && hpAfter >= hpBefore) problems.push('no terrain destroyed and no damage');
    if (id === 'girder' && carved >= 0) problems.push('girder added no terrain');
    if (id === 'surrender' && (g.phase as string) !== 'over') problems.push('surrender did not end match');
    if (note.includes('NOT') || note.includes('NO ') || note.includes('DID NOT')) problems.push(note);
    if (problems.length) {
      failures++;
      console.log(`FAIL ${id.padEnd(10)} ${problems.join('; ')}`);
    } else console.log(`ok   ${id.padEnd(10)} ticks=${String(t).padStart(4)} terrainRemoved=${String(carved).padStart(6)} hpLost=${hpBefore - hpAfter}${note ? ' ' + note : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${id.padEnd(10)} threw: ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}
console.log(failures ? `\n${failures} WEAPON(S) FAILED` : `\nALL ${WEAPON_LIST.length} WEAPONS WORK`);
if (failures) process.exitCode = 1;
