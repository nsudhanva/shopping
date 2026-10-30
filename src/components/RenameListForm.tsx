import { type FormEvent, useState } from "react";
import { updateList } from "../lib/firestore";
import { maxListNameLength } from "../lib/limits";
import { useShopping } from "../lib/shopping";

// The form renames the list that it opened for. If the user shows a different list, the form does not rename it.
export function RenameListForm(props: {
  listId: string;
  initialName: string;
  layout: "inline" | "stacked";
  onDone: () => void;
}) {
  const { editor } = useShopping();
  const [name, setName] = useState(props.initialName);
  const stacked = props.layout === "stacked";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!editor || !trimmed) return;
    await updateList(props.listId, trimmed, editor);
    props.onDone();
  }

  const buttonSize = stacked ? "btn-sm flex-1" : "btn-sm";
  const buttons = (
    <>
      <button type="submit" className={`btn btn-primary ${buttonSize}`}>
        Save
      </button>
      <button type="button" className={`btn btn-ghost ${buttonSize}`} onClick={props.onDone}>
        Cancel
      </button>
    </>
  );

  return (
    <form className={stacked ? "space-y-2 mt-4" : "flex gap-2 mt-2"} onSubmit={submit}>
      <input
        type="text"
        name="name"
        placeholder="List name"
        aria-label="New list name"
        maxLength={maxListNameLength}
        required
        // biome-ignore lint/a11y/noAutofocus: the user opens this form with a Rename button.
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={stacked ? "input input-bordered input-sm w-full" : "input input-bordered input-sm"}
      />
      {stacked ? <div className="flex gap-2">{buttons}</div> : buttons}
    </form>
  );
}
