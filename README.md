# shopping
Fast, shared shopping lists built with Bun + TypeScript + Firebase (PicoCSS).

## Features
- Shared lists with items (public read, Google-auth write)
- Add, edit, check/uncheck, delete items
- Check all / Uncheck all / Clear checked / Clear all
- Rename lists (header + sidebar)
- Delete lists with choice to delete items or move them to Inbox
- Reorder lists and items
- Created/edited-by metadata for lists and items
- Dark mode default with light mode toggle
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

3. Serve locally.

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

2. Login and select project.

```bash
bunx firebase-tools login
bunx firebase-tools use sudhanva-personal
```

3. Create Hosting site (if not created yet).

```bash
bunx firebase-tools hosting:sites:create sudhanva-shopping-app
```

4. Enable Google provider in Firebase Auth Console.
5. Add your domains to Firebase Auth -> Settings -> Authorized domains.

6. Deploy rules and hosting.

```bash
bunx firebase-tools deploy
```

## Firestore Rules
Rules live in `firestore.rules`. Reads are public. Writes require auth and a strict schema (including `order` for sorting).

## Cloudflare DNS (Optional)
Point your custom domain to Firebase Hosting:
- CNAME `shopping.sudhanva.me` -> `sudhanva-shopping-app.web.app`
- Add the TXT record Firebase gives you for domain ownership verification
Then wait for SSL provisioning to complete.

## GitHub Actions Deploy
On push to `main`, the workflow deploys to Firebase Hosting.

Required repo secrets:
- `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL` (JSON service account)
