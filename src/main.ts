import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  orderBy,
  query,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDjK2UwzJpl_f-PhTCTHz_EENkypKiI7Jg",
  authDomain: "sudhanva-personal.firebaseapp.com",
  projectId: "sudhanva-personal",
  storageBucket: "sudhanva-personal.firebasestorage.app",
  messagingSenderId: "677321535908",
  appId: "1:677321535908:web:1e074c401cb1503df75131",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

void setPersistence(auth, browserLocalPersistence);

type ListDoc = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  isDefault: boolean;
};

type ItemDoc = {
  id: string;
  text: string;
  checked: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
};

type State = {
  user: import("firebase/auth").User | null;
  lists: ListDoc[];
  items: ItemDoc[];
  currentListId: string | null;
  listsLoaded: boolean;
  ensureDefaultInFlight: boolean;
  editingItemId: string | null;
  editingItemText: string;
};

const state: State = {
  user: null,
  lists: [],
  items: [],
  currentListId: null,
  listsLoaded: false,
  ensureDefaultInFlight: false,
  editingItemId: null,
  editingItemText: "",
};

const elements = {
  signInBtn: document.querySelector<HTMLButtonElement>("#sign-in-btn")!,
  signOutBtn: document.querySelector<HTMLButtonElement>("#sign-out-btn")!,
  authMeta: document.querySelector<HTMLDivElement>("#auth-meta")!,
  authHint: document.querySelector<HTMLElement>("#auth-hint")!,
  lists: document.querySelector<HTMLUListElement>("#lists")!,
  newListBtn: document.querySelector<HTMLButtonElement>("#new-list-btn")!,
  newListForm: document.querySelector<HTMLFormElement>("#new-list-form")!,
  newListInput: document.querySelector<HTMLInputElement>("#new-list-input")!,
  cancelListBtn: document.querySelector<HTMLButtonElement>("#cancel-list-btn")!,
  editListBtn: document.querySelector<HTMLButtonElement>("#edit-list-btn")!,
  editListForm: document.querySelector<HTMLFormElement>("#edit-list-form")!,
  editListInput: document.querySelector<HTMLInputElement>("#edit-list-input")!,
  cancelEditListBtn: document.querySelector<HTMLButtonElement>("#cancel-edit-list-btn")!,
  renameListForm: document.querySelector<HTMLFormElement>("#rename-list-form")!,
  renameListInput: document.querySelector<HTMLInputElement>("#rename-list-input")!,
  cancelRenameListBtn: document.querySelector<HTMLButtonElement>("#cancel-rename-list-btn")!,
  checkAllBtn: document.querySelector<HTMLButtonElement>("#check-all-btn")!,
  uncheckAllBtn: document.querySelector<HTMLButtonElement>("#uncheck-all-btn")!,
  clearCheckedBtn: document.querySelector<HTMLButtonElement>("#clear-checked-btn")!,
  clearAllBtn: document.querySelector<HTMLButtonElement>("#clear-all-btn")!,
  activeListTitle: document.querySelector<HTMLHeadingElement>("#active-list-title")!,
  activeListSubtitle: document.querySelector<HTMLParagraphElement>("#active-list-subtitle")!,
  deleteListBtn: document.querySelector<HTMLButtonElement>("#delete-list-btn")!,
  newItemForm: document.querySelector<HTMLFormElement>("#new-item-form")!,
  newItemInput: document.querySelector<HTMLInputElement>("#new-item-input")!,
  items: document.querySelector<HTMLUListElement>("#items")!,
  deleteDialog: document.querySelector<HTMLDialogElement>("#delete-list-dialog")!,
  confirmDeleteBtn: document.querySelector<HTMLButtonElement>("#confirm-delete-btn")!,
  cancelDeleteBtn: document.querySelector<HTMLButtonElement>("#cancel-delete-btn")!,
};

function setEditingEnabled(enabled: boolean) {
  elements.newListBtn.disabled = !enabled;
  elements.newListInput.disabled = !enabled;
  elements.newItemInput.disabled = !enabled;
  elements.deleteListBtn.disabled = !enabled;
  elements.newItemForm.querySelector("button")!.disabled = !enabled;
  elements.editListBtn.disabled = !enabled;
  elements.checkAllBtn.disabled = !enabled;
  elements.clearAllBtn.disabled = !enabled;
}

