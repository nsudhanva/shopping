import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { elements } from "./elements";
import { auth, functions, provider } from "./firebase";
import {
  backfillItemOrder,
  backfillListOrder,
  clearAllItems,
  clearCheckedItems,
  createItem,
  createList,
  deleteItem,
  deleteListWithItems,
  ensureDefaultListId,
  persistItemOrder,
  persistListOrder,
  subscribeItems,
  subscribeLists,
  updateAllItems,
  updateItem,
  updateList,
} from "./firestore";
import { state } from "./state";
import type { ListDoc } from "./types";
import { renderItems, renderLists, resetRenameForm, setAuthUi, setEditingEnabled } from "./ui";

let unsubscribeItems: (() => void) | null = null;
const themeKey = "shopping-theme";
const selectedListKey = "shopping-selected-list-id";

type VoiceListContext = { id: string; name: string };
type VoiceItemContext = { id: string; text: string; checked: boolean; quantity: number; unit: string };
type VoiceContext = {
  currentListId: string | null;
  currentListName: string | null;
  lists: VoiceListContext[];
  items: VoiceItemContext[];
};

type VoiceIntent = {
  type: string;
  itemId?: string;
  listId?: string;
  itemText?: string;
  listName?: string;
  newText?: string;
  newName?: string;
  quantity?: number;
  unit?: string;
  direction?: "up" | "down";
  keepItems?: boolean;
  question?: string;
  options?: string[];
  pending?: Record<string, unknown>;
  items?: Array<{
    text: string;
    quantity?: number;
    unit?: string;
  }>;
};

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

type SpeakResponse = { audioBase64: string; mimeType: string };

const parseVoiceCommand = httpsCallable<ParseVoiceRequest, ParseVoiceResponse>(functions, "parseVoiceCommand");
const speakText = httpsCallable<{ text: string }, SpeakResponse>(functions, "speakText");

let mediaRecorder: MediaRecorder | null = null;
let recordingChunks: BlobPart[] = [];
let recordingActive = false;
let processingVoice = false;
let pendingClarification: Record<string, unknown> | null = null;
let voiceTimerInterval: ReturnType<typeof setInterval> | null = null;
let voiceAutoCloseTimer: ReturnType<typeof setTimeout> | null = null;
let voiceStartTime = 0;
let activeMediaStream: MediaStream | null = null;

// Mirror the Firestore rules so voice-derived values don't get rejected.
const maxItemTextLength = 120;
const maxListNameLength = 60;
const maxUnitLength = 16;
// bulbul:v3 accepts up to 2500 characters per request.
const maxTtsChars = 2500;

function readStoredListId(): string | null {
  try {
    return localStorage.getItem(selectedListKey);
  } catch {
    return null;
  }
}

function storeSelectedListId(listId: string | null) {
  try {
    if (!listId) {
      localStorage.removeItem(selectedListKey);
      return;
    }
    localStorage.setItem(selectedListKey, listId);
  } catch {
    // Ignore storage failures (private browsing, blocked storage, etc.).
  }
}

function getUserLabel(): string {
  if (!state.user) return "Someone";
  return state.user.displayName ?? state.user.email ?? "Someone";
}

function setVoiceStatus(text: string) {
  elements.voiceStatus.textContent = text;
}

function readStoredTheme(): "shopping-dark" | "shopping-light" {
  try {
    return localStorage.getItem(themeKey) === "shopping-light" ? "shopping-light" : "shopping-dark";
  } catch {
    return "shopping-dark";
  }
}

function storeTheme(theme: "shopping-dark" | "shopping-light") {
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // Ignore storage failures (private browsing, blocked storage, etc.).
  }
}

// Rounds away float drift such as 1.1 - 1 = 0.10000000000000009.
function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hasItem(itemId: string | undefined): itemId is string {
  return Boolean(itemId && state.items.some((item) => item.id === itemId));
}

function hasList(listId: string | undefined): listId is string {
  return Boolean(listId && state.lists.some((list) => list.id === listId));
}

