// Runs the arena host inside the Vite dev server (`npm run arena`) and bridges it to the browser game
// over Vite's existing localhost websocket. Nothing here exists in the static build.
import type { Plugin, ViteDevServer } from 'vite';
import { ArenaHost } from './host.ts';
import type { MatchInfo } from '../src/arena/link.ts';

interface Pending {
  resolve: (v: unknown) => void;
}

export function arenaPlugin(root: string): Plugin {
  let host: ArenaHost | null = null;
  return {
    name: 'snakes-arena',
    configureServer(server: ViteDevServer) {
      host = new ArenaHost({ root });
      const h = host;
      const pending = new Map<string, Pending>();
      let seq = 0;

      server.ws.on('arena:hello', async (_data, client) => {
        const r = await h.models();
        client.send('arena:hello', { ok: true, ...r });
      });

      server.ws.on('arena:start', async (data: { reqId: string; info: MatchInfo }, client) => {
        try {
          const dir = await h.start(data.info);
          client.send('arena:reply', { reqId: data.reqId, ok: true, dir });
        } catch (e) {
          client.send('arena:reply', { reqId: data.reqId, ok: false, error: String((e as Error).message) });
        }
      });

      server.ws.on('arena:turn', async (data: { reqId: string; matchId: string; team: 0 | 1; prompt: string; timeoutMs: number }, client) => {
        const exec = (name: string, args: Record<string, unknown>): Promise<unknown> =>
          new Promise((resolve) => {
            const callId = `c${++seq}`;
            pending.set(callId, { resolve });
            client.send('arena:tool-call', { matchId: data.matchId, turnReq: data.reqId, callId, name, args });
          });
        try {
          const r = await h.turn(data.matchId, data.team, data.prompt, data.timeoutMs, exec, (a) => client.send('arena:activity', { matchId: data.matchId, activity: a }));
          client.send('arena:reply', { reqId: data.reqId, ok: true, result: r });
        } catch (e) {
          client.send('arena:reply', { reqId: data.reqId, ok: false, error: String((e as Error).message) });
        }
      });

      server.ws.on('arena:tool-result', (data: { callId: string; result: unknown }) => {
        const p = pending.get(data.callId);
        if (!p) return;
        pending.delete(data.callId);
        p.resolve(data.result);
      });

      server.ws.on('arena:log', (data: { matchId: string; entry: Record<string, unknown> }) => {
        h.log(data.matchId, data.entry);
      });

      server.ws.on('arena:abort', (data: { matchId: string; team: 0 | 1 }) => {
        void h.abort(data.matchId, data.team);
      });

      server.ws.on('arena:end', async (data: { reqId: string; matchId: string; summary: Record<string, unknown> }, client) => {
        try {
          const dir = await h.end(data.matchId, data.summary);
          client.send('arena:reply', { reqId: data.reqId, ok: true, dir });
        } catch (e) {
          client.send('arena:reply', { reqId: data.reqId, ok: false, error: String((e as Error).message) });
        }
      });

      // Video chunks arrive as raw POST bodies (too big for the websocket).
      server.middlewares.use('/arena/video', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const matchId = url.searchParams.get('match') ?? '';
        const done = url.searchParams.get('done') === '1';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          try {
            if (chunks.length) h.appendVideo(matchId, Buffer.concat(chunks));
            const msg = done ? await h.finishVideo(matchId) : 'ok';
            res.statusCode = 200;
            res.end(msg);
          } catch (e) {
            res.statusCode = 500;
            res.end(String((e as Error).message));
          }
        });
      });

      server.httpServer?.once('close', () => void h.shutdown());
    },
  };
}