function setAuthUi() {
  if (state.user) {
    elements.signInBtn.classList.add("hidden");
    elements.signOutBtn.classList.remove("hidden");
    elements.authMeta.classList.remove("hidden");
    elements.authMeta.textContent = state.user.displayName ?? state.user.email ?? "Signed in";
    elements.authHint.textContent = "Signed in to edit.";
    setEditingEnabled(true);
  } else {
    elements.signInBtn.classList.remove("hidden");
    elements.signOutBtn.classList.add("hidden");
    elements.authMeta.classList.add("hidden");
    elements.authHint.textContent = "Sign in to add or edit.";
    setEditingEnabled(false);
  }
}

function setActiveList(listId: string | null) {
  state.currentListId = listId;
  state.items = [];
  state.editingItemId = null;
  state.editingItemText = "";
  elements.renameListForm.classList.add("hidden");
  renderItems();
  renderLists();
  subscribeItems();
}

function getActiveList(): ListDoc | null {
  if (!state.currentListId) return null;
  return state.lists.find((list) => list.id === state.currentListId) ?? null;
}

function renderLists() {
  elements.lists.innerHTML = "";
  state.lists.forEach((list) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = list.name;
    if (list.id === state.currentListId) {
      button.classList.add("active");
    }
    if (list.isDefault) {
      const note = document.createElement("small");
      note.textContent = "Default";
      button.appendChild(note);
    }
    button.addEventListener("click", () => {
      setActiveList(list.id);
    });
    li.appendChild(button);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "secondary";
    renameBtn.textContent = "Rename";
    renameBtn.disabled = !state.user;
    renameBtn.addEventListener("click", () => {
      if (!state.user) return;
      setActiveList(list.id);
      elements.renameListInput.value = list.name;
      elements.renameListForm.classList.remove("hidden");
      elements.renameListInput.focus();
    });

    li.appendChild(renameBtn);
    elements.lists.appendChild(li);
  });

  const active = getActiveList();
  elements.activeListTitle.textContent = active?.name ?? "No list selected";
  elements.activeListSubtitle.textContent = active
    ? `${state.items.length} item${state.items.length === 1 ? "" : "s"}`
    : "";
  elements.deleteListBtn.disabled = !active || !state.user || active.isDefault;
  elements.editListBtn.disabled = !active || !state.user;
  elements.checkAllBtn.disabled = !active || !state.user || state.items.length === 0;
  elements.uncheckAllBtn.disabled = !active || !state.user || state.items.length === 0;
  elements.clearCheckedBtn.disabled =
    !active || !state.user || state.items.filter((item) => item.checked).length === 0;
  elements.clearAllBtn.disabled = !active || !state.user || state.items.length === 0;
  if (!active) {
    elements.editListForm.classList.add("hidden");
  }
}