function applyTheme(theme: "shopping-dark" | "shopping-light") {
  document.documentElement.setAttribute("data-theme", theme);
  elements.themeToggle.textContent = theme === "shopping-dark" ? "Light mode" : "Dark mode";
}

function swapOrders(
  currentOrder: number,
  targetOrder: number,
  direction: "up" | "down",
): { current: number; target: number } {
  if (currentOrder !== targetOrder) {
    return { current: targetOrder, target: currentOrder };
  }
  const delta = 0.0001;
  if (direction === "up") {
    return { current: targetOrder - delta, target: targetOrder + delta };
  }
  return { current: targetOrder + delta, target: targetOrder - delta };
}

function setActiveList(listId: string | null) {
  state.currentListId = listId;
  storeSelectedListId(listId);
  state.items = [];
  state.editingItemId = null;
  state.editingItemText = "";
  resetRenameForm();
  renderItems(state, itemHandlers);
  renderLists(state, listHandlers);
  subscribeToItems();
}

function subscribeToItems() {
  if (unsubscribeItems) {
    unsubscribeItems();
    unsubscribeItems = null;
  }

  if (!state.currentListId) {
    state.items = [];
    renderItems(state, itemHandlers);
    return;
  }

  unsubscribeItems = subscribeItems(state.currentListId, (items) => {
    state.items = items;
    if (state.editingItemId && !state.items.find((item) => item.id === state.editingItemId)) {
      state.editingItemId = null;
      state.editingItemText = "";
    }
    if (
      state.user &&
      state.currentListId &&
      state.items.some((item) => item.orderMissing || item.quantityMissing) &&
      !state.backfilledItemLists.has(state.currentListId)
    ) {
      const listIdToBackfill = state.currentListId;
      state.backfilledItemLists.add(listIdToBackfill);
      void backfillItemOrder(listIdToBackfill, getUserLabel()).catch(() => {
        state.backfilledItemLists.delete(listIdToBackfill);
      });
    }
    renderItems(state, itemHandlers);
    renderLists(state, listHandlers);
  });
}

function maybeEnsureDefaultList() {
  if (!state.user || !state.listsLoaded || state.ensureDefaultInFlight) return;
  if (state.lists.some((list) => list.isDefault)) return;
  state.ensureDefaultInFlight = true;
  void ensureDefaultListId({ userId: state.user.uid, userName: getUserLabel() }).finally(() => {
    state.ensureDefaultInFlight = false;
  });
}

// Lists without an `order` field are excluded by the orderBy query, so they never show up in the
// snapshot. Check the whole collection once per session instead of waiting to see one.
function maybeBackfillListOrder() {
  if (!state.user || state.backfillListsInFlight || state.listOrderBackfilled) return;
  state.backfillListsInFlight = true;
  void backfillListOrder(getUserLabel())
    .then(() => {
      state.listOrderBackfilled = true;
    })
    .finally(() => {
      state.backfillListsInFlight = false;
    });
}

// The default list to move items into when deleting `excludeListId`; never the list being deleted.
function findDefaultListId(excludeListId: string): string | undefined {
  return state.lists.find((list) => list.isDefault && list.id !== excludeListId)?.id;
}

function buildVoiceContext(): VoiceContext {
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  return {
    currentListId: state.currentListId,
    currentListName: active?.name ?? null,
    lists: state.lists.map((list) => ({ id: list.id, name: list.name })),
    items: state.items.map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
      quantity: item.quantity,
      unit: item.unit,
    })),
  };
}

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

function listReadoutText(): string {
  if (!state.currentListId) {
    return "No list selected.";
  }
  const list = state.lists.find((entry) => entry.id === state.currentListId);
  const name = list?.name ?? "Current list";
  if (state.items.length === 0) {
    return `${name} is empty.`;
  }
  const parts = state.items.map((item, index) => {
    const qty = Number.isFinite(item.quantity) ? item.quantity : 1;
    const unit = item.unit ? ` ${item.unit}` : "";
    const status = item.checked ? "checked" : "unchecked";
    return `${index + 1}, ${item.text}, ${qty}${unit}, ${status}`;
  });
  return `${name}. ${parts.join(". ")}.`;
}

