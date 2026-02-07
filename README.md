# Shopping

Fast, shared shopping lists with real-time sync.

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000`

## Features

- Real-time shared lists with Google auth
- Inline quantity (+/-) and unit fields
- Bulk actions: check all, uncheck all, clear checked
- Reorder lists and items
- Dark/light mode with responsive mobile UI

## Tech Stack

- **Runtime**: Bun + TypeScript
- **Styling**: Tailwind CSS v4 + daisyUI v5
- **Backend**: Firebase Hosting + Firestore + Auth

## Deploy

```bash
bunx firebase-tools login
bunx firebase-tools deploy
```

Required secret: `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL`
