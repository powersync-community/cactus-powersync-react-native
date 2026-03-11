# Cactus + PowerSync Expo Demo

Disclaimer: much of this code was generated using LLMs, however some basic QA was performed by a human.

Tech demo app for:
- React Native (Expo)
- Supabase Auth + Storage
- Cactus on-device inference (LLM + STT)
- PowerSync React Native SDK
- PowerSync Attachments

## Implemented demo sections

- `Home`: sync status and cumulative cost-savings estimates.
- `Transcription`: on-device STT with run metrics stored in PowerSync.
- `RAG`: local document corpus, on-device embeddings/retrieval, local answer generation.
- `Attachments`: PowerSync attachment queue + Supabase Storage bucket `files`.
- `Offline`: forced offline mode, queued local writes, pending CRUD count.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/installation)
- Xcode (for iOS) or Android Studio (for Android)
- An iOS simulator or Android emulator (no paid Apple Developer account required for simulator builds)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment (optional for local testing)

The RAG and Transcription screens work fully offline without any credentials — the Cactus model runs on-device. Sync, Attachments, and Home stats require a PowerSync + Supabase backend.

Create `.env.local` in the project root to enable cloud sync:

```
POWERSYNC_URL=https://your-instance.powersync.journeyapps.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
CACTUS_API_KEY=your-cactus-key   # optional
```

If `.env.local` is absent the app still builds and runs — sync features will be inactive.

### 3. Apply Supabase schema (only needed for cloud sync)

Run [`supabase/schema.sql`](supabase/schema.sql) against your Supabase project, and create a Storage bucket named `files`.

### 4. Build and run

This app uses native modules (`cactus-react-native`, `op-sqlite`, PowerSync) so it **cannot run in Expo Go**. You must do a native build the first time.

**iOS simulator** (no Apple Developer account needed):

```bash
pnpm ios
# equivalent to: expo run:ios
```

**Android emulator:**

```bash
pnpm android
# equivalent to: expo run:android
```

This generates the `ios/` or `android/` native project, builds it, installs it on your simulator/emulator, and starts Metro — all in one command.

### Subsequent runs

After the first build the app is installed. You can start just the Metro bundler:

```bash
pnpm start
```

Then press `i` to open iOS or `a` to open Android. If you add or change native dependencies, re-run `pnpm ios` / `pnpm android` to rebuild.

## Notes

- Cost values are estimated model numbers for demo visualization only.
- Attachment metadata is tracked in `demo_files`; file blobs are stored in Supabase Storage bucket `files`.
- The on-device LLM model is downloaded at runtime from within the app (see the RAG and Transcription screens).