function normalizeVoiceAddEntry(entry: { text: string; quantity?: number; unit?: string }) {
  const text = entry.text.trim().slice(0, maxItemTextLength);
  if (!text) return null;

  const hasQuantity = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) && entry.quantity > 0;
  let quantity = hasQuantity ? entry.quantity : undefined;
  let unit = entry.unit?.trim().slice(0, maxUnitLength) ?? "";

  if (!quantity && !unit) {
    const lowered = text.toLowerCase();
    if (lowered.includes("milk") || text.includes("ಹಾಲು")) {
      quantity = 1;
      unit = "L";
    }
  }

  if (!quantity) quantity = 1;

  return {
    text,
    quantity,
    unit,
  };
}

function looksLikeMultiAddTranscript(transcript: string): boolean {
  const lowered = transcript.toLowerCase();
  const hasSeparator =
    lowered.includes(",") ||
    lowered.includes(" and ") ||
    lowered.includes(" & ") ||
    transcript.includes(" ಹಾಗೂ ") ||
    transcript.includes(" ಮತ್ತು ");
  if (!hasSeparator) return false;
  const quantityMentions = transcript.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
  return quantityMentions >= 2 || lowered.includes(",") || lowered.includes(" and ");
}

function fallbackSpeak(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-IN";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

async function speakResponse(text: string) {
  if (!text.trim()) return;
  if (!state.user) {
    fallbackSpeak(text);
    return;
  }

  try {
    const result = await speakText({ text: text.slice(0, maxTtsChars) });
    const payload = result.data;
    const audio = new Audio(`data:${payload.mimeType};base64,${payload.audioBase64}`);
    await audio.play();
  } catch {
    fallbackSpeak(text);
  }
}

async function runIntent(intent: VoiceIntent): Promise<string> {
  if (!state.user) {
    return "Please sign in to use voice controls.";
  }

  switch (intent.type) {
    case "add_item": {
      if (!state.currentListId) return "No list is selected.";
      const text = intent.itemText?.trim();
      if (!text) return "I need an item name to add.";
      const normalized = normalizeVoiceAddEntry({
        text,
        quantity: intent.quantity,
        unit: intent.unit,
      });
      if (!normalized) return "I need an item name to add.";
      await createItem({
        listId: state.currentListId,
        text: normalized.text,
        quantity: normalized.quantity,
        unit: normalized.unit,
        userId: state.user.uid,
        userName: getUserLabel(),
      });
      return `Added ${normalized.text}.`;
    }
    case "add_items_bulk": {
      if (!state.currentListId) return "No list is selected.";
      const normalizedItems = (intent.items ?? [])
        .map((item) => normalizeVoiceAddEntry(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (normalizedItems.length === 0) return "I could not detect valid items to add.";

      for (const item of normalizedItems) {
        await createItem({
          listId: state.currentListId,
          text: item.text,
          quantity: item.quantity,
          unit: item.unit,
          userId: state.user.uid,
          userName: getUserLabel(),
        });
      }

      if (normalizedItems.length === 1) {
        return `Added ${normalizedItems[0].text}.`;
      }
      const preview = normalizedItems
        .slice(0, 3)
        .map((item) => item.text)
        .join(", ");
      return `Added ${normalizedItems.length} items: ${preview}${normalizedItems.length > 3 ? ", and more" : ""}.`;
    }
    case "edit_item_text": {
      if (!state.currentListId) return "No list is selected.";
      const newText = intent.newText?.trim().slice(0, maxItemTextLength);
      if (!intent.itemId || !newText) return "I need the item and new name.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(state.currentListId, intent.itemId, { text: newText, userName: getUserLabel() });
      return "Item updated.";
    }
    case "set_quantity": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId || typeof intent.quantity !== "number") return "I need the item and quantity.";
      if (!(intent.quantity > 0)) return "Quantity must be more than zero.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(state.currentListId, intent.itemId, {
        quantity: roundQuantity(intent.quantity),
        userName: getUserLabel(),
      });
      return "Quantity updated.";
    }
    case "set_unit": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId || intent.unit === undefined) return "I need the item and unit.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(state.currentListId, intent.itemId, {
        unit: intent.unit.trim().slice(0, maxUnitLength),
        userName: getUserLabel(),
      });
      return "Unit updated.";
    }
    case "check_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to check.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(state.currentListId, intent.itemId, { checked: true, userName: getUserLabel() });
      return "Item checked.";
    }
    case "uncheck_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to uncheck.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(state.currentListId, intent.itemId, { checked: false, userName: getUserLabel() });
      return "Item unchecked.";
    }
    case "delete_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to delete.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await deleteItem(state.currentListId, intent.itemId, getUserLabel());
      return "Item deleted.";
    }
    case "move_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId || !intent.direction) return "I need item and direction.";
      const index = state.items.findIndex((item) => item.id === intent.itemId);
      if (index < 0) return "Could not find that item.";
      const targetIndex = intent.direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.items.length) return "That item cannot move further.";

      const current = state.items[index];
      const target = state.items[targetIndex];
      const orders = swapOrders(current.order, target.order, intent.direction);
      await persistItemOrder(
        state.currentListId,
        [
          { id: current.id, order: orders.current },
          { id: target.id, order: orders.target },
        ],
        getUserLabel(),
      );
      return `Moved item ${intent.direction}.`;
    }
    case "check_all": {
      if (!state.currentListId) return "No list is selected.";
      await updateAllItems(state.currentListId, true, getUserLabel());
      return "Checked all items.";
    }
    case "uncheck_all": {
      if (!state.currentListId) return "No list is selected.";
      await updateAllItems(state.currentListId, false, getUserLabel());
      return "Unchecked all items.";
    }
    case "clear_checked": {
      if (!state.currentListId) return "No list is selected.";
      await clearCheckedItems(state.currentListId, getUserLabel());
      return "Cleared checked items.";
    }
    case "clear_all": {
      if (!state.currentListId) return "No list is selected.";
      await clearAllItems(state.currentListId, getUserLabel());
      return "Cleared all items.";
    }
    case "create_list": {
      const name = intent.listName?.trim().slice(0, maxListNameLength);
      if (!name) return "I need a name for the new list.";
      const listId = await createList({ name, userId: state.user.uid, userName: getUserLabel(), isDefault: false });
      setActiveList(listId);
      return `Created list ${name}.`;
    }
    case "select_list": {
      if (!intent.listId) return "I need a list to select.";
      if (!hasList(intent.listId)) return "Could not find that list.";
      setActiveList(intent.listId);
      return "List selected.";
    }
    case "rename_list": {
      const targetListId = intent.listId ?? state.currentListId;
      const newName = intent.newName?.trim().slice(0, maxListNameLength);
      if (!targetListId || !newName) return "I need the list and new name.";
      if (!hasList(targetListId)) return "Could not find that list.";
      await updateList(targetListId, { name: newName, userName: getUserLabel() });
      return "List renamed.";
    }
    case "delete_list": {
      const targetListId = intent.listId ?? state.currentListId;
      if (!targetListId) return "No list is selected.";
      if (!hasList(targetListId)) return "Could not find that list.";
      await deleteListWithItems({
        listId: targetListId,
        keepItems: Boolean(intent.keepItems),
        defaultListId: findDefaultListId(targetListId),
        userId: state.user.uid,
        userName: getUserLabel(),
      });
      return "List deleted.";
    }
    case "move_list": {
      if (!intent.listId || !intent.direction) return "I need list and direction.";
      const index = state.lists.findIndex((list) => list.id === intent.listId);
      if (index < 0) return "Could not find that list.";
      const targetIndex = intent.direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.lists.length) return "That list cannot move further.";

      const current = state.lists[index];
      const target = state.lists[targetIndex];
      const orders = swapOrders(current.order, target.order, intent.direction);
      await persistListOrder(
        [
          { id: current.id, order: orders.current },
          { id: target.id, order: orders.target },
        ],
        getUserLabel(),
      );
      return `Moved list ${intent.direction}.`;
    }
    case "read_items": {
      return listReadoutText();
    }
    default:
      return "I could not understand the command.";
  }
}

