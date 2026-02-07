# shopping

Fast, shared shopping lists built with
Bun + TypeScript + Firebase + daisyUI.

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

## Project Structure

- `src/main.ts`: App orchestration, state wiring, auth, and event handlers.
- `src/ui.ts`: DOM rendering and UI event helpers.
- `src/firestore.ts`: Firestore reads/writes, ordering, backfills.
- `src/firebase.ts`: Firebase SDK initialization.
- `src/state.ts`: Mutable app state singleton.
- `src/types.ts`: Shared TypeScript types.
- `src/elements.ts`: Cached DOM element references.
- `src/dom.ts`: DOM utility (querySelector wrapper).
- `src/styles.css`: Tailwind + daisyUI source CSS with custom themes.
- `public/index.html`: Static shell and layout.
- `public/styles.css`: Built CSS output (generated).
- `public/assets/`: Built JS output (generated).
- `firestore.rules`: Firestore security rules.
- `firebase.json`: Firebase Hosting + Firestore config.

## Setup

1. Install dependencies.

```bash
bun install
```

1. Build the app.

```bash
bun run build
```

1. Serve locally.

```bash
bun run serve
```

Open the URL printed by the server (typically `http://localhost:3000`).

### Dev loop

Rebuild and serve:

```bash
bun run dev
```

## Firebase

1. Install Firebase CLI.

```bash
bunx firebase-tools --version
```

1. Login and select project.

```bash
bunx firebase-tools login
bunx firebase-tools use sudhanva-personal
```

1. Create Hosting site (if not created yet).

```bash
bunx firebase-tools hosting:sites:create sudhanva-shopping-app
```

1. Enable Google provider in Firebase Auth Console.
1. Add your domains to Firebase Auth -> Settings -> Authorized domains.

1. Deploy rules and hosting.

```bash
bunx firebase-tools deploy
```

## Firestore Rules

Rules live in `firestore.rules`. Reads are public.
Writes require auth and a strict schema
(including `order` for sorting).

## Cloudflare DNS (Optional)

Point your custom domain to Firebase Hosting:

- CNAME `shopping.sudhanva.me` -> `sudhanva-shopping-app.web.app`
- Add the TXT record Firebase gives you for domain ownership
  verification

Then wait for SSL provisioning to complete.

## GitHub Actions Deploy

On push to `main`, the workflow deploys to Firebase Hosting.

Required repo secrets:

- `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL` (JSON service account)
