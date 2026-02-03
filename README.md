# shopping
Fast, shared shopping lists built with Bun + TypeScript + Firebase (PicoCSS).

## Features
- Shared lists (groups) with items
- Public read, Google-auth write
- Delete lists with choice to delete items or move them to Inbox
- Responsive layout with left nav

## Tech
- Bun + Vanilla TypeScript
- PicoCSS for styling
- Firebase Hosting + Firestore (Native mode)
- Firebase Auth (Google)

## Setup
1. Install dependencies.

```bash
bun install
```

2. Build the app.

```bash
bun run build
```

3. Run locally.

```bash
bun run serve
```

## Firebase
1. Install Firebase CLI.

```bash
bunx firebase-tools --version
```

2. Login and select project.

```bash
bunx firebase-tools login
bunx firebase-tools use sudhanva-personal
```

3. Create Hosting site (if not created yet).

```bash
bunx firebase-tools hosting:sites:create shopping
```

4. Enable Google provider in Firebase Auth Console.

5. Deploy rules and hosting.

```bash
bunx firebase-tools deploy
```

## Firestore Rules
Rules live in `firestore.rules`. Reads are public. Writes require auth and a strict schema.

## Cloudflare DNS
This repo includes a script to upsert the CNAME record for your Firebase Hosting site. Use environment variables only.

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ZONE_ID=...
export CLOUDFLARE_RECORD_NAME=shopping.sudhanva.me
export CLOUDFLARE_RECORD_TARGET=YOUR_FIREBASE_HOSTING_TARGET
export CLOUDFLARE_PROXIED=false

bun run dns:cloudflare
```

## GitHub Actions Deploy
On push to `main`, the workflow deploys to Firebase Hosting.

Required repo secrets:
- `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL` (JSON service account)

