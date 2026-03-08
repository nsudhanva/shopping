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
- Voice commands (add items, check/uncheck, delete, navigate lists)
- Text-to-speech responses and list readout
- Dark mode default with light mode toggle
- Mobile hamburger drawer for Lists (CSS-only)
- Remembers the last selected list across tab closes
- Responsive layout with left nav

## Architecture

### High-Level Overview

```mermaid
graph TB
    subgraph Client["Browser (SPA)"]
        HTML["index.html"]
        CSS["Tailwind CSS v4 + daisyUI v5"]
        TS["TypeScript Modules"]
    end

    subgraph Firebase["Firebase Platform"]
        Hosting["Firebase Hosting"]
        Auth["Firebase Auth (Google)"]
        Firestore["Cloud Firestore"]
        Functions["Cloud Functions (Node 22)"]
    end

    subgraph External["External APIs"]
        Sarvam["Sarvam AI"]
    end

    Client -->|Deployed to| Hosting
    TS -->|Auth state| Auth
    TS -->|Real-time sync| Firestore
    TS -->|Voice commands| Functions
    Functions -->|STT / TTS / Chat| Sarvam

    style Client fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style Firebase fill:#0d1b2a,stroke:#1b263b,color:#e0e0e0
    style External fill:#1b2838,stroke:#2a4858,color:#e0e0e0
```

### Frontend Module Graph

```mermaid
graph LR
    main["main.ts<br/><i>Entry point, event wiring,<br/>voice pipeline</i>"]
    ui["ui.ts<br/><i>DOM rendering for<br/>lists and items</i>"]
    elements["elements.ts<br/><i>Cached DOM element<br/>references</i>"]
    firestore["firestore.ts<br/><i>Firestore CRUD +<br/>real-time subscriptions</i>"]
    firebase["firebase.ts<br/><i>Firebase app init,<br/>auth, functions</i>"]
    state["state.ts<br/><i>App state interface<br/>+ initial state</i>"]
    types["types.ts<br/><i>ListDoc, ItemDoc<br/>type definitions</i>"]
    dom["dom.ts<br/><i>qs() helper</i>"]
    styles["styles.css<br/><i>Themes, animations</i>"]

    main --> ui
    main --> elements
    main --> firestore
    main --> firebase
    main --> state
    ui --> elements
    ui --> types
    elements --> dom
    firestore --> firebase
    firestore --> types

    style main fill:#2d6a4f,stroke:#40916c,color:#fff
    style ui fill:#264653,stroke:#2a9d8f,color:#fff
    style firestore fill:#264653,stroke:#2a9d8f,color:#fff
    style firebase fill:#264653,stroke:#2a9d8f,color:#fff
    style elements fill:#3a506b,stroke:#5bc0be,color:#fff
    style state fill:#3a506b,stroke:#5bc0be,color:#fff
    style types fill:#3a506b,stroke:#5bc0be,color:#fff
    style dom fill:#3a506b,stroke:#5bc0be,color:#fff
    style styles fill:#6b3a5c,stroke:#be5ba3,color:#fff
```

### Data Model

```mermaid
erDiagram
    LIST {
        string id PK
        string name
        boolean isDefault
        number order
        string createdBy
        string createdByName
        string updatedByName
        timestamp createdAt
        timestamp updatedAt
    }

    ITEM {
        string id PK
        string text
        boolean checked
        number quantity
        string unit
        number order
        string createdBy
        string createdByName
        string updatedByName
        timestamp createdAt
        timestamp updatedAt
    }

    LIST ||--o{ ITEM : "contains"
```

### Voice Command Pipeline

