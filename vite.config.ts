import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

interface CatalogFileSummary {
  filename: string;
  count: number;
  titles: string[];
}

interface CatalogManifest {
  version: number;
  generatedAt: string;
  totalFiles: number;
  totalExercises: number;
  files: CatalogFileSummary[];
}

function buildStandardCatalogAssets(): {
  manifest: CatalogManifest;
  filesByName: Map<string, string>;
} {
  const catalogDir = path.resolve(__dirname, 'docs/ai_import');
  const filesByName = new Map<string, string>();
  const files: CatalogFileSummary[] = [];
  let totalExercises = 0;

  if (fs.existsSync(catalogDir)) {
    const jsonFiles = fs
      .readdirSync(catalogDir)
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of jsonFiles) {
      const fullPath = path.join(catalogDir, filename);
      const rawContent = fs.readFileSync(fullPath, 'utf8');
      const parsed: unknown = JSON.parse(rawContent);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const titles: string[] = [];
      for (const entry of items) {
        if (entry && typeof entry === 'object' && 'title' in entry) {
          const rawTitle = (entry as { title?: unknown }).title;
          if (typeof rawTitle === 'string' && rawTitle.trim()) {
            titles.push(rawTitle.trim());
          }
        }
      }

      filesByName.set(filename, JSON.stringify(parsed));
      files.push({ filename, count: items.length, titles });
      totalExercises += items.length;
    }
  }

  return {
    manifest: {
      version: 1,
      generatedAt: new Date().toISOString(),
      totalFiles: files.length,
      totalExercises,
      files
    },
    filesByName
  };
}

function standardExerciseCatalogPlugin(basePath: string): Plugin {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const catalogPrefix = `${normalizedBase}catalog/`;

  return {
    name: 'standard-exercise-catalog',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.url) {
          next();
          return;
        }
        const pathname = req.url.split('?')[0];
        if (!pathname.startsWith(catalogPrefix)) {
          next();
          return;
        }

        const requestedFile = decodeURIComponent(pathname.slice(catalogPrefix.length));
        if (
          !requestedFile ||
          requestedFile.includes('/') ||
          requestedFile.includes('\\') ||
          requestedFile.includes('..')
        ) {
          next();
          return;
        }

        const { manifest, filesByName } = buildStandardCatalogAssets();
        const body =
          requestedFile === 'manifest.json'
            ? JSON.stringify(manifest)
            : filesByName.get(requestedFile);

        if (!body) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
    generateBundle() {
      const { manifest, filesByName } = buildStandardCatalogAssets();
      this.emitFile({
        type: 'asset',
        fileName: 'catalog/manifest.json',
        source: JSON.stringify(manifest)
      });
      for (const [filename, content] of filesByName.entries()) {
        this.emitFile({
          type: 'asset',
          fileName: `catalog/${filename}`,
          source: content
        });
      }
    }
  };
}

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const basePath = isGitHubPages ? '/htm/' : '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    standardExerciseCatalogPlugin(basePath),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Handball Trainings- & Planungs-App',
        short_name: 'HB Training Planer',
        description: 'Offline-fähige Handball Trainings-, Übungs- und Mehrwochenplanung für Vereine & Trainerteams',
        theme_color: '#1e3a8a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: basePath,
        scope: basePath,
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        globIgnores: ['catalog/**']
      }
    })
  ]
});
