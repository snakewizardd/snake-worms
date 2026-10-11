import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { arenaPlugin } from './arena-host/vitePlugin.ts';

// `npm run arena` (mode "arena") adds the live clanker host. Normal dev, build and export never include it.
export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    // In arena mode nothing may hot-reload the page mid-match (it would kill a live, paid match). Restart to pick up edits.
    watch: mode === 'arena' ? { ignored: ['**/*'] } : { ignored: ['**/arena-logs/**', '**/.arena-state/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022' },
  plugins: mode === 'arena' ? [arenaPlugin(fileURLToPath(new URL('.', import.meta.url)))] : [],
}));
