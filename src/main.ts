import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { elements } from "./elements";
import { auth, provider } from "./firebase";
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
