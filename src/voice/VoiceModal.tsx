import { useEffect, useRef, useState } from "react";
import { MicIcon, SendIcon } from "../components/icons";
import { callFunction } from "../lib/firebase";
import type { Shopping } from "../lib/shopping";
import {
  buildVoiceContext,
  looksLikeMultiAddTranscript,
  runIntent,
  type VoiceContext,
  type VoiceIntent,
} from "./intents";
import { MicrophoneError, type Recording, startRecording } from "./recorder";
import { speakResponse, stopSpeaking } from "./speech";

type ParseVoiceRequest = {
  audioBase64: string;
  mimeType: string;
  context: VoiceContext;
  pendingClarification?: Record<string, unknown> | null;
  forceBulk?: boolean;
};

type ParseVoiceResponse = {
  transcript: string;
  intent: VoiceIntent;
  responseText: string;
};

type Phase = "starting" | "listening" | "processing" | "result";

// The text that the modal shows and speaks after it handles a command.
type Outcome = { text: string; status: string; speak: boolean; askAgain: boolean };

const phaseLabels: Record<Phase, string> = {
  starting: "Starting microphone…",
  listening: "Listening…",
  processing: "Understanding…",
  result: "Done",
};

const microphoneMessages: Record<MicrophoneError["reason"], string> = {
  denied: "Microphone access is blocked. Allow it in your browser's site settings.",
  missing: "No microphone found.",
  unsupported: "This browser can't record audio.",
  failed: "Couldn't start the microphone. Try again.",
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio"));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader output"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function formatElapsed(ms: number) {
  const elapsed = Math.floor(ms / 1000);
  return `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`;
}

function vibrate() {
  navigator.vibrate?.(12);
}

// This module loads on the first mic tap. `openRequest` increases on each tap. The recording and request
// state is in refs, so async steps can check if their session is still the current session.
export default function VoiceModal(props: {
  openRequest: number;
  getShopping: () => Shopping;
  onStatus: (text: string | null) => void;
}) {
  const { openRequest, getShopping, onStatus } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const circleRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const recordingRef = useRef<Recording | null>(null);
  const pendingClarificationRef = useRef<Record<string, unknown> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userClosedRef = useRef(true);
  // Increases each time the dialog opens or closes. Async steps (mic start, server request, speech) check it
  // when they finish and stop if it changed. Thus a closed command cannot change a newer one.
  const sessionRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("starting");
  const [elapsed, setElapsed] = useState("0:00");
  const [message, setMessage] = useState<string | null>(null);
  const [isQuestion, setIsQuestion] = useState(false);

  const isOpen = () => dialogRef.current?.open ?? false;
  const isCurrent = (session: number) => session === sessionRef.current && isOpen();

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function clearAutoClose() {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    autoCloseRef.current = null;
  }

  // All close paths (Cancel, Escape, backdrop, auto-close) come here. A close cancels all work in progress,
  // including a question that has no answer.
  function handleClosed() {
    sessionRef.current += 1;
    stopTimer();
    clearAutoClose();
    recordingRef.current?.cancel();
    recordingRef.current = null;
    pendingClarificationRef.current = null;
    if (userClosedRef.current) {
      stopSpeaking();
      onStatus(null);
    }
  }

  function closeQuietly() {
    userClosedRef.current = false;
    dialogRef.current?.close();
  }

  async function listen() {
    clearAutoClose();
    setPhase("starting");
    setElapsed("0:00");
    if (!isOpen()) {
      sessionRef.current += 1;
      setMessage(null);
      setIsQuestion(false);
      userClosedRef.current = true;
      dialogRef.current?.showModal();
    }
    const session = sessionRef.current;
    onStatus(phaseLabels.starting);

    let recording: Recording | null = null;
    try {
      recording = await startRecording({
        onLevel: (level) => circleRef.current?.style.setProperty("--voice-level", level.toFixed(3)),
        // Only the recording that is still live can end itself.
        onEndOfSpeech: () => {
          if (recording && recordingRef.current === recording) void send();
        },
      });
    } catch (error) {
      if (!isCurrent(session)) return;
      const text = error instanceof MicrophoneError ? microphoneMessages[error.reason] : microphoneMessages.failed;
      await showOutcome({ text, status: text, speak: false, askAgain: false }, session);
      return;
    }
    if (!isCurrent(session)) {
      // The user closed or opened the dialog again while the permission prompt showed.
      recording.cancel();
      return;
    }

    // The app captures audio only from this point, so tell the user to speak now.
    recordingRef.current = recording;
    vibrate();
    setPhase("listening");
    onStatus(phaseLabels.listening);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsed(formatElapsed(Date.now() - startedAt)), 250);
  }

  async function send() {
    const recording = recordingRef.current;
    if (!recording) return;
    const session = sessionRef.current;
    recordingRef.current = null;
    stopTimer();
    vibrate();
    setPhase("processing");
    onStatus(phaseLabels.processing);

    let outcome: Outcome | null;
    try {
      // The stop releases the microphone before the network request.
      const result = await recording.stop();
      outcome =
        "silent" in result
          ? { text: "I didn't hear anything. Try again.", status: "Nothing heard.", speak: false, askAgain: false }
          : await handleCommand(result.blob, result.mimeType, session);
    } catch {
      outcome = {
        text: "Sorry, I could not process that.",
        status: "Voice command failed. Try again.",
        speak: true,
        askAgain: false,
      };
    }
    if (outcome && isCurrent(session)) await showOutcome(outcome, session);
  }

  // Returns null if the user closed the dialog during the server request. The app then discards the command.
  async function handleCommand(blob: Blob, mimeType: string, session: number): Promise<Outcome | null> {
    const audioBase64 = await blobToBase64(blob);
    const request = (forceBulk: boolean) =>
      callFunction<ParseVoiceRequest, ParseVoiceResponse>("parseVoiceCommand", {
        audioBase64,
        mimeType,
        context: buildVoiceContext(getShopping()),
        pendingClarification: pendingClarificationRef.current,
        forceBulk,
      });

    let parsed = await request(false);
    if (parsed.intent.type === "add_item" && looksLikeMultiAddTranscript(parsed.transcript)) {
      const bulkRetry = await request(true);
      if (bulkRetry.intent.type === "add_items_bulk") parsed = bulkRetry;
    }
    if (!isCurrent(session)) return null;

    const { intent, transcript } = parsed;
    if (intent.type === "clarify") {
      pendingClarificationRef.current = intent.pending ?? { transcript, options: intent.options ?? [] };
      const question = intent.question ?? parsed.responseText;
      return { text: question, status: `Clarification needed: ${question}`, speak: true, askAgain: true };
    }
    pendingClarificationRef.current = null;
    if (!transcript) {
      // The server found no speech. Its reply tells the user.
      return { text: parsed.responseText, status: parsed.responseText, speak: true, askAgain: false };
    }

    // Read the state again. The list or the items can change during the request.
    const response = await runIntent(getShopping(), intent);
    return { text: response, status: `Done: ${response}`, speak: true, askAgain: false };
  }

  async function showOutcome(outcome: Outcome, session: number) {
    onStatus(outcome.status);
    setPhase("result");
    setMessage(outcome.text);
    setIsQuestion(outcome.askAgain);
    if (outcome.speak) await speakResponse(outcome.text, Boolean(getShopping().user));
    if (!isCurrent(session)) return;
    if (outcome.askAgain) {
      // Listen for the answer immediately. The user does not have to tap the mic again.
      await listen();
      return;
    }
    // The user heard the spoken result. A result that is only written stays on screen for longer.
    autoCloseRef.current = setTimeout(closeQuietly, outcome.speak ? 1200 : 3000);
  }

  // Send is disabled until listening starts, so it can get focus only after that render. Then Enter sends.
  useEffect(() => {
    if (phase === "listening") sendRef.current?.focus();
  }, [phase]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: this runs one time for each mic tap.
  useEffect(() => {
    if (!isOpen()) void listen();
  }, [openRequest]);

  const circleState = phase === "starting" ? "" : phase;

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-bottom sm:modal-middle"
      aria-label="Voice command"
      onClose={handleClosed}
    >
      <div className="modal-box flex flex-col items-center gap-6 py-10">
        <div ref={circleRef} className={`voice-circle ${circleState}`}>
          <div className="voice-ring voice-ring-1" />
          <div className="voice-ring voice-ring-2" />
          <div className="voice-ring voice-ring-3" />
          <div className="voice-circle-inner">
            <MicIcon className="w-10 h-10" />
          </div>
        </div>

        <div className="font-mono text-3xl font-bold tabular-nums tracking-wider" role="timer">
          {elapsed}
        </div>
        <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
          <p className="text-lg font-medium text-base-content/70">
            {phase === "result" && isQuestion ? "Question" : phaseLabels[phase]}
          </p>
          {phase === "listening" ? (
            <p className="text-sm text-base-content/70">
              {message ?? "Say a command."} Pause when you're done, or tap Send.
            </p>
          ) : (
            message && <p className="text-base">{message}</p>
          )}
        </div>

        <div className="flex gap-4 w-full max-w-xs">
          <button
            type="button"
            className="btn btn-ghost flex-1"
            onClick={() => {
              userClosedRef.current = true;
              dialogRef.current?.close();
            }}
          >
            {phase === "result" ? "Close" : "Cancel"}
          </button>
          <button
            ref={sendRef}
            type="button"
            className="btn btn-primary flex-1"
            disabled={phase !== "listening"}
            onClick={() => void send()}
          >
            <SendIcon className="w-5 h-5" />
            Send
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">close</button>
      </form>
    </dialog>
  );
}