async function processVoiceCommand(blob: Blob) {
  if (!state.user) {
    setVoiceStatus("Sign in is required for voice controls.");
    await speakResponse("Please sign in to use voice controls.");
    return;
  }

  const audioBase64 = await blobToBase64(blob);
  setVoiceModalStatus("Understanding…");
  setVoiceStatus("Understanding command…");

  let parsed = await parseVoiceCommand({
    audioBase64,
    mimeType: blob.type || "audio/webm",
    context: buildVoiceContext(),
    pendingClarification,
    forceBulk: false,
  });

  let transcript = parsed.data.transcript;
  let intent = parsed.data.intent;

  if (intent.type === "add_item" && looksLikeMultiAddTranscript(transcript)) {
    const bulkRetry = await parseVoiceCommand({
      audioBase64,
      mimeType: blob.type || "audio/webm",
      context: buildVoiceContext(),
      pendingClarification,
      forceBulk: true,
    });

    if (bulkRetry.data.intent.type === "add_items_bulk") {
      parsed = bulkRetry;
      transcript = parsed.data.transcript;
      intent = parsed.data.intent;
    }
  }

  if (intent.type === "clarify") {
    pendingClarification = intent.pending ?? { transcript, options: intent.options ?? [] };
    const question = intent.question ?? parsed.data.responseText;
    setVoiceStatus(`Clarification needed: ${question}`);
    showVoiceResult(question);
    await speakResponse(question);
    return;
  }

  pendingClarification = null;

  const response = await runIntent(intent);
  setVoiceStatus(`Done: ${response}`);
  showVoiceResult(response);
  await speakResponse(response);
}

