# Live Collaborative Workspace & Code Pad

## Overview

A focused, real-time coding workspace for small teams. Create a room, share its ID, and edit the same Monaco document together. It runs entirely on a local Node.js server—no database, Docker, or cloud account is required.

## Features

- Real-time collaborative Monaco editor with remote cursors
- Multi-user rooms with optional server-validated passcodes
- Presence, typing indicators, activity feed, connection state, and copyable room IDs
- Automatic host reassignment to the oldest active participant
- Reconnection without duplicate presence entries
- Server-side document, cursor, and typing-event rate limits
- Local JSON persistence across backend restarts
- Responsive dark developer-tool interface

## Tech stack

- **React + Vite**: responsive browser UI and development workflow.
- **Monaco Editor**: code-editing experience.
- **Socket.IO**: low-latency bidirectional collaboration and reconnect support.
- **Express**: health endpoint and server foundation.
- **TypeScript**: safer client/server contracts.
- **Local JSON store**: zero-setup persistence for local development.

## Architecture

```text
Browser → React + Monaco → Socket.IO → Node/Express → Room manager → Local JSON persistence
```

The Socket.IO handlers work only with a room/document storage boundary. A PostgreSQL adapter can be introduced later without rewriting the collaboration logic.

## Project structure

```text
client/src/App.tsx       UI, editor, reconnect and cursor behavior
client/src/index.css     responsive visual design
server/src/app.ts        Socket.IO room, validation, rate-limit logic
server/src/storage.ts    atomic local JSON persistence adapter
server/src/index.ts      production/server startup entry point
server/test/             Socket.IO integration tests
```

## Installation and local run

Requires Node.js 20+.

```bash
git clone <your-repository-url>
cd collaborative-workspace
npm install
npm run dev
```

Open `http://localhost:5173`. The health endpoint is `http://localhost:3001/health`.

## Environment

Nothing is required. Optionally copy `.env.example` to `.env` and change:

```env
PORT=3001
CLIENT_URL="http://localhost:5173"
# LOCAL_DATA_FILE="./data/workspace.json"
```

Never commit `.env`. Local state is automatically written to the Git-ignored `server/data/workspace.json`.

## Testing

```bash
npm run check
npm run test --workspace @collaborative-workspace/server
```

For a manual demo, open three browser windows (or an ordinary and two incognito windows):

1. A creates a room; B and C join with the room ID.
2. Edit from A, then B; confirm the other windows receive the updates and cursors.
3. Confirm typing, activity, and participant panels update.
4. Close A; B becomes host. Reopen A and join again.
5. Restart the server and join the room again to verify the document remains.

## Architecture decisions

- **WebSockets/Socket.IO** deliver edits and presence immediately, while Socket.IO reconnects after temporary network loss.
- **Rooms** are Socket.IO rooms keyed by a validated room ID; the server authorizes every room action.
- **Document synchronization** sends Monaco edit ranges and monotonically increasing versions. A stale client receives a full resync.
- **Cursors and typing** are ephemeral events: throttled/debounced and never persisted.
- **Host reassignment** is server-controlled: when the host leaves, the oldest remaining active participant becomes host.
- **Persistence** serializes writes and atomically renames a temporary JSON file, avoiding partial writes. Invalid data is preserved with a `.corrupt-*` suffix and replaced with an empty store.

## Security

Passcodes are salted and hashed with `scrypt`; plaintext passcodes are never persisted. The server validates room IDs, usernames, document patches, document size, language, membership, event frequency, and message size. The client is never trusted to assign host privileges.

## Known limitations

- JSON persistence is for one local server, not multi-server production.
- Document patches are version-based rather than a full CRDT, so simultaneous conflicting edits can cause a resync.
- There is no user-account authentication; client IDs identify a browser session, not a verified person.

## Future improvements

PostgreSQL/Supabase storage, Redis fan-out, authentication, project files, a collaborative terminal, voice/video, CRDT synchronization, and deployment are natural next steps.

## GitHub submission

```bash
git status
git add collaborative-workspace
git commit -m "Polish collaborative workspace for submission"
git branch -M main
git remote add origin <your-repository-url>
git push -u origin main
```

Check `git status` before committing to ensure `.env`, `node_modules`, `dist`, and `server/data` are absent.