function renderItems() {
  elements.items.innerHTML = "";
  if (!state.currentListId) return;

  if (state.items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = state.user
      ? "Nothing here yet. Add the first item."
      : "Nothing here yet. Sign in to add items.";
    elements.items.appendChild(empty);
    return;
  }

  state.items.forEach((item) => {
    const li = document.createElement("li");
    const main = document.createElement("div");
    main.className = "item-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.checked;
    checkbox.disabled = !state.user;

    checkbox.addEventListener("change", async () => {
      if (!state.user) return;
      await updateDoc(doc(db, "lists", state.currentListId!, "items", item.id), {
        checked: checkbox.checked,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "lists", state.currentListId!), {
        updatedAt: serverTimestamp(),
      });
    });

    main.appendChild(checkbox);
    if (state.editingItemId === item.id) {
      const input = document.createElement("input");
      input.className = "item-edit-input";
      input.type = "text";
      input.maxLength = 120;
      input.value = state.editingItemText;
      input.addEventListener("input", () => {
        state.editingItemText = input.value;
      });
      input.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          await saveItemEdit(item.id);
        }
      });
      main.appendChild(input);
    } else {
      const text = document.createElement("span");
      text.className = "item-text" + (item.checked ? " checked" : "");
      text.textContent = item.text;
      main.appendChild(text);
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";

    if (state.editingItemId === item.id) {
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.textContent = "Save";
      saveBtn.disabled = !state.user;
      saveBtn.addEventListener("click", async () => {
        await saveItemEdit(item.id);
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        state.editingItemId = null;
        state.editingItemText = "";
        renderItems();
      });

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
    } else {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Edit";
      editBtn.disabled = !state.user;
      editBtn.addEventListener("click", () => {
        if (!state.user) return;
        state.editingItemId = item.id;
        state.editingItemText = item.text;
        renderItems();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = !state.user;
      deleteBtn.addEventListener("click", async () => {
        if (!state.user) return;
        await deleteDoc(doc(db, "lists", state.currentListId!, "items", item.id));
        await updateDoc(doc(db, "lists", state.currentListId!), {
          updatedAt: serverTimestamp(),
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
    }

    li.appendChild(main);
    li.appendChild(actions);
    elements.items.appendChild(li);
  });
}

async function ensureDefaultListId(): Promise<string> {
  const existing = state.lists.find((list) => list.isDefault);
  if (existing) return existing.id;
  if (!state.user) throw new Error("Not signed in");

  const ref = await addDoc(collection(db, "lists"), {
    name: "Inbox",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: state.user.uid,
    isDefault: true,
  });
  return ref.id;
}

function maybeEnsureDefaultList() {
  if (!state.user || !state.listsLoaded || state.ensureDefaultInFlight) return;
  if (state.lists.some((list) => list.isDefault)) return;
  state.ensureDefaultInFlight = true;
  void ensureDefaultListId().finally(() => {
    state.ensureDefaultInFlight = false;
  });
}

async function saveItemEdit(itemId: string) {
  if (!state.user || !state.currentListId) return;
  const text = state.editingItemText.trim();
  if (!text) return;
  await updateDoc(doc(db, "lists", state.currentListId, "items", itemId), {
    text,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "lists", state.currentListId), {
    updatedAt: serverTimestamp(),
  });
  state.editingItemId = null;
  state.editingItemText = "";
}

async function updateAllItems(checked: boolean) {
  if (!state.user || !state.currentListId) return;
  const itemsSnap = await getDocs(collection(db, "lists", state.currentListId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.update(item.ref, {
        checked,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await updateDoc(doc(db, "lists", state.currentListId), {
    updatedAt: serverTimestamp(),
  });
}

async function clearAllItems() {
  if (!state.user || !state.currentListId) return;
  const itemsSnap = await getDocs(collection(db, "lists", state.currentListId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
  await updateDoc(doc(db, "lists", state.currentListId), {
    updatedAt: serverTimestamp(),
  });
}

async function clearCheckedItems() {
  if (!state.user || !state.currentListId) return;
  const itemsSnap = await getDocs(collection(db, "lists", state.currentListId, "items"));
  const checkedDocs = itemsSnap.docs.filter((docSnap) => Boolean(docSnap.data().checked));
  const batches = chunkDocs(checkedDocs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
  await updateDoc(doc(db, "lists", state.currentListId), {
    updatedAt: serverTimestamp(),
  });
}

function chunkDocs<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function deleteList(listId: string, keepItems: boolean) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const itemDocs = itemsSnap.docs;
  const defaultListId = keepItems ? await ensureDefaultListId() : null;

  const batches = chunkDocs(itemDocs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      if (keepItems && defaultListId) {
        const targetRef = doc(db, "lists", defaultListId, "items", item.id);
        const data = item.data();
        batch.set(targetRef, {
          text: String(data.text ?? ""),
          checked: Boolean(data.checked),
          createdAt: data.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: state.user!.uid,
        });
      }
      batch.delete(item.ref);
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, "lists", listId));
}

let unsubscribeItems: (() => void) | null = null;

function subscribeItems() {
  if (unsubscribeItems) {
    unsubscribeItems();
    unsubscribeItems = null;
  }

  if (!state.currentListId) {
    state.items = [];
    renderItems();
    return;
  }

  const itemsQuery = query(
    collection(db, "lists", state.currentListId, "items"),
    orderBy("createdAt", "asc")
  );

  unsubscribeItems = onSnapshot(itemsQuery, (snapshot) => {
    state.items = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        text: String(data.text ?? ""),
        checked: Boolean(data.checked),
        createdAt: data.createdAt?.toDate?.() ?? new Date(),
        updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
        createdBy: String(data.createdBy ?? ""),
      } satisfies ItemDoc;
    });
    if (state.editingItemId && !state.items.find((item) => item.id === state.editingItemId)) {
      state.editingItemId = null;
      state.editingItemText = "";
    }
    renderItems();
    renderLists();
  });
}

const listsQuery = query(collection(db, "lists"), orderBy("updatedAt", "desc"));

onSnapshot(listsQuery, (snapshot) => {
  state.lists = snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: String(data.name ?? "Untitled"),
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
      updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
      createdBy: String(data.createdBy ?? ""),
      isDefault: Boolean(data.isDefault),
    } satisfies ListDoc;
  });

  state.listsLoaded = true;

  if (!state.currentListId) {
    const defaultList = state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(defaultList?.id ?? null);
  } else if (!state.lists.find((list) => list.id === state.currentListId)) {
    const fallback = state.lists.find((list) => list.isDefault) ?? state.lists[0];
    setActiveList(fallback?.id ?? null);
  } else {
    renderLists();
  }

  maybeEnsureDefaultList();
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  setAuthUi();
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

  await addDoc(collection(db, "lists"), {
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: state.user.uid,
    isDefault: false,
  });

  elements.newListForm.reset();
  elements.newListForm.classList.add("hidden");
});

elements.editListBtn.addEventListener("click", () => {
  if (!state.user) return;
  const active = getActiveList();
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
  await updateDoc(doc(db, "lists", state.currentListId), {
    name,
    updatedAt: serverTimestamp(),
  });
  elements.editListForm.classList.add("hidden");
});

elements.renameListForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const name = elements.renameListInput.value.trim();
  if (!name) return;
  await updateDoc(doc(db, "lists", state.currentListId), {
    name,
    updatedAt: serverTimestamp(),
  });
  elements.renameListForm.classList.add("hidden");
});

elements.cancelRenameListBtn.addEventListener("click", () => {
  elements.renameListForm.reset();
  elements.renameListForm.classList.add("hidden");
});

elements.newItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user || !state.currentListId) return;
  const text = elements.newItemInput.value.trim();
  if (!text) return;

  await addDoc(collection(db, "lists", state.currentListId, "items"), {
    text,
    checked: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: state.user.uid,
  });

  await updateDoc(doc(db, "lists", state.currentListId), {
    updatedAt: serverTimestamp(),
  });

  elements.newItemForm.reset();
});