// --- Voice modal helpers ---

function setVoiceModalStatus(text: string) {
  elements.voiceModalStatus.textContent = text;
}

function startVoiceTimer() {
  voiceStartTime = Date.now();
  elements.voiceTimer.textContent = "0:00";
  voiceTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    elements.voiceTimer.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }, 250);
}

function stopVoiceTimer() {
  if (voiceTimerInterval) {
    clearInterval(voiceTimerInterval);
    voiceTimerInterval = null;
  }
}

function setVoiceCircleState(state: "listening" | "processing" | "result" | "idle") {
  elements.voiceCircle.classList.remove("listening", "processing", "result");
  if (state !== "idle") {
    elements.voiceCircle.classList.add(state);
  }
}

function showVoiceResult(text: string) {
  setVoiceCircleState("result");
  setVoiceModalStatus("Done");
  elements.voiceResultText.textContent = text;
  elements.voiceResultText.classList.remove("hidden");
  elements.voiceSendBtn.disabled = true;
  elements.voiceCancelBtn.textContent = "Close";

  // Auto-close after 2.5s
  clearVoiceAutoClose();
  voiceAutoCloseTimer = setTimeout(() => {
    voiceAutoCloseTimer = null;
    closeVoiceModal();
  }, 2500);
}

function clearVoiceAutoClose() {
  if (voiceAutoCloseTimer) {
    clearTimeout(voiceAutoCloseTimer);
    voiceAutoCloseTimer = null;
  }
}

function resetVoiceModalUi() {
  setVoiceCircleState("idle");
  setVoiceModalStatus("Listening…");
  elements.voiceTimer.textContent = "0:00";
  elements.voiceResultText.textContent = "";
  elements.voiceResultText.classList.add("hidden");
  elements.voiceSendBtn.disabled = false;
  elements.voiceCancelBtn.textContent = "Cancel";
}

function cleanupMediaStream() {
  if (activeMediaStream) {
    for (const track of activeMediaStream.getTracks()) {
      track.stop();
    }
    activeMediaStream = null;
  }
  recordingChunks = [];
  mediaRecorder = null;
  recordingActive = false;
}

