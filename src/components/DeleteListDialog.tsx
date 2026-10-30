import { useEffect, useRef, useState } from "react";
import { deleteListWithItems } from "../lib/firestore";
import { findDefaultListId, useShopping } from "../lib/shopping";
import type { ListDoc } from "../lib/types";

export function DeleteListDialog(props: { list: ListDoc; open: boolean; onClose: () => void }) {
  const shopping = useShopping();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [keepItems, setKeepItems] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  async function confirmDelete() {
    const { editor } = shopping;
    if (!editor) return;
    setBusy(true);
    try {
      await deleteListWithItems({
        listId: props.list.id,
        keepItems,
        defaultListId: findDefaultListId(shopping.lists, props.list.id),
        editor,
      });
    } finally {
      setBusy(false);
      props.onClose();
    }
  }

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby="delete-list-title" onClose={props.onClose}>
      <div className="modal-box">
        <h3 id="delete-list-title" className="font-bold text-lg">
          Delete this list?
        </h3>
        <p className="py-4 text-muted">This list will be removed. What should happen to its items?</p>
        <fieldset className="fieldset">
          <legend className="sr-only">Items in this list</legend>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="radio"
              name="delete-mode"
              className="radio radio-primary"
              checked={!keepItems}
              onChange={() => setKeepItems(false)}
            />
            <span>Delete items</span>
          </label>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="radio"
              name="delete-mode"
              className="radio radio-primary"
              checked={keepItems}
              onChange={() => setKeepItems(true)}
            />
            <span>Keep items (move to Inbox)</span>
          </label>
        </fieldset>
        <div className="modal-action">
          <button type="button" className="btn btn-error" disabled={busy} onClick={() => void confirmDelete()}>
            Confirm
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">close</button>
      </form>
    </dialog>
  );
}
