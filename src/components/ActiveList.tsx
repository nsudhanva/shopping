import { type FormEvent, useState } from "react";
import { clearAllItems, clearCheckedItems, createItem, deleteItem, updateAllItems, updateItem } from "../lib/firestore";
import { maxItemTextLength, roundQuantity } from "../lib/limits";
import { useShopping } from "../lib/shopping";
import type { ItemDoc } from "../lib/types";
import { DeleteListDialog } from "./DeleteListDialog";
import { type ItemActions, ItemRow } from "./ItemRow";
import { RenameListForm } from "./RenameListForm";
import { VoiceBar } from "./VoiceBar";

function toInitials(label: string): string {
  if (label === "you" || label === "unknown") return label;
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function byLine(
  createdByName: string | undefined,
  createdBy: string | undefined,
  updatedByName: string | undefined,
  uid: string | null,
) {
  const created = createdBy && createdBy === uid ? "you" : (createdByName ?? "unknown");
  const updated = updatedByName ?? createdByName ?? "unknown";
  return `Created by ${toInitials(created)} · Edited by ${toInitials(updated)}`;
}

export function ActiveList() {
  const shopping = useShopping();
  const { user, userName, currentList, currentListId, listsLoaded, items, itemsLoaded } = shopping;
  const canEdit = Boolean(user && currentList);
  const uid = user?.uid ?? null;

  const [renaming, setRenaming] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [editing, setEditing] = useState<{ itemId: string; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Per-list UI state resets when a different list shows. Do not use a key on this component for this.
  // VoiceBar is inside it, and a voice command that changes the list must not unmount VoiceBar.
  const [shownListId, setShownListId] = useState(currentListId);
  if (shownListId !== currentListId) {
    setShownListId(currentListId);
    setRenaming(false);
    setEditing(null);
    setDeleteOpen(false);
  }

  // Use the edit state only while its item is in the list on screen.
  const editingItem = editing && items.some((item) => item.id === editing.itemId) ? editing : null;
  const checkedCount = items.filter((item) => item.checked).length;
  const countLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;

  async function submitNewItem(event: FormEvent) {
    event.preventDefault();
    const text = newItemText.trim();
    if (!user || !currentListId || !text) return;
    // Clear the field before the server request, so that text typed during the request stays.
    setNewItemText("");
    await createItem({ listId: currentListId, text, userId: user.uid, userName });
  }

  async function confirmThen(message: string, action: (listId: string) => Promise<void>) {
    if (!user || !currentListId) return;
    if (!confirm(message)) return;
    await action(currentListId);
  }

  const actions: ItemActions = {
    onToggle: (item, checked) => {
      if (currentListId) void updateItem(currentListId, item.id, { checked, userName });
    },
    onEditStart: (item) => setEditing({ itemId: item.id, text: item.text }),
    onEditInput: (text) => setEditing((current) => (current ? { ...current, text } : current)),
    onEditSave: async (item) => {
      const text = editingItem?.text.trim();
      if (!currentListId || !text) return;
      await updateItem(currentListId, item.id, { text, userName });
      setEditing(null);
    },
    onEditCancel: () => setEditing(null),
    onDelete: (item) => {
      if (currentListId) void deleteItem(currentListId, item.id, userName);
    },
    onLongDelete: (item: ItemDoc) => {
      if (currentListId && confirm(`Delete "${item.text}"?`)) void deleteItem(currentListId, item.id, userName);
    },
    onQuantityChange: (item, quantity) => {
      const rounded = roundQuantity(quantity);
      if (currentListId && rounded > 0) void updateItem(currentListId, item.id, { quantity: rounded, userName });
    },
    onUnitChange: (item, unit) => {
      if (currentListId) void updateItem(currentListId, item.id, { unit, userName });
    },
    onMove: (item, direction) => void shopping.moveItem(item.id, direction),
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="card-title text-2xl">
                {currentList?.name ?? (listsLoaded ? "No list selected" : "Loading…")}
              </h2>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!canEdit}
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
            </div>
            {renaming && currentList && canEdit && (
              <RenameListForm
                listId={currentList.id}
                initialName={currentList.name}
                layout="inline"
                onDone={() => setRenaming(false)}
              />
            )}
            {/* A fixed height prevents a layout shift when this line appears after the data loads. */}
            <p className="text-sm text-muted mt-1 min-h-5">
              {currentList && (
                <>
                  {countLabel}
                  <span className="hidden sm:inline">
                    {" · "}
                    {byLine(currentList.createdByName, currentList.createdBy, currentList.updatedByName, uid)}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!canEdit || items.length === 0}
              onClick={() => currentListId && void updateAllItems(currentListId, true, userName)}
            >
              Check all
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!canEdit || items.length === 0}
              onClick={() => currentListId && void updateAllItems(currentListId, false, userName)}
            >
              Uncheck all
            </button>
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              disabled={!canEdit || checkedCount === 0}
              onClick={() =>
                void confirmThen("Clear checked items from this list?", (listId) => clearCheckedItems(listId, userName))
              }
            >
              Clear checked
            </button>
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              disabled={!canEdit || items.length === 0}
              onClick={() =>
                void confirmThen("Clear all items from this list?", (listId) => clearAllItems(listId, userName))
              }
            >
              Clear all
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm"
              disabled={!canEdit}
              onClick={() => setDeleteOpen(true)}
            >
              Delete list
            </button>
          </div>
        </div>

        <form className="flex gap-2 mb-6" onSubmit={submitNewItem}>
          <input
            type="text"
            name="text"
            placeholder="Add an item"
            aria-label="Add an item"
            maxLength={maxItemTextLength}
            required
            disabled={!canEdit}
            value={newItemText}
            onChange={(event) => setNewItemText(event.target.value)}
            className="input input-bordered flex-1"
          />
          <button type="submit" className="btn btn-primary" disabled={!canEdit}>
            Add
          </button>
        </form>

        <VoiceBar />

        <ul className="space-y-2">
          {currentList && itemsLoaded && items.length === 0 && (
            <li className="text-center py-8 text-base-content/70">
              {user ? "Nothing here yet. Add the first item." : "Nothing here yet. Sign in to add items."}
            </li>
          )}
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              canEdit={canEdit}
              editingText={editingItem?.itemId === item.id ? editingItem.text : null}
              meta={byLine(item.createdByName, item.createdBy, item.updatedByName, uid)}
              actions={actions}
            />
          ))}
        </ul>
      </div>
      {currentList && <DeleteListDialog list={currentList} open={deleteOpen} onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}
