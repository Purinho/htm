# Handball Training Management (HTM) — Agent Guidelines

Offline-First PWA for managing handball exercises (with interactive SVG tactic board), training sessions, multi-week meso-cycle plans, and live hall mode.

## Tech Stack

- **Frontend:** React 19, TypeScript (`strict`, `noUnusedLocals`, `noUnusedParameters`), Vite 6, Tailwind CSS v4, Lucide Icons
- **Local Persistence:** Dexie.js (IndexedDB) + `syncOutbox` (`src/db/database.ts`)
- **Cloud Sync (optional):** Supabase PostgreSQL + RLS (`src/services/supabaseClient.ts`, `src/services/cloudSyncService.ts`, `supabase/migrations/`)
- **PWA:** `vite-plugin-pwa` (Workbox in `vite.config.ts`; GitHub Pages deploys with `GITHUB_PAGES=true` under `/htm/`)
- **Testing:** Vitest (`src/utils/*.test.ts`)

## Repository Map

- `src/types/domain.ts` — Core TypeScript domain types (`Exercise`, `TacticBoardData`, `TrainingSession`, `Team`, etc.)
- `src/constants/handballLabels.ts` — German UI labels and canonical DHB enum lists (`phases`, `focus`, `age_groups`, `materials`)
- `src/db/database.ts` — Dexie schema and `queueSyncOperation` / `purgePendingOutboxUpserts`
- `src/db/seedData.ts` — Local demo club (`club-sgh-1`) seed data only (never add standard catalog exercises here)
- `src/services/` — Cloud sync, standard catalog import, club reset, Supabase client
- `src/utils/` — Pure business logic and `*.test.ts` unit tests
- `src/components/` — React UI components (`TacticBoardEditor`, `TacticBoardPreview`, `ClubStandardCatalogSection`, etc.)
- `docs/ai_import/*.json` — Standard exercise catalog (served dynamically as `/catalog/manifest.json` and `/catalog/<file>.json` by `vite.config.ts`)
- `supabase/migrations/` — PostgreSQL schema, RLS policies, security hardening, and RPCs

## Commands & Verification

- `npm run dev` — Start Vite dev server (serves `docs/ai_import/` live at `/catalog/*`)
- `npx vitest run <path>` — Run targeted unit tests (prefer for fast, low-overhead checks)
- `npm run test:run` — Run the full Vitest suite
- `npm run build` — Run `tsc -b && vite build` (required after TS/React/Vite changes; **skip** when only `docs/ai_import/*.json` changed, as CI runs `test:run` + `build` on push to `main`)

## Conventions & Invariants

- **Language:** Write all user-facing UI strings, error messages, and handball exercise content in German; keep code identifiers, comments, and test names in English.
- **Formatting (`.editorconfig`):** UTF-8, LF line endings, 2-space indentation, final newline.
- **Offline-First & Demo Mode:** Local writes persist to Dexie first and enqueue sync operations (`queueSyncOperation`) when syncing to Supabase. Local demo clubs (`club-sgh-1` or non-UUID `club_id`, checked via `isLocalDemoClub`) must never trigger cloud sync or bulk catalog imports.
- **Base URL / PWA Paths:** Derive static asset and catalog fetch URLs from `import.meta.env.BASE_URL` (`/` locally, `/htm/` on GitHub Pages) rather than hardcoding root-relative paths.
- **Security:** Sanitize user-provided or imported external URLs with `sanitizeHttpUrl` (`src/utils/securityUtils.ts`); never commit `.env` secrets.
- **Testability:** Keep pure calculations, validation, normalization, and batching helpers in `src/utils/*.ts` with matching `*.test.ts` coverage.

## Standard Exercise Catalog Workflow

When adding, adapting, or validating standard exercises in `docs/ai_import/*.json`, follow the `.agents/skills/add-standard-exercise/SKILL.md` skill (duplicate check via search, minimal file reads, verify only with `npx vitest run src/utils/standardCatalogUtils.test.ts`, no local `npm run build`).