elements.deleteListBtn.addEventListener("click", () => {
  if (!state.user) return;
  const active = getActiveList();
  if (!active) return;
  if (active.isDefault) return;
  elements.deleteDialog.showModal();
});

elements.checkAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(true);
});

elements.uncheckAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  await updateAllItems(false);
});

elements.clearCheckedBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear checked items from this list?")) return;
  await clearCheckedItems();
});

elements.clearAllBtn.addEventListener("click", async () => {
  if (!state.user || !state.currentListId) return;
  if (!confirm("Clear all items from this list?")) return;
  await clearAllItems();
});

elements.cancelDeleteBtn.addEventListener("click", () => {
  elements.deleteDialog.close();
});

elements.confirmDeleteBtn.addEventListener("click", async () => {
  if (!state.user) return;
  const active = getActiveList();
  if (!active) return;
  if (active.isDefault) return;

  const mode = (document.querySelector(
    "input[name='delete-mode']:checked"
  ) as HTMLInputElement | null)?.value;
  const keepItems = mode === "keep";

  elements.confirmDeleteBtn.disabled = true;
  try {
    await deleteList(active.id, keepItems);
  } finally {
    elements.confirmDeleteBtn.disabled = false;
    elements.deleteDialog.close();
  }
});

setAuthUi();
