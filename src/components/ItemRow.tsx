import { type KeyboardEvent, useRef, useState } from "react";
import { maxItemTextLength, maxUnitLength } from "../lib/limits";
import type { Direction } from "../lib/shopping";
import type { ItemDoc } from "../lib/types";

export type ItemActions = {
  onToggle: (item: ItemDoc, checked: boolean) => void;
  onEditStart: (item: ItemDoc) => void;
  onEditInput: (value: string) => void;
  onEditSave: (item: ItemDoc) => void;
  onEditCancel: () => void;
  onDelete: (item: ItemDoc) => void;
  onLongDelete: (item: ItemDoc) => void;
  onQuantityChange: (item: ItemDoc, quantity: number) => void;
  onUnitChange: (item: ItemDoc, unit: string) => void;
  onMove: (item: ItemDoc, direction: Direction) => void;
};

type Props = {
  item: ItemDoc;
  isFirst: boolean;
  isLast: boolean;
  /** False when the screen does not show the manual order. Then the move buttons do not show. */
  canMove: boolean;
  canEdit: boolean;
  editingText: string | null;
  meta: string;
  actions: ItemActions;
};

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

// A tap starts an edit. A 600 ms press deletes. Keyboard activation (Enter or Space) is a click with detail 0.
function useTapAndLongPress(onTap: () => void, onLongPress: () => void) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  function clearHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      didLongPress.current = false;
      holdTimer.current = setTimeout(() => {
        didLongPress.current = true;
        onLongPress();
      }, 600);
    },
    onPointerUp: () => {
      clearHold();
      if (!didLongPress.current) onTap();
    },
    onPointerCancel: clearHold,
    onPointerLeave: clearHold,
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) onTap();
    },
  };
}

// Keeps the text that the user types when snapshots render the row again. Syncs when the stored value changes.
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

function QuantityControl(props: { item: ItemDoc; canEdit: boolean; size: "sm" | "xs"; actions: ItemActions }) {
  const { item, canEdit, size, actions } = props;
  const [draft, setDraft] = useDraft(String(item.quantity));

  function commit() {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(item.quantity));
      return;
    }
    if (parsed !== item.quantity) actions.onQuantityChange(item, parsed);
  }

  const btn = size === "sm" ? "btn btn-sm join-item" : "btn btn-xs join-item";
  return (
    <div className="join">
      <button
        type="button"
        className={btn}
        aria-label={`Decrease ${item.text}`}
        disabled={!canEdit || item.quantity <= 1}
        onClick={() => actions.onQuantityChange(item, item.quantity - 1)}
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        aria-label={`Quantity of ${item.text}`}
        className={
          size === "sm"
            ? "input input-sm input-bordered join-item w-16 text-center"
            : "input input-xs input-bordered join-item w-10 text-center"
        }
        value={draft}
        disabled={!canEdit}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
      />
      <button
        type="button"
        className={btn}
        aria-label={`Increase ${item.text}`}
        disabled={!canEdit}
        onClick={() => actions.onQuantityChange(item, item.quantity + 1)}
      >
        +
      </button>
    </div>
  );
}

function UnitInput(props: { item: ItemDoc; canEdit: boolean; actions: ItemActions }) {
  const { item, canEdit, actions } = props;
  const [draft, setDraft] = useDraft(item.unit);
  return (
    <input
      type="text"
      className="input input-sm input-bordered w-20"
      placeholder="unit"
      aria-label={`Unit for ${item.text}`}
      maxLength={maxUnitLength}
      value={draft}
      disabled={!canEdit}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const unit = draft.trim();
        if (unit !== item.unit) actions.onUnitChange(item, unit);
      }}
      onKeyDown={blurOnEnter}
    />
  );
}

