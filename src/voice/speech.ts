import { callFunction } from "../lib/firebase";
import type { ItemDoc, ListDoc } from "../lib/types";

// bulbul:v3 accepts a maximum of 2500 characters in each request.
const maxTtsChars = 2500;

type SpeakResponse = { audioBase64: string; mimeType: string };

let currentAudio: HTMLAudioElement | null = null;

/** Stops all speech that plays now, for example when the user closes the voice modal. */
export function stopSpeaking() {
  currentAudio?.pause();
  currentAudio = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// Resolves when playback ends. Some browsers do not send the end event, so stop the wait after an
// estimate of the speech duration plus a margin.
function untilDone(text: string, listen: (done: () => void) => void): Promise<void> {
  const estimateMs = 2000 + text.length * 90;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, estimateMs);
    listen(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function fallbackSpeak(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-IN";
  speechSynthesis.cancel();
  return untilDone(text, (done) => {
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  });
}

/** Speaks `text` and resolves when the playback is complete. */
export async function speakResponse(text: string, signedIn: boolean): Promise<void> {
  if (!text.trim()) return;
  if (!signedIn) return fallbackSpeak(text);

  try {
    const payload = await callFunction<{ text: string }, SpeakResponse>("speakText", {
      text: text.slice(0, maxTtsChars),
    });
    const audio = new Audio(`data:${payload.mimeType};base64,${payload.audioBase64}`);
    stopSpeaking();
    currentAudio = audio;
    const finished = untilDone(text, (done) => {
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done;
    });
    await audio.play();
    return finished;
  } catch {
    return fallbackSpeak(text);
  }
}

export function listReadoutText(list: ListDoc | null, items: ItemDoc[]): string {
  if (!list) {
    return "No list selected.";
  }
  if (items.length === 0) {
    return `${list.name} is empty.`;
  }
  const parts = items.map((item, index) => {
    const qty = Number.isFinite(item.quantity) ? item.quantity : 1;
    const unit = item.unit ? ` ${item.unit}` : "";
    const status = item.checked ? "checked" : "unchecked";
    return `${index + 1}, ${item.text}, ${qty}${unit}, ${status}`;
  });
  return `${list.name}. ${parts.join(". ")}.`;
}
