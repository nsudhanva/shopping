import { elements } from "./elements";
import type { ItemDoc, ListDoc, State } from "./types";

export interface ListHandlers {
  onSelectList: (listId: string) => void;
  onRenameList: (list: ListDoc) => void;
  onMoveList: (listId: string, direction: "up" | "down") => void;
}

export interface ItemHandlers {
  onToggle: (itemId: string, checked: boolean) => void;
  onEditStart: (item: ItemDoc) => void;
  onEditInput: (value: string) => void;
  onEditSave: (itemId: string) => void;
  onEditCancel: () => void;
  onDelete: (itemId: string) => void;
  onLongDelete: (itemId: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onUnitChange: (itemId: string, unit: string) => void;
  onMoveItem: (itemId: string, direction: "up" | "down") => void;
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 900px)").matches;
}

function bindTapAndLongPress(element: HTMLElement, onTap: () => void, onLongPress: () => void) {
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let didLongPress = false;

  const clearHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    didLongPress = false;
    holdTimer = setTimeout(() => {
      didLongPress = true;
      onLongPress();
    }, 600);
  });

  element.addEventListener("pointerup", () => {
    clearHold();
    if (!didLongPress) {
      onTap();
    }
  });

  element.addEventListener("pointercancel", clearHold);
  element.addEventListener("pointerleave", clearHold);
}

function resolveUserLabel(name: string | undefined, id: string | undefined, currentUserId: string | null): string {
  if (id && id === currentUserId) return "you";
  return name ?? "unknown";
}

export function setEditingEnabled(enabled: boolean) {
  elements.newItemInput.disabled = !enabled;
  const submitBtn = elements.newItemForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  if (submitBtn) submitBtn.disabled = !enabled;
  elements.newListBtn.disabled = !enabled;
  elements.newListInput.disabled = !enabled;
  const newListSubmit = elements.newListForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  if (newListSubmit) newListSubmit.disabled = !enabled;
}

export function setAuthUi(state: State) {
  if (state.user) {
    elements.signInBtn.classList.add("hidden");
    elements.signOutBtn.classList.remove("hidden");
    elements.authMeta.classList.remove("hidden");
    elements.authMeta.textContent = state.user.displayName ?? state.user.email ?? "";
    elements.authHint.textContent = "";
  } else {
    elements.signInBtn.classList.remove("hidden");
    elements.signOutBtn.classList.add("hidden");
    elements.authMeta.classList.add("hidden");
    elements.authHint.textContent = "Sign in to add or edit.";
  }
}