```mermaid
flowchart LR
    Mic["🎤 Tap Mic"] --> Modal["Voice Modal<br/>(recording)"]
    Modal --> Send["Tap Send"]
    Send --> B64["Base64 encode<br/>audio blob"]
    B64 --> CF["Cloud Function<br/><b>parseVoiceCommand</b>"]

    subgraph CloudFunction["Cloud Function (us-east1)"]
        CF --> STT["Sarvam STT<br/>(saaras:v3)"]
        STT --> Transcript["Transcript text"]
        Transcript --> Chat["Sarvam Chat<br/>(sarvam-m)"]
        Chat --> Intent["JSON Intent"]
    end

    Intent --> Execute["Execute intent<br/>(add/edit/delete/...)"]
    Execute --> TTS["Cloud Function<br/><b>speakText</b>"]
    TTS --> SarvamTTS["Sarvam TTS<br/>(bulbul:v3)"]
    SarvamTTS --> Audio["🔊 Play audio"]

    style Mic fill:#2d6a4f,stroke:#40916c,color:#fff
    style Modal fill:#2d6a4f,stroke:#40916c,color:#fff
    style CloudFunction fill:#1b2838,stroke:#2a4858,color:#e0e0e0
```

### Voice Intent Types

```mermaid
mindmap
    root((Voice Intents))
        Items
            add_item
            add_items_bulk
            edit_item_text
            set_quantity
            set_unit
            check_item
            uncheck_item
            delete_item
            move_item
        Bulk Operations
            check_all
            uncheck_all
            clear_checked
            clear_all
        Lists
            create_list
            select_list
            rename_list
            delete_list
            move_list
        Other
            read_items
            clarify
            unknown
```

### Deployment Flow

```mermaid
flowchart TB
    Push["Push to main"] --> GHA["GitHub Actions"]

    subgraph Pipeline["CI/CD Pipeline"]
        GHA --> BuildCSS["Build CSS<br/>(Tailwind CLI)"]
        GHA --> BuildJS["Build JS<br/>(Bun bundler)"]
        GHA --> BuildFn["Build Functions<br/>(tsc)"]
        BuildCSS --> Deploy
        BuildJS --> Deploy
        BuildFn --> Deploy
    end

    Deploy["Firebase Deploy"] --> Hosting["Firebase Hosting<br/>(static files)"]
    Deploy --> Functions["Cloud Functions<br/>(Node 22, us-east1)"]

    Hosting --> CF["Cloudflare DNS"]
    CF --> Domain["shopping.sudhanva.me"]

    style Push fill:#2d6a4f,stroke:#40916c,color:#fff
    style Pipeline fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style Domain fill:#6b3a5c,stroke:#be5ba3,color:#fff
```

### Authentication & Authorization

```mermaid
stateDiagram-v2
    [*] --> SignedOut
    SignedOut --> SigningIn: Click "Sign in with Google"
    SigningIn --> SignedIn: Auth success
    SigningIn --> SignedOut: Auth failed/cancelled
    SignedIn --> SignedOut: Sign out

    state SignedOut {
        [*] --> ReadOnly
        ReadOnly: Can view lists and items
        ReadOnly: Can use "Read list aloud"
        ReadOnly: Cannot edit, add, or delete
        ReadOnly: Cannot use voice commands
    }

    state SignedIn {
        [*] --> FullAccess
        FullAccess: All CRUD operations
        FullAccess: Voice commands
        FullAccess: Reordering
        FullAccess: List management
    }
```

## Tech

- Bun + Vanilla TypeScript
- Tailwind CSS v4 + daisyUI v5 for styling
- Firebase Hosting + Firestore (Native mode)
- Firebase Auth (Google)
- Sarvam AI (STT, TTS, Chat)

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

### Cloud Functions (Voice Control)

Voice control uses Firebase Cloud Functions in `us-east1` and Sarvam APIs for STT + intent parsing + TTS.

```bash
firebase functions:secrets:set SARVAM_API_KEY
```

Then deploy:

```bash
bunx firebase-tools deploy --only functions
```

Voice UX in app:

- Tap the mic button to open the voice modal
- Speak your command, then tap Send
- App transcribes → parses intent → executes → speaks result
- If ambiguous, app asks a follow-up clarification
- Signed-out users can only use `Read list aloud`

## Firestore Rules

Rules live in `firestore.rules`. Reads are public, writes require auth and strict schema.

## Cloudflare DNS (Optional)

- CNAME `shopping.sudhanva.me` → `sudhanva-shopping-app.web.app`
- Add the TXT record for domain verification

## GitHub Actions Deploy

On push to `main`, the workflow deploys Firebase Hosting + Cloud Functions.

Required secret: `FIREBASE_SERVICE_ACCOUNT_SUDHANVA_PERSONAL`