function closeVoiceModal() {
  stopVoiceTimer();
  clearVoiceAutoClose();
  // If still recording, abort silently
  if (recordingActive && mediaRecorder && mediaRecorder.state === "recording") {
    // Remove the onstop handler so it doesn't trigger processing
    mediaRecorder.onstop = null;
    try {
      mediaRecorder.stop();
    } catch {
      // ignore
    }
  }
  cleanupMediaStream();
  resetVoiceModalUi();
  elements.voiceModal.close();
}

async function openVoiceModal() {
  if (processingVoice) {
    setVoiceStatus("Still working on the last command…");
    return;
  }
  if (recordingActive) return;
  if (!state.user) {
    setVoiceStatus("Sign in to use voice commands.");
    return;
  }

  // Reset and open
  clearVoiceAutoClose();
  resetVoiceModalUi();
  elements.voiceModal.showModal();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeMediaStream = stream;
    recordingChunks = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorder = recorder;

    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stopVoiceTimer();
      recordingActive = false;
      processingVoice = true;

      // Transition to processing state
      setVoiceCircleState("processing");
      setVoiceModalStatus("Processing…");
      elements.voiceSendBtn.disabled = true;

      try {
        const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) {
          await processVoiceCommand(blob);
        } else {
          setVoiceStatus("No voice captured. Try again.");
          showVoiceResult("No voice captured. Try again.");
        }
      } catch {
        setVoiceStatus("Voice command failed. Try again.");
        showVoiceResult("Something went wrong. Try again.");
        await speakResponse("Sorry, I could not process that.");
      } finally {
        // processingVoice is only cleared here so a modal dismissed mid-request can't overlap a new recording.
        cleanupMediaStream();
        processingVoice = false;
      }
    };

    mediaRecorder.start();
    recordingActive = true;
    setVoiceCircleState("listening");
    startVoiceTimer();
    setVoiceStatus("Listening…");
  } catch {
    setVoiceStatus("Microphone access denied.");
    closeVoiceModal();
  }
}

function sendVoiceRecording() {
  if (!recordingActive || !mediaRecorder) return;
  if (mediaRecorder.state !== "recording") return;
  stopVoiceTimer();
  setVoiceModalStatus("Processing…");
  setVoiceCircleState("processing");
  elements.voiceSendBtn.disabled = true;
  try {
    mediaRecorder.stop();
  } catch {
    closeVoiceModal();
    setVoiceStatus("Tap mic to speak");
  }
}

const listHandlers = {
  onSelectList: (listId: string) => {
    setActiveList(listId);
  },
  onRenameList: (list: ListDoc) => {
    setActiveList(list.id);
    elements.renameListInput.value = list.name;
    elements.renameListForm.classList.remove("hidden");
    elements.renameListInput.focus();
  },
  onMoveList: async (listId: string, direction: "up" | "down") => {
    if (!state.user) return;
    const index = state.lists.findIndex((list) => list.id === listId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.lists.length) return;

    const current = state.lists[index];
    const target = state.lists[targetIndex];
    const orders = swapOrders(current.order, target.order, direction);
    const updatedCurrent = { ...current, order: orders.current };
    const updatedTarget = { ...target, order: orders.target };
    const updatedLists = [...state.lists];
    updatedLists[index] = updatedTarget;
    updatedLists[targetIndex] = updatedCurrent;
    state.lists = updatedLists;
    renderLists(state, listHandlers);

    await persistListOrder(
      [
        { id: updatedCurrent.id, order: updatedCurrent.order },
        { id: updatedTarget.id, order: updatedTarget.order },
      ],
      getUserLabel(),
    );
  },
};