function ItemText(props: { item: ItemDoc; canEdit: boolean; mobile: boolean; actions: ItemActions }) {
  const { item, canEdit, mobile, actions } = props;
  const press = useTapAndLongPress(
    () => actions.onEditStart(item),
    () => actions.onLongDelete(item),
  );
  const struck = item.checked ? "line-through opacity-50" : "";
  if (!canEdit) {
    return <span className={mobile ? `text-base truncate ${struck}` : struck}>{item.text}</span>;
  }
  return (
    <button
      type="button"
      className={mobile ? `text-base font-medium truncate ${struck}` : `text-left font-medium ${struck}`}
      {...press}
    >
      {item.text}
    </button>
  );
}

function EditInput(props: { item: ItemDoc; text: string; className: string; actions: ItemActions }) {
  return (
    <input
      type="text"
      aria-label={`Edit ${props.item.text}`}
      className={props.className}
      maxLength={maxItemTextLength}
      value={props.text}
      // biome-ignore lint/a11y/noAutofocus: the user starts the edit with a tap on the item.
      autoFocus
      onChange={(event) => props.actions.onEditInput(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.actions.onEditSave(props.item);
        } else if (event.key === "Escape") {
          props.actions.onEditCancel();
        }
      }}
    />
  );
}

export function ItemRow(props: Props) {
  const { item, isFirst, isLast, canMove, canEdit, editingText, meta, actions } = props;
  const editing = editingText !== null;
  const checkbox = (className: string) => (
    <input
      type="checkbox"
      className={className}
      aria-label={item.checked ? `Uncheck ${item.text}` : `Check ${item.text}`}
      checked={item.checked}
      disabled={!canEdit}
      onChange={(event) => actions.onToggle(item, event.target.checked)}
    />
  );

  return (
    <li className="card card-sm bg-base-200 shadow-sm">
      <div className="card-body p-3 sm:p-4">
        {/* Desktop layout */}
        <div className="hidden sm:flex items-center gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {checkbox("checkbox checkbox-primary checkbox-md mt-1")}
            <div className="flex-1 min-w-0">
              {editing ? (
                <EditInput
                  item={item}
                  text={editingText}
                  className="input input-sm input-bordered w-full"
                  actions={actions}
                />
              ) : (
                <ItemText item={item} canEdit={canEdit} mobile={false} actions={actions} />
              )}
              <div className="text-xs text-base-content/70 mt-1">{meta}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <QuantityControl item={item} canEdit={canEdit} size="sm" actions={actions} />
            <UnitInput item={item} canEdit={canEdit} actions={actions} />
            {canMove && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label={`Move ${item.text} up`}
                  title="Move up"
                  disabled={!canEdit || isFirst}
                  onClick={() => actions.onMove(item, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label={`Move ${item.text} down`}
                  title="Move down"
                  disabled={!canEdit || isLast}
                  onClick={() => actions.onMove(item, "down")}
                >
                  ↓
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={!canEdit}
              onClick={() => actions.onEditStart(item)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-error btn-xs btn-outline"
              disabled={!canEdit}
              onClick={() => actions.onDelete(item)}
            >
              Delete
            </button>
            {editing && (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.onEditSave(item)}>
                  Save
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={actions.onEditCancel}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile layout */}
        <div className="sm:hidden flex items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {checkbox("checkbox checkbox-primary checkbox-md flex-shrink-0")}
            {editing ? (
              <EditInput
                item={item}
                text={editingText}
                className="input input-sm input-bordered flex-1 min-w-0"
                actions={actions}
              />
            ) : (
              <ItemText item={item} canEdit={canEdit} mobile actions={actions} />
            )}
          </div>
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <QuantityControl item={item} canEdit={canEdit} size="xs" actions={actions} />
            {editing ? (
              <div className="flex gap-1">
                <button type="button" className="btn btn-primary btn-xs" onClick={() => actions.onEditSave(item)}>
                  Save
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={actions.onEditCancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-error btn-xs btn-outline"
                disabled={!canEdit}
                onClick={() => actions.onDelete(item)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
