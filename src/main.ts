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
import { renderItems, renderLists, resetRenameForm, setAuthUi } from "./ui";

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
let pendingClarification: Record<string, unknown> | null = null;

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

function maybeBackfillListOrder() {
  if (!state.user || state.backfillListsInFlight) return;
  if (!state.lists.some((list) => list.orderMissing)) return;
  state.backfillListsInFlight = true;
  void backfillListOrder(getUserLabel()).finally(() => {
    state.backfillListsInFlight = false;
  });
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
  const text = entry.text.trim();
  if (!text) return null;

  const hasQuantity = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) && entry.quantity > 0;
  let quantity = hasQuantity ? entry.quantity : undefined;
  let unit = entry.unit?.trim() ?? "";

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
    const result = await speakText({ text: text.slice(0, 500) });
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
      if (!intent.itemId || !intent.newText?.trim()) return "I need the item and new name.";
      await updateItem(state.currentListId, intent.itemId, { text: intent.newText.trim(), userName: getUserLabel() });
      return "Item updated.";
    }
    case "set_quantity": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId || typeof intent.quantity !== "number") return "I need the item and quantity.";
      await updateItem(state.currentListId, intent.itemId, { quantity: intent.quantity, userName: getUserLabel() });
      return "Quantity updated.";
    }
    case "set_unit": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId || intent.unit === undefined) return "I need the item and unit.";
      await updateItem(state.currentListId, intent.itemId, { unit: intent.unit, userName: getUserLabel() });
      return "Unit updated.";
    }
    case "check_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to check.";
      await updateItem(state.currentListId, intent.itemId, { checked: true, userName: getUserLabel() });
      return "Item checked.";
    }
    case "uncheck_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to uncheck.";
      await updateItem(state.currentListId, intent.itemId, { checked: false, userName: getUserLabel() });
      return "Item unchecked.";
    }
    case "delete_item": {
      if (!state.currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to delete.";
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
      const name = intent.listName?.trim();
      if (!name) return "I need a name for the new list.";
      const listId = await createList({ name, userId: state.user.uid, userName: getUserLabel(), isDefault: false });
      setActiveList(listId);
      return `Created list ${name}.`;
    }
    case "select_list": {
      if (!intent.listId) return "I need a list to select.";
      setActiveList(intent.listId);
      return "List selected.";
    }
    case "rename_list": {
      const targetListId = intent.listId ?? state.currentListId;
      const newName = intent.newName?.trim();
      if (!targetListId || !newName) return "I need the list and new name.";
      await updateList(targetListId, { name: newName, userName: getUserLabel() });
      return "List renamed.";
    }
    case "delete_list": {
      const targetListId = intent.listId ?? state.currentListId;
      if (!targetListId) return "No list is selected.";
      await deleteListWithItems({
        listId: targetListId,
        keepItems: Boolean(intent.keepItems),
        defaultListId: state.lists.find((list) => list.isDefault)?.id,
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
  setVoiceStatus("Understanding command...");

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
    await speakResponse(question);
    return;
  }

  pendingClarification = null;

  const response = await runIntent(intent);
  setVoiceStatus(`Executed: ${response}`);
  await speakResponse(response);
}

async function startVoiceRecording() {
  if (recordingActive) return;
  if (!state.user) {
    setVoiceStatus("Sign in to use voice commands.");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordingChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) recordingChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
      if (blob.size > 0) {
        await processVoiceCommand(blob);
      } else {
        setVoiceStatus("No voice captured. Try again.");
      }
    } catch {
      setVoiceStatus("Voice command failed. Try again.");
      await speakResponse("Sorry, I could not process that.");
    } finally {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      recordingChunks = [];
      mediaRecorder = null;
      recordingActive = false;
      elements.voiceHoldBtn.classList.remove("btn-error");
      elements.voiceHoldBtn.textContent = "Hold to talk";
    }
  };

  mediaRecorder.start();
  recordingActive = true;
  elements.voiceHoldBtn.classList.add("btn-error");
  elements.voiceHoldBtn.textContent = "Listening... release to send";
  setVoiceStatus("Listening...");
}

function stopVoiceRecording() {
  if (!recordingActive || !mediaRecorder) return;
  setVoiceStatus("Processing...");
  mediaRecorder.stop();
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
    await updateItem(state.currentListId, itemId, { quantity, userName: getUserLabel() });
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
  renderLists(state, listHandlers);
  renderItems(state, itemHandlers);
  maybeEnsureDefaultList();
  maybeBackfillListOrder();

  elements.voiceHoldBtn.disabled = !state.user;
  setVoiceStatus(state.user ? "Voice idle." : "Signed out. You can use Read list aloud only.");

  if (!state.user) {
    pendingClarification = null;
  }
});

elements.signInBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.warn("Popup sign-in failed, redirecting", error);
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

  await createList({ name, userId: state.user.uid, userName: getUserLabel(), isDefault: false });

  elements.newListForm.reset();
  elements.newListForm.classList.add("hidden");
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

  await createItem({
    listId: state.currentListId,
    text,
    userId: state.user.uid,
    userName: getUserLabel(),
  });
  elements.newItemForm.reset();
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
      defaultListId: state.lists.find((list) => list.isDefault)?.id,
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

elements.voiceHoldBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  void startVoiceRecording();
});

elements.voiceHoldBtn.addEventListener("pointerup", (event) => {
  event.preventDefault();
  stopVoiceRecording();
});

elements.voiceHoldBtn.addEventListener("pointerleave", () => {
  stopVoiceRecording();
});

elements.voiceHoldBtn.addEventListener("pointercancel", () => {
  stopVoiceRecording();
});

elements.voiceReadBtn.addEventListener("click", async () => {
  const text = listReadoutText();
  setVoiceStatus("Reading list...");
  await speakResponse(text);
  setVoiceStatus("Voice idle.");
});

const storedTheme = (localStorage.getItem(themeKey) as "shopping-dark" | "shopping-light" | null) ?? "shopping-dark";
applyTheme(storedTheme);

elements.themeToggle.addEventListener("click", () => {
  const current =
    (document.documentElement.getAttribute("data-theme") as "shopping-dark" | "shopping-light") ?? "shopping-dark";
  const next = current === "shopping-dark" ? "shopping-light" : "shopping-dark";
  localStorage.setItem(themeKey, next);
  applyTheme(next);
});

setAuthUi(state);
setVoiceStatus("Voice idle.");
