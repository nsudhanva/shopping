# Shopping

Fast, shared shopping lists built with Bun + TypeScript + Firebase + daisyUI.

## Features

- Shared lists with items (public read, Google-auth write)
- Add, edit, check/uncheck, delete items
- Inline quantity per item (decimal, defaults to 1) with +/- controls
- Optional unit per item (e.g., kg, lb)
- Check all / Uncheck all / Clear checked / Clear all
- Rename lists (header + sidebar)
- Delete lists with choice to delete items or move them to Inbox
- Reorder lists and items
- Created/edited-by metadata for lists and items
- Dark mode default with light mode toggle
- Mobile hamburger drawer for Lists (CSS-only)
- Remembers the last selected list across tab closes
- Responsive layout with left nav

## Tech

- Bun + Vanilla TypeScript
- Tailwind CSS v4 + daisyUI v5 for styling
- Firebase Hosting + Firestore (Native mode)
- Firebase Auth (Google)

## Setup

```bash
bun install
bun run build
bun run serve
```

Open `http://localhost:3000`

### Dev Loop

```bash
bun run dev
```

## Firebase

```bash
bunx firebase-tools login
bunx firebase-tools use sudhanva-personal
bunx firebase-tools deploy
```

Enable Google provider in Firebase Auth Console and add your domains to authorized domains.

## Firestore Rules

Rules live in `firestore.rules`. Reads are public, writes require auth and strict schema.

## Cloudflare DNS (Optional)

- CNAME `shopping.sudhanva.me` → `sudhanva-shopping-app.web.app`
- Add the TXT record for domain verification

## GitHub Actions Deploy

On push to `main`, the workflow deploys to Firebase Hosting.

Required secret: `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL`
