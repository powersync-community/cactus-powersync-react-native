# Cactus + PowerSync Expo Demo

Disclaimer: much of this code was generated using LLMs, however some basic QA was performed by a human. 

Known issues: RAG and attachment uploads don't currently work, but completions and STT do work.

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

## Setup

1. Ensure `.env.local` contains:
   - `POWERSYNC_URL`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `CACTUS_API_KEY` (optional)

2. Apply Supabase schema:
   - Run [supabase/schema.sql](/Users/kobie/projects/powersync/skunkworks/cactus-app/supabase/schema.sql).

3. Install dependencies:

```bash
pnpm install
```

4. Start Expo:

```bash
pnpm start
```

For native modules (`cactus-react-native`, `@journeyapps/react-native-quick-sqlite`), use a dev build (`expo run:ios` / `expo run:android`) rather than Expo Go.

## Notes

- PowerSync package dependencies are currently linked from local SDK paths in `package.json`.
- Cost values are estimated model numbers for demo visualization only.
- Attachment metadata is tracked in `demo_files`; file blobs are stored in Supabase Storage bucket `files`.