const itemHandlers = {
  onToggle: async (itemId: string, checked: boolean) => {
    if (!state.user || !state.currentListId) return;
    await updateItem(state.currentListId, itemId, { checked, userName: getUserLabel() });
  },
  onEditStart: (item: { id: string; text: string }) => {
    state.editingItemId = item.id;
    state.editingItemText = item.text;
    renderItems(state, itemHandlers);
  },
  onEditInput: (value: string) => {
    state.editingItemText = value;
  },
  onEditSave: async (itemId: string) => {
    if (!state.user || !state.currentListId) return;
    const text = state.editingItemText.trim();
    if (!text) return;
    await updateItem(state.currentListId, itemId, { text, userName: getUserLabel() });
    state.editingItemId = null;
    state.editingItemText = "";
    renderItems(state, itemHandlers);
  },
  onEditCancel: () => {
    state.editingItemId = null;
    state.editingItemText = "";
    renderItems(state, itemHandlers);
  },
  onDelete: async (itemId: string) => {
    if (!state.user || !state.currentListId) return;
    await deleteItem(state.currentListId, itemId, getUserLabel());
  },
  onLongDelete: async (itemId: string) => {
    if (!state.user || !state.currentListId) return;
    const item = state.items.find((entry) => entry.id === itemId);
    const itemLabel = item?.text ? ` "${item.text}"` : "";
    if (!confirm(`Delete${itemLabel}?`)) return;
    await deleteItem(state.currentListId, itemId, getUserLabel());
  },
  onQuantityChange: async (itemId: string, quantity: number) => {
    if (!state.user || !state.currentListId) return;
    const rounded = roundQuantity(quantity);
    if (!(rounded > 0)) {
      renderItems(state, itemHandlers);
      return;
    }
    await updateItem(state.currentListId, itemId, { quantity: rounded, userName: getUserLabel() });
  },
  onUnitChange: async (itemId: string, unit: string) => {
    if (!state.user || !state.currentListId) return;
    await updateItem(state.currentListId, itemId, { unit, userName: getUserLabel() });
  },
  onMoveItem: async (itemId: string, direction: "up" | "down") => {
    if (!state.user || !state.currentListId) return;
    const index = state.items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.items.length) return;

    const current = state.items[index];
    const target = state.items[targetIndex];
    const orders = swapOrders(current.order, target.order, direction);
    const updatedCurrent = { ...current, order: orders.current };
    const updatedTarget = { ...target, order: orders.target };
    const updatedItems = [...state.items];
    updatedItems[index] = updatedTarget;
    updatedItems[targetIndex] = updatedCurrent;
    state.items = updatedItems;
    renderItems(state, itemHandlers);

    await persistItemOrder(
      state.currentListId,
      [
        { id: updatedCurrent.id, order: updatedCurrent.order },
        { id: updatedTarget.id, order: updatedTarget.order },
      ],
      getUserLabel(),
    );
  },
};

subscribeLists((lists) => {
  state.lists = lists;
  state.listsLoaded = true;

  if (!state.currentListId) {
    const storedListId = readStoredListId();
    const restoredList = storedListId ? state.lists.find((list) => list.id === storedListId) : undefined;
    const defaultList = restoredList ?? state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(defaultList?.id ?? null);
  } else if (!state.lists.find((list) => list.id === state.currentListId)) {
    const fallback = state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(fallback?.id ?? null);
  } else {
    renderLists(state, listHandlers);
  }

  maybeEnsureDefaultList();
  maybeBackfillListOrder();
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  setAuthUi(state);
  setEditingEnabled(Boolean(user));
  renderLists(state, listHandlers);
  renderItems(state, itemHandlers);
  maybeEnsureDefaultList();
  maybeBackfillListOrder();

  elements.voiceMicBtn.disabled = !state.user;
  setVoiceStatus(state.user ? "Tap mic to speak" : "Signed out. You can use Read list aloud only.");

  if (!state.user) {
    pendingClarification = null;
  }
});

elements.signInBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/popup-blocked" && code !== "auth/operation-not-supported-in-this-environment") {
      // Closing the popup or a duplicate click is not a reason to navigate away.
      console.warn("Popup sign-in failed", error);
      return;
    }
    console.warn("Popup sign-in unavailable, redirecting", error);
    await signInWithRedirect(auth, provider);
  }
});

elements.signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

elements.newListBtn.addEventListener("click", () => {
  elements.newListForm.classList.remove("hidden");
  elements.newListInput.focus();
});

elements.cancelListBtn.addEventListener("click", () => {
  elements.newListForm.reset();
  elements.newListForm.classList.add("hidden");
});

