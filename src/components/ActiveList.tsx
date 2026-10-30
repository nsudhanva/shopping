import { type FormEvent, useState } from "react";
import { clearAllItems, clearCheckedItems, createItem, deleteItem, updateAllItems, updateItem } from "../lib/firestore";
import { maxItemTextLength, roundQuantity } from "../lib/limits";
import { useShopping } from "../lib/shopping";
import type { ItemDoc } from "../lib/types";
import { DeleteListDialog } from "./DeleteListDialog";
import { type ItemActions, ItemRow } from "./ItemRow";
import { RenameListForm } from "./RenameListForm";
import { ViewToolbar } from "./ViewToolbar";
import { VoiceBar } from "./VoiceBar";

function toInitials(label: string): string {
  if (label === "you" || label === "unknown") return label;
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
}

type Authors = { createdBy?: string; createdByName?: string; updatedBy?: string; updatedByName?: string };

function byLine(doc: Authors, uid: string | null) {
  const created = doc.createdBy && doc.createdBy === uid ? "you" : (doc.createdByName ?? "unknown");
  const updated =
    doc.updatedBy && doc.updatedBy === uid ? "you" : (doc.updatedByName ?? doc.createdByName ?? "unknown");
  return `Created by ${toInitials(created)} · Edited by ${toInitials(updated)}`;
}

export function ActiveList() {
  const shopping = useShopping();
  const { editor, currentList, currentListId, listsLoaded, items, itemsLoaded, visibleItems, itemOrderShown } =
    shopping;
  const canEdit = Boolean(editor && currentList);
  const uid = editor?.uid ?? null;

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
  const itemCount = `${items.length} item${items.length === 1 ? "" : "s"}`;
  const countLabel = visibleItems.length === items.length ? itemCount : `${visibleItems.length} of ${itemCount}`;

  async function submitNewItem(event: FormEvent) {
    event.preventDefault();
    const text = newItemText.trim();
    if (!editor || !currentListId || !text) return;
    // Clear the field before the server request, so that text typed during the request stays.
    setNewItemText("");
    await createItem({ listId: currentListId, text, editor });
  }

  async function confirmThen(message: string, action: (listId: string) => Promise<void>) {
    if (!currentListId || !confirm(message)) return;
    await action(currentListId);
  }

  // Runs a write for the shown list. It does nothing when nobody is signed in or no list shows.
  function write(action: (listId: string, by: NonNullable<typeof editor>) => Promise<void>) {
    if (editor && currentListId) void action(currentListId, editor);
  }

  const actions: ItemActions = {
    onToggle: (item, checked) => write((listId, by) => updateItem(listId, item.id, { checked }, by)),
    onEditStart: (item) => setEditing({ itemId: item.id, text: item.text }),
    onEditInput: (text) => setEditing((current) => (current ? { ...current, text } : current)),
    onEditSave: async (item) => {
      const text = editingItem?.text.trim();
      if (!editor || !currentListId || !text) return;
      await updateItem(currentListId, item.id, { text }, editor);
      setEditing(null);
    },
    onEditCancel: () => setEditing(null),
    onDelete: (item) => write((listId, by) => deleteItem(listId, item.id, by)),
    onLongDelete: (item: ItemDoc) => {
      if (confirm(`Delete "${item.text}"?`)) write((listId, by) => deleteItem(listId, item.id, by));
    },
    onQuantityChange: (item, quantity) => {
      const rounded = roundQuantity(quantity);
      if (rounded > 0) write((listId, by) => updateItem(listId, item.id, { quantity: rounded }, by));
    },
    onUnitChange: (item, unit) => write((listId, by) => updateItem(listId, item.id, { unit }, by)),
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
                    {byLine(currentList, uid)}
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
              onClick={() => write((listId, by) => updateAllItems(listId, true, by))}
            >
              Check all
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!canEdit || items.length === 0}
              onClick={() => write((listId, by) => updateAllItems(listId, false, by))}
            >
              Uncheck all
            </button>
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              disabled={!canEdit || checkedCount === 0}
              onClick={() =>
                void confirmThen("Clear checked items from this list?", async (listId) => {
                  if (editor) await clearCheckedItems(listId, editor);
                })
              }
            >
              Clear checked
            </button>
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              disabled={!canEdit || items.length === 0}
              onClick={() =>
                void confirmThen("Clear all items from this list?", async (listId) => {
                  if (editor) await clearAllItems(listId, editor);
                })
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

        <ViewToolbar />

        <ul className="space-y-2">
          {currentList && itemsLoaded && items.length === 0 && (
            <li className="text-center py-8 text-base-content/70">
              {editor ? "Nothing here yet. Add the first item." : "Nothing here yet. Sign in to add items."}
            </li>
          )}
          {items.length > 0 && visibleItems.length === 0 && (
            <li className="text-center py-8 text-base-content/70">No items match the filters.</li>
          )}
          {visibleItems.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === visibleItems.length - 1}
              canMove={itemOrderShown}
              canEdit={canEdit}
              editingText={editingItem?.itemId === item.id ? editingItem.text : null}
              meta={byLine(item, uid)}
              actions={actions}
            />
          ))}
        </ul>
      </div>
      {currentList && <DeleteListDialog list={currentList} open={deleteOpen} onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}
