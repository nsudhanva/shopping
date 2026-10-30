import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { loadFunctionsSdk } from "../lib/firebase";
import { type Shopping, useShopping } from "../lib/shopping";
import { listReadoutText, speakResponse } from "../voice/speech";
import { MicIcon } from "./icons";

// The modal, the recorder and the intent code are in a separate chunk. The app starts to load this chunk and
// the Functions SDK when the user points to, focuses or presses the mic button. Then the modal opens without a delay.
const loadVoiceModal = () => import("../voice/VoiceModal");
const VoiceModal = lazy(loadVoiceModal);

function preloadVoice() {
  // If the preload fails, the app tries again when the modal loads and shows the error then.
  loadVoiceModal().catch(() => {});
  loadFunctionsSdk().catch(() => {});
}

// If the voice chunk does not load (the device is offline, or a deploy removed the chunk of an old tab),
// only voice stops. The list continues to work, and the status line tells the user how to recover.
class VoiceLoadBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function VoiceBar() {
  const shopping = useShopping();
  const { user } = shopping;
  const [openRequest, setOpenRequest] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  // Voice commands continue after async steps. They read the latest state through this ref.
  const shoppingRef = useRef<Shopping>(shopping);
  useEffect(() => {
    shoppingRef.current = shopping;
  });

  const idleStatus = user ? "Tap mic to speak" : "Signed out. You can use Read list aloud only.";

  async function readAloud() {
    setStatus("Reading list...");
    try {
      await speakResponse(listReadoutText(shopping.currentList, shopping.items), Boolean(user));
    } finally {
      setStatus(null);
    }
  }

  return (
    <div className="mb-6 p-3 rounded-xl bg-base-200 flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn btn-secondary btn-circle btn-lg"
        aria-label="Start voice command"
        disabled={!user}
        onPointerEnter={preloadVoice}
        onPointerDown={preloadVoice}
        onFocus={preloadVoice}
        onClick={() => setOpenRequest((count) => count + 1)}
      >
        <MicIcon className="w-6 h-6" />
      </button>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void readAloud()}>
        Read list aloud
      </button>
      <span className="text-sm text-muted" aria-live="polite">
        {status ?? idleStatus}
      </span>
      {openRequest > 0 && (
        <VoiceLoadBoundary onError={() => setStatus("Voice controls failed to load. Reload the page to try again.")}>
          <Suspense fallback={null}>
            <VoiceModal openRequest={openRequest} getShopping={() => shoppingRef.current} onStatus={setStatus} />
          </Suspense>
        </VoiceLoadBoundary>
      )}
    </div>
  );
}
