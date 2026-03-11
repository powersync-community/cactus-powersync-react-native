# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

#### Models screen (`src/config/models.js` + `App.js`)
- New **Models** tab as the default landing screen in `DemoShell`
- Static curated catalog of 21 Cactus models sourced from [huggingface.co/Cactus-Compute](https://huggingface.co/Cactus-Compute), split into three arrays:
  - `LLM_MODELS` — 12 chat/completion models (Gemma 3, LFM2, Qwen3, FunctionGemma, LFM2.5)
  - `EMBEDDING_MODELS` — 2 dedicated embedding models (Qwen3 Embedding, Nomic Embed v2 MoE)
  - `STT_MODELS` — 7 speech-to-text models (Whisper tiny/base/small/medium, Moonshine, Parakeet CTC)
- Model browser with **LLM / Embedding / Speech** tabs
- Per-model download cards with progress bar (% complete)
- **Download locking** — while any model is downloading, all other download buttons are greyed out to prevent concurrent downloads
- Select button becomes a checkmark (`✓ Selected`) once a model is downloaded and chosen
- `DEFAULT_LLM_MODEL = 'Qwen3-0.6B'` and `DEFAULT_STT_MODEL = 'whisper-small'` exported constants
- Model slugs match HuggingFace repo names exactly (e.g. `Qwen3-0.6B`, `LFM2-350M`) for correct Cactus SDK resolution

#### Model preference persistence (`src/config/credentials.js`)
- `loadModelPrefs()` — reads `model-preferences.json` from device document directory
- `saveModelPrefs({ llmModel, sttModel })` — persists selected model slugs across app restarts
- Selected LLM and STT models are restored on launch via `DemoShell` `useEffect`

#### Chat screen with PowerSync persistence (`App.js` + `src/powersync/schema.js`)
- `HomeScreen` rewritten as a full chat UI replacing the single-shot text completion widget
- Chat bubbles: user messages right-aligned (indigo), assistant messages left-aligned (light grey)
- Live streaming preview — partial completions appear as an assistant bubble while generating
- **All messages saved to PowerSync** (`demo_chat_messages` table) — user message inserted before calling `complete()`, assistant response inserted after generation finishes
- Full conversation history passed to `cactusLM.complete()` on each turn for multi-turn context
- **New Chat** button resets the session ID, starting a fresh conversation
- Auto-scroll to latest message as messages arrive or stream in
- New `demo_chat_messages` table in `AppSchema`:
  - Columns: `created_at`, `session_id`, `role`, `content`, `model`, `total_tokens`, `total_time_ms`
  - Index on `(session_id, created_at)` for efficient per-session queries

#### Settings screen & offline skip flow (`App.js`)
- `SettingsScreen` component with clearly labeled fields:
  - Supabase URL, Supabase Anon Key, PowerSync URL (required for sync)
  - Cactus API Key (optional)
- **Skip — use offline mode** button always visible — app is fully usable without Supabase credentials for local-only on-device inference (chat, RAG, transcription)
- **Save & Connect** button validates and persists credentials, then reinitializes the PowerSync system
- **Clear saved credentials** button resets all fields and removes the persisted file
- `skippedSettings` state in `App` prevents the settings gate from blocking users who skip
- When offline mode is active, `DemoShell` still wraps in `PowerSyncContext` so all PowerSync local DB writes work without a Supabase connection

#### Devtools SQLite browser (`devtools/server.mjs`)
- Fixed database discovery — now uses `xcrun simctl list devices booted --json` to get the booted simulator UUID, then `xcrun simctl get_app_container {UUID} {bundleId} data` to resolve the app container path directly (bypasses macOS directory listing permission issues with `~/Library/Developer/CoreSimulator/Devices`)
- Corrected bundle ID from `com.anonymous.cactusdemo` to `com.powersync.cactusapp`
- Searches `Library/`, `Documents/`, and `Documents/databases/` inside the container (op-sqlite stores the DB in `Library/`, not `Documents/`)
- Supports multiple DB filenames: `['cactus-powersync-demo.db', 'cactus.db']` — whichever exists is used
- Added `/api/debug` endpoint to expose raw `simctl` output, `mdfind` results, resolved path, and any errors — useful for diagnosing DB discovery issues
- Falls back to `mdfind` (Spotlight) if `simctl` strategy fails

### Changed

- `HomeScreen` now accepts `lmModel` prop (slug string) from `DemoShell` instead of calling `useCactusLM()` with no argument — model is chosen on the Models screen
- `RagScreen` now accepts `lmModel` prop — previously hardcoded `'qwen3-0.6b'` (wrong casing); now uses the selected model slug
- `TranscriptionScreen` now accepts `sttModel` prop — previously hardcoded `'whisper-small'`
- All three feature screens show a **"Model not downloaded"** banner instead of an inline download button when the selected model is not ready, directing users to the Models tab
- `DemoShell` starts on the `models` screen instead of `home`
- App render logic: `DemoShell` is shown when `!credentialsReady` (offline/skipped mode) **or** when a Supabase session exists — `AuthScreen` only appears when credentials are configured but no session is active

#### TypeScript support (`tsconfig.json`, `package.json`)
- Added `tsconfig.json` for TypeScript support
- Added `typescript` and `@types/react` dev dependencies
- Migrated `src/utils/embeddings.js` → `embeddings.ts` and `src/utils/fileParser.js` → `fileParser.ts`

#### README rewrite
- Removed "known issues" disclaimer (RAG and attachment uploads now work)
- Added clear **Prerequisites** section (Node 18+, pnpm, Xcode/Android Studio)
- Documented offline-first setup: the app builds and runs without any `.env.local` credentials
- Added step-by-step iOS simulator and Android emulator build instructions
- Clarified that Expo Go is not supported (native modules require a dev build)
- Documented `pnpm start` for subsequent runs after initial `pnpm ios`/`pnpm android`

### Changed

#### `DemoSystem` (`src/powersync/system.js`)
- Constructor no longer requires Supabase credentials at startup — `client`, `connector`, and `remoteStorage` start as `null` and are populated by `_applyEnv()`
- `_applyEnv(env)` — new method that (re)creates credential-dependent objects; returns `false` silently if env is missing credentials
- `hasCredentials` getter — `true` when a Supabase client has been configured
- `_initInternal()` — PowerSync sync connection and attachment queue startup are now conditional on `connector?.powersyncUrl` being set, so `init()` is safe to call in offline mode
- `reconfigure(env)` — new method to tear down existing sync state, apply new credentials, and reinitialize; called when user saves new credentials in Settings
- `reconnect()` — now guards against reconnecting when `connector` is null

#### `createSupabaseClient` (`src/supabase/SupabaseRestClient.js`)
- Returns `null` instead of throwing when `supabaseUrl` or `supabaseAnonKey` are missing — allows the system to initialize without credentials

### Fixed

- Skip button not appearing on Settings screen — previously `onSkip` was conditionally `null`, so `{onSkip ? ... : null}` never rendered it
- After skipping credentials, app fell through to `AuthScreen` — fixed by inverting the render condition so `DemoShell` is shown in credential-less mode
- Devtools `DB not found yet` error — three root causes resolved: wrong bundle ID, `find` command failing silently on simulator directory, and DB being in `Library/` not `Documents/`
