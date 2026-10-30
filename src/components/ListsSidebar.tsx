import { type FormEvent, useState } from "react";
import { createList } from "../lib/firestore";
import { maxListNameLength } from "../lib/limits";
import { useShopping } from "../lib/shopping";
import { RenameListForm } from "./RenameListForm";

export function ListsSidebar(props: { onListChosen: () => void }) {
  const shopping = useShopping();
  const { user, userName, lists, currentListId } = shopping;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ listId: string; name: string } | null>(null);

  async function submitNewList(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!user || !name) return;
    setNewName("");
    setCreating(false);
    const listId = await createList({ name, userId: user.uid, userName, isDefault: false });
    shopping.selectList(listId);
  }

  return (
    <aside className="bg-base-100 min-h-full w-72 p-4" aria-label="Lists">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Lists</h2>
        <button type="button" className="btn btn-primary btn-sm" disabled={!user} onClick={() => setCreating(true)}>
          + New
        </button>
      </div>

      {creating && (
        <form className="space-y-3 mb-4" onSubmit={submitNewList}>
          <input
            type="text"
            name="name"
            placeholder="List name"
            aria-label="List name"
            maxLength={maxListNameLength}
            required
            // biome-ignore lint/a11y/noAutofocus: the user opens this form with the "+ New" button.
            autoFocus
            disabled={!user}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className="input input-bordered input-sm w-full"
          />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm flex-1" disabled={!user}>
              Create
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm flex-1"
              onClick={() => {
                setNewName("");
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="menu menu-sm bg-base-200 rounded-box w-full">
        {lists.map((list, index) => {
          const isActive = list.id === currentListId;
          return (
            <li key={list.id} className="group">
              <div
                className={`flex items-center justify-between gap-2 w-full rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  isActive ? "bg-primary/20 text-primary font-semibold" : "hover:bg-base-300"
                }`}
              >
                <button
                  type="button"
                  className="flex-1 flex flex-col items-start text-left bg-transparent border-none p-0 cursor-pointer min-w-0"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    shopping.selectList(list.id);
                    props.onListChosen();
                  }}
                >
                  <span className="truncate w-full">{list.name}</span>
                  {list.isDefault && <span className="badge badge-xs badge-ghost mt-0.5">Default</span>}
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label={`Move ${list.name} up`}
                    title="Move up"
                    disabled={!user || index === 0}
                    onClick={() => void shopping.moveList(list.id, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    aria-label={`Move ${list.name} down`}
                    title="Move down"
                    disabled={!user || index === lists.length - 1}
                    onClick={() => void shopping.moveList(list.id, "down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    aria-label={`Rename ${list.name}`}
                    disabled={!user}
                    onClick={() => {
                      shopping.selectList(list.id);
                      setRenaming({ listId: list.id, name: list.name });
                    }}
                  >
                    Rename
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {renaming && (
        <RenameListForm
          key={renaming.listId}
          listId={renaming.listId}
          initialName={renaming.name}
          layout="stacked"
          onDone={() => setRenaming(null)}
        />
      )}

      <div className="mt-auto pt-4">
        <small className="text-muted">{user ? "" : "Sign in to add or edit."}</small>
      </div>
    </aside>
  );
}
