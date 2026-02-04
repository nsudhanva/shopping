import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { auth, provider } from "./firebase";
import { elements } from "./elements";
import { state } from "./state";
import type { ListDoc } from "./types";
import {
  clearAllItems,
  clearCheckedItems,
  createItem,
  createList,
  deleteItem,
  deleteListWithItems,
  ensureDefaultListId,
  subscribeItems,
  subscribeLists,
  updateAllItems,
  updateItem,
  updateList,
} from "./firestore";
import { renderItems, renderLists, resetRenameForm, setAuthUi } from "./ui";

let unsubscribeItems: (() => void) | null = null;

function setActiveList(listId: string | null) {
  state.currentListId = listId;
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
    renderItems(state, itemHandlers);
    renderLists(state, listHandlers);
  });
}

function maybeEnsureDefaultList() {
  if (!state.user || !state.listsLoaded || state.ensureDefaultInFlight) return;
  if (state.lists.some((list) => list.isDefault)) return;
  state.ensureDefaultInFlight = true;
  void ensureDefaultListId({ userId: state.user.uid }).finally(() => {
    state.ensureDefaultInFlight = false;
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
};

const itemHandlers = {
  onToggle: async (itemId: string, checked: boolean) => {
    if (!state.user || !state.currentListId) return;
    await updateItem(state.currentListId, itemId, { checked });
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
    await updateItem(state.currentListId, itemId, { text });
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
    await deleteItem(state.currentListId, itemId);
  },
};

subscribeLists((lists) => {
  state.lists = lists;
  state.listsLoaded = true;

  if (!state.currentListId) {
    const defaultList = state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(defaultList?.id ?? null);
  } else if (!state.lists.find((list) => list.id === state.currentListId)) {
    const fallback = state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(fallback?.id ?? null);
  } else {
    renderLists(state, listHandlers);
  }

  maybeEnsureDefaultList();
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  setAuthUi(state);
  maybeEnsureDefaultList();
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

  await createList({ name, userId: state.user.uid, isDefault: false });

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
  await updateList(state.currentListId, { name });
  elements.editListForm.classList.add("hidden");
});

elements.renameListForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const name = elements.renameListInput.value.trim();
  if (!name) return;
  await updateList(state.currentListId, { name });
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

  await createItem({ listId: state.currentListId, text, userId: state.user.uid });
  elements.newItemForm.reset();
});

elements.deleteListBtn.addEventListener("click", () => {
  if (!state.user) return;
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  if (!active) return;
  const defaultCount = state.lists.filter((list) => list.isDefault).length;
  if (active.isDefault && defaultCount <= 1) return;
  elements.deleteDialog.showModal();
});

elements.cancelDeleteBtn.addEventListener("click", () => {
  elements.deleteDialog.close();
});

elements.confirmDeleteBtn.addEventListener("click", async () => {
  if (!state.user) return;
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  if (!active) return;
  const defaultCount = state.lists.filter((list) => list.isDefault).length;
  if (active.isDefault && defaultCount <= 1) return;

  const mode = (document.querySelector(
    "input[name='delete-mode']:checked"
  ) as HTMLInputElement | null)?.value;
  const keepItems = mode === "keep";

  elements.confirmDeleteBtn.disabled = true;
  try {
    await deleteListWithItems({
      listId: active.id,
      keepItems,
      defaultListId: state.lists.find((list) => list.isDefault)?.id,
      userId: state.user.uid,
    });
  } finally {
    elements.confirmDeleteBtn.disabled = false;
    elements.deleteDialog.close();
  }
});

elements.checkAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(state.currentListId, true);
});

elements.uncheckAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(state.currentListId, false);
});

elements.clearCheckedBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear checked items from this list?")) return;
  await clearCheckedItems(state.currentListId);
});

elements.clearAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear all items from this list?")) return;
  await clearAllItems(state.currentListId);
});

setAuthUi(state);
