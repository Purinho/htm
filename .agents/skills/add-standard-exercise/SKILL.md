---
name: add-standard-exercise
description: >-
  Token-efficient workflow for adding new standard handball exercises to
  docs/ai_import/*.json in this repository. Use when the user asks to add,
  adapt, or update a standard catalog exercise.
---

# Add Standard Exercise (Token-Efficient Workflow)

Add standard exercises with minimal file reads and zero unnecessary build/test overhead.

## Procedure

1. **Check for duplicates without reading full files:**
   - Search existing titles in `docs/ai_import/*.json` (e.g., `Select-String -Path "docs/ai_import/*.json" -Pattern '"title"'`).
   - Titles must be unique across the entire catalog (case- and whitespace-insensitive).

2. **Pick the target JSON file in `docs/ai_import/`:**
   - Prefer the primary technique/tactic file (`focus_*.json`, e.g., `focus_dribbling.json`, `focus_passing.json`, `focus_feint_1v1.json`) or phase file (`phase_warmup.json`, `phase_small_game.json`, etc.) when no specific `focus_*` file fits.
   - Do **not** edit `src/db/seedData.ts` (demo club only) or `src/utils/standardCatalogUtils.test.ts` (uses dynamic count checks).

3. **Append with minimal context:**
   - Read only the last ~15 lines of the chosen `docs/ai_import/<file>.json` (to match closing indentation).
   - Insert the new exercise object directly before the final `]` using 2-space JSON indentation.

4. **Verify with the single catalog test only:**
   - Run: `npx vitest run src/utils/standardCatalogUtils.test.ts`
   - Do **not** run `npm run build` or the full `npm run test:run` suite when only `docs/ai_import/*.json` changed (`npm run dev` serves `docs/ai_import/` live, and CI builds on push).

## Schema & Validation Rules (Must Pass on First Try)

- **Required/standard fields:** `title`, `default_duration_min`, `min_players`, `max_players`, `goalkeepers` (integer `>= 0`), `source_url` (optional valid HTTP/HTTPS URL), `categories` (`phases`, `focus`, `level`, `age_groups`), `materials` (`type`, `quantity`), `setup_description`, `flow_description`, `coaching_points`, `variations_text`, `tactic_board_data`.
- **Allowed `phases`:** `WARMUP`, `SMALL_GAME`, `GOALKEEPER_WARMUP`, `GROUND_EXERCISE`, `GROUND_GAME`, `TARGET_GAME`, `ATHLETICS_COORDINATION`, `COOL_DOWN`.
- **Allowed `focus`:** `OFFENSE_INDIVIDUAL`, `OFFENSE_GROUP`, `OFFENSE_TEAM`, `DEFENSE_INDIVIDUAL`, `DEFENSE_GROUP`, `DEFENSE_6_0`, `DEFENSE_5_1`, `DEFENSE_3_2_1`, `FAST_BREAK_1ST_WAVE`, `FAST_BREAK_2ND_WAVE`, `RETREAT`, `SHOOTING`, `PASSING_CATCHING`, `GOALKEEPER_TECHNIQUE`, `DRIBBLING`, `PASSING`, `CATCHING`, `JUMP_SHOT`, `STANDING_THROW`, `HIP_UNDERARM_SHOT`, `FALLING_SHOT`, `LOB_SPIN_SHOT`, `FEINT_1V1`, `CROSSING_SCREEN`, `FOOTWORK_DEFENSE`, `ATHLETICS_CONDITIONING`, `REGENERATION_MOBILITY`.
- **Allowed `level`:** `BASIC` | `ADVANCED` | `PERFORMANCE`.
- **Allowed `age_groups` (at least 1):** `MINIS`, `F_YOUTH`, `E_YOUTH`, `D_YOUTH`, `C_YOUTH`, `B_YOUTH`, `A_YOUTH`, `ADULTS`.
- **Allowed `materials.type`:** `BALL`, `BALL_CART`, `CONE`, `BIBS`, `COORDINATION_LADDER`, `SOFT_MAT`, `POLE_AIRBODY`, `VAULTING_BOX`, `TARGET_CORNER`, `MINI_GOAL`.

### Domain & Tactic Board Invariants (Enforced by Test)

- `GOALKEEPER_WARMUP`: must have `goalkeepers >= 1` and must **not** include `WARMUP`.
- `COOL_DOWN`: must include `REGENERATION_MOBILITY` in `focus` and must **not** include `FAST_BREAK_1ST_WAVE`, `GOALKEEPER_TECHNIQUE`, `OFFENSE_TEAM`, or `RETREAT`.
- `DEFENSE_6_0` or `DEFENSE_5_1`: must **not** target `MINIS`, `F_YOUTH`, `E_YOUTH`, or `D_YOUTH`.
- `tactic_board_data`:
  - `courtTemplate`: `HALF_COURT_VERTICAL` | `FULL_COURT` | `GOAL_SECTOR_ZOOM` | `FREE_SPACE`.
  - **Never** include `keyframes` (no auto-animation in catalog).
  - All `nodes` must have `x` and `y` in `[0.04, 0.96]`.
  - Allowed `nodes.type`: `OFFENSE_PLAYER`, `DEFENSE_PLAYER`, `GOALKEEPER`, `COACH_FEEDER`, `EQUIPMENT_CONE`, `EQUIPMENT_MAT`, `EQUIPMENT_GOAL_TARGET`, `WAYPOINT`.
  - Non-`WAYPOINT` nodes must be spaced at Euclidean distance `>= 0.035`.
  - `goalkeepers === 0` -> 0 `GOALKEEPER` nodes; `goalkeepers >= 1` -> at least 1 `GOALKEEPER` node (for `FULL_COURT` with `goalkeepers === 2`: at least 2 `GOALKEEPER` nodes at `x <= 0.18` or `x >= 0.82`).
  - `HALF_COURT_VERTICAL`: keep `OFFENSE_PLAYER` / `DEFENSE_PLAYER` outside the 6m crease (`((x - 0.5) / 0.24)^2 + ((y - 0.043) / 0.2)^2 >= 0.72` when `y >= 0.043`).
  - Allowed `paths.type`: `RUN_PATH`, `PASS_PATH`, `DRIBBLE_PATH`, `SHOT_PATH`, `SCREEN_BLOCK_PATH`, `FEINT_PATH` (`points.length >= 2`, `fromNodeId`/`fromWaypointId` and `toNodeId`/`toWaypointId` must reference existing nodes within distance `<= 0.06` of start/end point).
  - Optional `zones`: `shape` (`RECT` | `ELLIPSE`), `x`, `y`, `width`, `height`, `color`, `opacity`, `label` (set `"version": 2` when using `zones` or `controlPoint`).
