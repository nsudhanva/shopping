import type { ItemDoc, ListDoc, State } from "./types";
import { elements } from "./elements";

export type ListHandlers = {
  onSelectList: (listId: string) => void;
  onRenameList: (list: ListDoc) => void;
};

export type ItemHandlers = {
  onToggle: (itemId: string, checked: boolean) => void;
  onEditStart: (item: ItemDoc) => void;
  onEditInput: (value: string) => void;
  onEditSave: (itemId: string) => void;
  onEditCancel: () => void;
  onDelete: (itemId: string) => void;
};

export function setEditingEnabled(enabled: boolean) {
  elements.newListBtn.disabled = !enabled;
  elements.newListInput.disabled = !enabled;
  elements.newItemInput.disabled = !enabled;
  elements.deleteListBtn.disabled = !enabled;
  elements.newItemForm.querySelector("button")!.disabled = !enabled;
  elements.editListBtn.disabled = !enabled;
  elements.checkAllBtn.disabled = !enabled;
  elements.uncheckAllBtn.disabled = !enabled;
  elements.clearCheckedBtn.disabled = !enabled;
  elements.clearAllBtn.disabled = !enabled;
}

export function setAuthUi(state: State) {
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

export function renderLists(state: State, handlers: ListHandlers) {
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
      handlers.onSelectList(list.id);
    });
    li.appendChild(button);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "secondary";
    renameBtn.textContent = "Rename";
    renameBtn.disabled = !state.user;
    renameBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onRenameList(list);
    });

    li.appendChild(renameBtn);
    elements.lists.appendChild(li);
  });

  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  const defaultCount = state.lists.filter((list) => list.isDefault).length;
  const canDelete = Boolean(
    active && state.user && !(active.isDefault && defaultCount <= 1)
  );
  elements.activeListTitle.textContent = active?.name ?? "No list selected";
  elements.activeListSubtitle.textContent = active
    ? `${state.items.length} item${state.items.length === 1 ? "" : "s"}`
    : "";
  elements.deleteListBtn.disabled = !canDelete;
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

export function renderItems(state: State, handlers: ItemHandlers) {
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

    checkbox.addEventListener("change", () => {
      if (!state.user) return;
      handlers.onToggle(item.id, checkbox.checked);
    });

    main.appendChild(checkbox);

    if (state.editingItemId === item.id) {
      const input = document.createElement("input");
      input.className = "item-edit-input";
      input.type = "text";
      input.maxLength = 120;
      input.value = state.editingItemText;
      input.addEventListener("input", () => {
        handlers.onEditInput(input.value);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handlers.onEditSave(item.id);
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
      saveBtn.addEventListener("click", () => {
        handlers.onEditSave(item.id);
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        handlers.onEditCancel();
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
        handlers.onEditStart(item);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = !state.user;
      deleteBtn.addEventListener("click", () => {
        if (!state.user) return;
        handlers.onDelete(item.id);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
    }

    li.appendChild(main);
    li.appendChild(actions);
    elements.items.appendChild(li);
  });
}

export function resetRenameForm() {
  elements.renameListForm.reset();
  elements.renameListForm.classList.add("hidden");
}
