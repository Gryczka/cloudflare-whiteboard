import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The hosted garden builds from an untracked owner config that carries its
// account and verified legacy inventory. Everyone else uses wrangler.jsonc.
const configPath =
	process.env.GARDEN_PRODUCTION_PREFLIGHT === '1' ? './wrangler.production-preflight.jsonc' : undefined;

export default defineConfig({ plugins: [react(), cloudflare({ configPath })] });