export function renderLists(state: State, handlers: ListHandlers) {
  elements.lists.innerHTML = "";
  state.lists.forEach((list, index) => {
    const isFirst = index === 0;
    const isLast = index === state.lists.length - 1;
    const isActive = list.id === state.currentListId;

    // daisyUI menu item
    const li = document.createElement("li");

    // Main clickable area with content and actions
    const wrapper = document.createElement("div");
    wrapper.className = `flex items-center justify-between gap-2 w-full rounded-lg px-3 py-2 cursor-pointer transition-colors ${
      isActive ? "bg-primary/20 text-primary font-semibold" : "hover:bg-base-300"
    }`;

    // Content button (name + badge)
    const content = document.createElement("button");
    content.type = "button";
    content.className = "flex-1 flex flex-col items-start text-left bg-transparent border-none p-0 cursor-pointer";
    content.addEventListener("click", () => {
      handlers.onSelectList(list.id);
      // Close drawer on mobile
      const toggle = document.getElementById("lists-drawer-toggle") as HTMLInputElement;
      if (toggle && isMobileViewport()) toggle.checked = false;
    });

    const name = document.createElement("span");
    name.className = "truncate w-full";
    name.textContent = list.name;
    content.appendChild(name);

    if (list.isDefault) {
      const badge = document.createElement("span");
      badge.className = "badge badge-xs badge-ghost mt-0.5";
      badge.textContent = "Default";
      content.appendChild(badge);
    }

    wrapper.appendChild(content);

    // Actions
    const actions = document.createElement("div");
    actions.className = "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity";
    li.className = "group"; // Enable hover state

    const btnClass = "btn btn-ghost btn-xs btn-square";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = btnClass;
    moveUpBtn.innerHTML = "↑";
    moveUpBtn.title = "Move up";
    moveUpBtn.disabled = !state.user || isFirst;
    moveUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.user || isFirst) return;
      handlers.onMoveList(list.id, "up");
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = btnClass;
    moveDownBtn.innerHTML = "↓";
    moveDownBtn.title = "Move down";
    moveDownBtn.disabled = !state.user || isLast;
    moveDownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.user || isLast) return;
      handlers.onMoveList(list.id, "down");
    });

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn btn-ghost btn-xs";
    renameBtn.textContent = "Rename";
    renameBtn.disabled = !state.user;
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.user) return;
      handlers.onRenameList(list);
    });

    actions.appendChild(moveUpBtn);
    actions.appendChild(moveDownBtn);
    actions.appendChild(renameBtn);
    wrapper.appendChild(actions);

    li.appendChild(wrapper);
    elements.lists.appendChild(li);
  });

  // Update main content area
  const active = state.lists.find((list) => list.id === state.currentListId) ?? null;
  const canDelete = Boolean(active && state.user);
  elements.activeListTitle.textContent = active?.name ?? "No list selected";

  if (active) {
    const countLabel = `${state.items.length} item${state.items.length === 1 ? "" : "s"}`;
    if (isMobileViewport()) {
      // On mobile, show only item count to save space
      elements.activeListSubtitle.textContent = countLabel;
    } else {
      const createdBy = resolveUserLabel(active.createdByName, active.createdBy, state.user?.uid ?? null);
      const updatedBy = resolveUserLabel(
        active.updatedByName ?? active.createdByName,
        undefined,
        state.user?.uid ?? null,
      );
      elements.activeListSubtitle.textContent = `${countLabel} · Created by ${createdBy} · Edited by ${updatedBy}`;
    }
  } else {
    elements.activeListSubtitle.textContent = "";
  }

  elements.deleteListBtn.disabled = !canDelete;
  elements.editListBtn.disabled = !active || !state.user;
  elements.checkAllBtn.disabled = !active || !state.user || state.items.length === 0;
  elements.uncheckAllBtn.disabled = !active || !state.user || state.items.length === 0;
  elements.clearCheckedBtn.disabled = !active || !state.user || state.items.filter((item) => item.checked).length === 0;
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
    empty.className = "text-center py-8 text-base-content/60";
    empty.textContent = state.user
      ? "Nothing here yet. Add the first item."
      : "Nothing here yet. Sign in to add items.";
    elements.items.appendChild(empty);
    return;
  }

  state.items.forEach((item, index) => {
    const isFirst = index === 0;
    const isLast = index === state.items.length - 1;

    // Item card
    const li = document.createElement("li");
    li.className = "card card-compact bg-base-200 shadow-sm";

    const cardBody = document.createElement("div");
    cardBody.className = "card-body p-3 sm:p-4";

    // Desktop layout

    const row1 = document.createElement("div");
    row1.className = "hidden sm:flex items-center gap-4";

    // Left column: Checkbox + Content (text + metadata)
    const desktopLeft = document.createElement("div");
    desktopLeft.className = "flex items-start gap-4 flex-1 min-w-0";

    // Checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox checkbox-primary checkbox-md mt-1";
    checkbox.checked = item.checked;
    checkbox.disabled = !state.user;
    checkbox.addEventListener("change", () => {
      if (!state.user) return;
      handlers.onToggle(item.id, checkbox.checked);
    });
    desktopLeft.appendChild(checkbox);

    // Content wrapper (text + metadata)
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "flex-1 min-w-0";

    // Item text/edit
    if (state.editingItemId === item.id) {
      const input = document.createElement("input");
      input.className = "input input-sm input-bordered w-full";
      input.type = "text";
      input.maxLength = 120;
      input.value = state.editingItemText;
      input.addEventListener("input", () => {
        handlers.onEditInput(input.value);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handlers.onEditSave(item.id);
        }
      });
      contentWrapper.appendChild(input);
      setTimeout(() => input.focus(), 0);
    } else {
      if (state.user) {
        const textButton = document.createElement("button");
        textButton.type = "button";
        textButton.className = `text-left font-medium ${item.checked ? "line-through opacity-50" : ""}`;
        textButton.textContent = item.text;
        bindTapAndLongPress(
          textButton,
          () => handlers.onEditStart(item),
          () => handlers.onLongDelete(item.id),
        );
        contentWrapper.appendChild(textButton);
      } else {
        const text = document.createElement("span");
        text.className = `${item.checked ? "line-through opacity-50" : ""}`;
        text.textContent = item.text;
        contentWrapper.appendChild(text);
      }
    }

    // Metadata (desktop only)
    const createdBy = resolveUserLabel(item.createdByName, item.createdBy, state.user?.uid ?? null);
    const updatedBy = resolveUserLabel(item.updatedByName ?? item.createdByName, undefined, state.user?.uid ?? null);
    const meta = document.createElement("div");
    meta.className = "text-xs text-base-content/50 mt-1";
    meta.textContent = `Created by ${createdBy} · Edited by ${updatedBy}`;
    contentWrapper.appendChild(meta);

    desktopLeft.appendChild(contentWrapper);
    row1.appendChild(desktopLeft);

    // Right column: Controls (vertically centered)
    const desktopRight = document.createElement("div");
    desktopRight.className = "flex items-center gap-2 flex-shrink-0";

    // Quantity controls
    const qtyJoin = document.createElement("div");
    qtyJoin.className = "join";

    const decBtn = document.createElement("button");
    decBtn.type = "button";
    decBtn.className = "btn btn-sm join-item";
    decBtn.textContent = "−";
    decBtn.disabled = !state.user;
    decBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onQuantityChange(item.id, item.quantity - 1);
    });

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.inputMode = "decimal";
    qtyInput.step = "any";
    qtyInput.className = "input input-sm input-bordered join-item w-16 text-center";
    qtyInput.value = String(item.quantity);
    qtyInput.disabled = !state.user;
    qtyInput.addEventListener("change", () => {
      if (!state.user) return;
      const parsed = Number.parseFloat(qtyInput.value);
      if (!Number.isFinite(parsed)) {
        qtyInput.value = String(item.quantity);
        return;
      }
      handlers.onQuantityChange(item.id, parsed);
    });
    qtyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        qtyInput.blur();
      }
    });

    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.className = "btn btn-sm join-item";
    incBtn.textContent = "+";
    incBtn.disabled = !state.user;
    incBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onQuantityChange(item.id, item.quantity + 1);
    });

    qtyJoin.appendChild(decBtn);
    qtyJoin.appendChild(qtyInput);
    qtyJoin.appendChild(incBtn);
    desktopRight.appendChild(qtyJoin);

    // Unit input
    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.className = "input input-sm input-bordered w-20";
    unitInput.placeholder = "unit";
    unitInput.maxLength = 12;
    unitInput.value = item.unit;
    unitInput.disabled = !state.user;
    unitInput.addEventListener("change", () => {
      if (!state.user) return;
      handlers.onUnitChange(item.id, unitInput.value.trim());
    });
    unitInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        unitInput.blur();
      }
    });
    desktopRight.appendChild(unitInput);

    // Move buttons
    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "btn btn-ghost btn-xs btn-square";
    moveUpBtn.innerHTML = "↑";
    moveUpBtn.title = "Move up";
    moveUpBtn.disabled = !state.user || isFirst;
    moveUpBtn.addEventListener("click", () => {
      if (!state.user || isFirst) return;
      handlers.onMoveItem(item.id, "up");
    });
    desktopRight.appendChild(moveUpBtn);

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "btn btn-ghost btn-xs btn-square";
    moveDownBtn.innerHTML = "↓";
    moveDownBtn.title = "Move down";
    moveDownBtn.disabled = !state.user || isLast;
    moveDownBtn.addEventListener("click", () => {
      if (!state.user || isLast) return;
      handlers.onMoveItem(item.id, "down");
    });
    desktopRight.appendChild(moveDownBtn);

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-ghost btn-xs";
    editBtn.textContent = "Edit";
    editBtn.disabled = !state.user;
    editBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onEditStart(item);
    });
    desktopRight.appendChild(editBtn);

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-error btn-xs btn-outline";
    deleteBtn.textContent = "Delete";
    deleteBtn.disabled = !state.user;
    deleteBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onDelete(item.id);
    });
    desktopRight.appendChild(deleteBtn);

    // Editing mode buttons for desktop
    if (state.editingItemId === item.id) {
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary btn-sm";
      saveBtn.textContent = "Save";
      saveBtn.disabled = !state.user;
      saveBtn.addEventListener("click", () => handlers.onEditSave(item.id));
      desktopRight.appendChild(saveBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-ghost btn-sm";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => handlers.onEditCancel());
      desktopRight.appendChild(cancelBtn);
    }

    row1.appendChild(desktopRight);

    cardBody.appendChild(row1);

    // Mobile layout
    const mobileContainer = document.createElement("div");
    mobileContainer.className = "sm:hidden flex items-center gap-3";

    // Left column: Checkbox + Item text
    const mobileLeft = document.createElement("div");
    mobileLeft.className = "flex items-center gap-3 flex-1 min-w-0";

    const mobileCheckbox = document.createElement("input");
    mobileCheckbox.type = "checkbox";
    mobileCheckbox.className = "checkbox checkbox-primary checkbox-md flex-shrink-0";
    mobileCheckbox.checked = item.checked;
    mobileCheckbox.disabled = !state.user;
    mobileCheckbox.addEventListener("change", () => {
      if (!state.user) return;
      handlers.onToggle(item.id, mobileCheckbox.checked);
    });
    mobileLeft.appendChild(mobileCheckbox);

    if (state.editingItemId === item.id) {
      const mobileInput = document.createElement("input");
      mobileInput.className = "input input-sm input-bordered flex-1 min-w-0";
      mobileInput.type = "text";
      mobileInput.maxLength = 120;
      mobileInput.value = state.editingItemText;
      mobileInput.addEventListener("input", () => {
        handlers.onEditInput(mobileInput.value);
      });
      mobileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handlers.onEditSave(item.id);
        }
      });
      mobileLeft.appendChild(mobileInput);
      setTimeout(() => mobileInput.focus(), 0);
    } else {
      if (state.user) {
        const mobileTextBtn = document.createElement("button");
        mobileTextBtn.type = "button";
        mobileTextBtn.className = `text-base font-medium truncate ${item.checked ? "line-through opacity-50" : ""}`;
        mobileTextBtn.textContent = item.text;
        bindTapAndLongPress(
          mobileTextBtn,
          () => handlers.onEditStart(item),
          () => handlers.onLongDelete(item.id),
        );
        mobileLeft.appendChild(mobileTextBtn);
      } else {
        const mobileText = document.createElement("span");
        mobileText.className = `text-base truncate ${item.checked ? "line-through opacity-50" : ""}`;
        mobileText.textContent = item.text;
        mobileLeft.appendChild(mobileText);
      }
    }

    // Right column: Controls stacked vertically (centered)
    const mobileRight = document.createElement("div");
    mobileRight.className = "flex flex-col items-center gap-1 flex-shrink-0";

    // Quantity controls
    const mobileQtyJoin = document.createElement("div");
    mobileQtyJoin.className = "join";

    const mobileDecBtn = document.createElement("button");
    mobileDecBtn.type = "button";
    mobileDecBtn.className = "btn btn-xs join-item";
    mobileDecBtn.textContent = "−";
    mobileDecBtn.disabled = !state.user;
    mobileDecBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onQuantityChange(item.id, item.quantity - 1);
    });

    const mobileQtyInput = document.createElement("input");
    mobileQtyInput.type = "number";
    mobileQtyInput.inputMode = "decimal";
    mobileQtyInput.step = "any";
    mobileQtyInput.className = "input input-xs input-bordered join-item w-10 text-center";
    mobileQtyInput.value = String(item.quantity);
    mobileQtyInput.disabled = !state.user;
    mobileQtyInput.addEventListener("change", () => {
      if (!state.user) return;
      const parsed = Number.parseFloat(mobileQtyInput.value);
      if (!Number.isFinite(parsed)) {
        mobileQtyInput.value = String(item.quantity);
        return;
      }
      handlers.onQuantityChange(item.id, parsed);
    });

    const mobileIncBtn = document.createElement("button");
    mobileIncBtn.type = "button";
    mobileIncBtn.className = "btn btn-xs join-item";
    mobileIncBtn.textContent = "+";
    mobileIncBtn.disabled = !state.user;
    mobileIncBtn.addEventListener("click", () => {
      if (!state.user) return;
      handlers.onQuantityChange(item.id, item.quantity + 1);
    });

    mobileQtyJoin.appendChild(mobileDecBtn);
    mobileQtyJoin.appendChild(mobileQtyInput);
    mobileQtyJoin.appendChild(mobileIncBtn);
    mobileRight.appendChild(mobileQtyJoin);

    // Delete button (or editing buttons)
    if (state.editingItemId === item.id) {
      const mobileEditActions = document.createElement("div");
      mobileEditActions.className = "flex gap-1";

      const mobileSaveBtn = document.createElement("button");
      mobileSaveBtn.type = "button";
      mobileSaveBtn.className = "btn btn-primary btn-xs";
      mobileSaveBtn.textContent = "Save";
      mobileSaveBtn.disabled = !state.user;
      mobileSaveBtn.addEventListener("click", () => handlers.onEditSave(item.id));

      const mobileCancelBtn = document.createElement("button");
      mobileCancelBtn.type = "button";
      mobileCancelBtn.className = "btn btn-ghost btn-xs";
      mobileCancelBtn.textContent = "Cancel";
      mobileCancelBtn.addEventListener("click", () => handlers.onEditCancel());

      mobileEditActions.appendChild(mobileSaveBtn);
      mobileEditActions.appendChild(mobileCancelBtn);
      mobileRight.appendChild(mobileEditActions);
    } else {
      const mobileDeleteBtn = document.createElement("button");
      mobileDeleteBtn.type = "button";
      mobileDeleteBtn.className = "btn btn-error btn-xs btn-outline";
      mobileDeleteBtn.textContent = "Delete";
      mobileDeleteBtn.disabled = !state.user;
      mobileDeleteBtn.addEventListener("click", () => {
        if (!state.user) return;
        handlers.onDelete(item.id);
      });
      mobileRight.appendChild(mobileDeleteBtn);
    }

    mobileContainer.appendChild(mobileLeft);
    mobileContainer.appendChild(mobileRight);
    cardBody.appendChild(mobileContainer);

    li.appendChild(cardBody);
    elements.items.appendChild(li);
  });
}

export function resetRenameForm() {
  elements.renameListForm.reset();
  elements.renameListForm.classList.add("hidden");
}