elements.newListForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) return;
  const name = elements.newListInput.value.trim();
  if (!name) return;

  elements.newListForm.reset();
  elements.newListForm.classList.add("hidden");

  const listId = await createList({ name, userId: state.user.uid, userName: getUserLabel(), isDefault: false });
  setActiveList(listId);
});

elements.editListBtn.addEventListener("click", () => {
  if (!state.user) return;
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  if (!active) return;
  elements.editListInput.value = active.name;
  elements.editListForm.classList.remove("hidden");
  elements.editListInput.focus();
});

elements.cancelEditListBtn.addEventListener("click", () => {
  elements.editListForm.reset();
  elements.editListForm.classList.add("hidden");
});

elements.editListForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const name = elements.editListInput.value.trim();
  if (!name) return;
  await updateList(state.currentListId, { name, userName: getUserLabel() });
  elements.editListForm.classList.add("hidden");
});

elements.renameListForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const name = elements.renameListInput.value.trim();
  if (!name) return;
  await updateList(state.currentListId, { name, userName: getUserLabel() });
  resetRenameForm();
});

elements.cancelRenameListBtn.addEventListener("click", () => {
  resetRenameForm();
});

elements.newItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const text = elements.newItemInput.value.trim();
  if (!text) return;

  // Reset before the server round-trip so the next item typed in the meantime isn't wiped.
  elements.newItemForm.reset();
  await createItem({
    listId: state.currentListId,
    text,
    userId: state.user.uid,
    userName: getUserLabel(),
  });
});

elements.deleteListBtn.addEventListener("click", () => {
  if (!state.user) return;
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  if (!active) return;
  elements.deleteDialog.showModal();
});

elements.cancelDeleteBtn.addEventListener("click", () => {
  elements.deleteDialog.close();
});

elements.confirmDeleteBtn.addEventListener("click", async () => {
  if (!state.user) return;
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  if (!active) return;

  const mode = (document.querySelector("input[name='delete-mode']:checked") as HTMLInputElement | null)?.value;
  const keepItems = mode === "keep";

  elements.confirmDeleteBtn.disabled = true;
  try {
    await deleteListWithItems({
      listId: active.id,
      keepItems,
      defaultListId: findDefaultListId(active.id),
      userId: state.user.uid,
      userName: getUserLabel(),
    });
  } finally {
    elements.confirmDeleteBtn.disabled = false;
    elements.deleteDialog.close();
  }
});

elements.checkAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(state.currentListId, true, getUserLabel());
});

elements.uncheckAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(state.currentListId, false, getUserLabel());
});

elements.clearCheckedBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear checked items from this list?")) return;
  await clearCheckedItems(state.currentListId, getUserLabel());
});

elements.clearAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear all items from this list?")) return;
  await clearAllItems(state.currentListId, getUserLabel());
});

elements.voiceMicBtn.addEventListener("click", () => {
  void openVoiceModal();
});

elements.voiceSendBtn.addEventListener("click", () => {
  sendVoiceRecording();
});

elements.voiceCancelBtn.addEventListener("click", () => {
  closeVoiceModal();
  setVoiceStatus("Tap mic to speak");
});

// Also close on backdrop click / Escape via dialog's native close event
elements.voiceModal.addEventListener("close", () => {
  // Cleanup if user dismissed via Escape or backdrop
  if (recordingActive || activeMediaStream) {
    closeVoiceModal();
  }
  if (!processingVoice) setVoiceStatus("Tap mic to speak");
});

elements.voiceReadBtn.addEventListener("click", async () => {
  const text = listReadoutText();
  setVoiceStatus("Reading list...");
  await speakResponse(text);
  setVoiceStatus("Tap mic to speak");
});

applyTheme(readStoredTheme());

elements.themeToggle.addEventListener("click", () => {
  const current =
    (document.documentElement.getAttribute("data-theme") as "shopping-dark" | "shopping-light") ?? "shopping-dark";
  const next = current === "shopping-dark" ? "shopping-light" : "shopping-dark";
  storeTheme(next);
  applyTheme(next);
});

setAuthUi(state);
setVoiceStatus("Tap mic to speak");
