import {
  clearAllItems,
  clearCheckedItems,
  createItem,
  createList,
  deleteItem,
  deleteListWithItems,
  updateAllItems,
  updateItem,
  updateList,
} from "../lib/firestore";
import { maxItemTextLength, maxListNameLength, maxUnitLength, roundQuantity } from "../lib/limits";
import { findDefaultListId, type Shopping } from "../lib/shopping";
import { listReadoutText } from "./speech";

export type VoiceContext = {
  currentListId: string | null;
  currentListName: string | null;
  lists: Array<{ id: string; name: string }>;
  items: Array<{ id: string; text: string; checked: boolean; quantity: number; unit: string }>;
};

export type VoiceIntent = {
  type: string;
  itemId?: string;
  listId?: string;
  itemText?: string;
  listName?: string;
  newText?: string;
  newName?: string;
  quantity?: number;
  unit?: string;
  direction?: "up" | "down";
  keepItems?: boolean;
  question?: string;
  options?: string[];
  pending?: Record<string, unknown>;
  items?: Array<{
    text: string;
    quantity?: number;
    unit?: string;
  }>;
};

export function buildVoiceContext(shopping: Shopping): VoiceContext {
  return {
    currentListId: shopping.currentListId,
    currentListName: shopping.currentList?.name ?? null,
    lists: shopping.lists.map((list) => ({ id: list.id, name: list.name })),
    items: shopping.items.map((item) => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
      quantity: item.quantity,
      unit: item.unit,
    })),
  };
}

function normalizeVoiceAddEntry(entry: { text: string; quantity?: number; unit?: string }) {
  const text = entry.text.trim().slice(0, maxItemTextLength);
  if (!text) return null;

  const hasQuantity = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) && entry.quantity > 0;
  let quantity = hasQuantity ? entry.quantity : undefined;
  let unit = entry.unit?.trim().slice(0, maxUnitLength) ?? "";

  if (!quantity && !unit) {
    const lowered = text.toLowerCase();
    if (lowered.includes("milk") || text.includes("ಹಾಲು")) {
      quantity = 1;
      unit = "L";
    }
  }

  if (!quantity) quantity = 1;

  return {
    text,
    quantity,
    unit,
  };
}

export function looksLikeMultiAddTranscript(transcript: string): boolean {
  const lowered = transcript.toLowerCase();
  const hasSeparator =
    lowered.includes(",") ||
    lowered.includes(" and ") ||
    lowered.includes(" & ") ||
    transcript.includes(" ಹಾಗೂ ") ||
    transcript.includes(" ಮತ್ತು ");
  if (!hasSeparator) return false;
  const quantityMentions = transcript.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
  return quantityMentions >= 2 || lowered.includes(",") || lowered.includes(" and ");
}

export async function runIntent(shopping: Shopping, intent: VoiceIntent): Promise<string> {
  const { editor, currentListId, lists, items } = shopping;
  if (!editor) {
    return "Please sign in to use voice controls.";
  }

  const hasItem = (itemId: string | undefined): itemId is string =>
    Boolean(itemId && items.some((item) => item.id === itemId));
  const hasList = (listId: string | undefined): listId is string =>
    Boolean(listId && lists.some((list) => list.id === listId));

  switch (intent.type) {
    case "add_item": {
      if (!currentListId) return "No list is selected.";
      const text = intent.itemText?.trim();
      if (!text) return "I need an item name to add.";
      const normalized = normalizeVoiceAddEntry({
        text,
        quantity: intent.quantity,
        unit: intent.unit,
      });
      if (!normalized) return "I need an item name to add.";
      await createItem({
        listId: currentListId,
        text: normalized.text,
        quantity: normalized.quantity,
        unit: normalized.unit,
        editor,
      });
      return `Added ${normalized.text}.`;
    }
    case "add_items_bulk": {
      if (!currentListId) return "No list is selected.";
      const normalizedItems = (intent.items ?? [])
        .map((item) => normalizeVoiceAddEntry(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (normalizedItems.length === 0) return "I could not detect valid items to add.";

      for (const item of normalizedItems) {
        await createItem({
          listId: currentListId,
          text: item.text,
          quantity: item.quantity,
          unit: item.unit,
          editor,
        });
      }

      if (normalizedItems.length === 1) {
        return `Added ${normalizedItems[0].text}.`;
      }
      const preview = normalizedItems
        .slice(0, 3)
        .map((item) => item.text)
        .join(", ");
      return `Added ${normalizedItems.length} items: ${preview}${normalizedItems.length > 3 ? ", and more" : ""}.`;
    }
    case "edit_item_text": {
      if (!currentListId) return "No list is selected.";
      const newText = intent.newText?.trim().slice(0, maxItemTextLength);
      if (!intent.itemId || !newText) return "I need the item and new name.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(currentListId, intent.itemId, { text: newText }, editor);
      return "Item updated.";
    }
    case "set_quantity": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId || typeof intent.quantity !== "number") return "I need the item and quantity.";
      if (!(intent.quantity > 0)) return "Quantity must be more than zero.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(currentListId, intent.itemId, { quantity: roundQuantity(intent.quantity) }, editor);
      return "Quantity updated.";
    }
    case "set_unit": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId || intent.unit === undefined) return "I need the item and unit.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(currentListId, intent.itemId, { unit: intent.unit.trim().slice(0, maxUnitLength) }, editor);
      return "Unit updated.";
    }
    case "check_item": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to check.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(currentListId, intent.itemId, { checked: true }, editor);
      return "Item checked.";
    }
    case "uncheck_item": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to uncheck.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await updateItem(currentListId, intent.itemId, { checked: false }, editor);
      return "Item unchecked.";
    }
    case "delete_item": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId) return "I need the item to delete.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      await deleteItem(currentListId, intent.itemId, editor);
      return "Item deleted.";
    }
    case "move_item": {
      if (!currentListId) return "No list is selected.";
      if (!intent.itemId || !intent.direction) return "I need item and direction.";
      if (!hasItem(intent.itemId)) return "Could not find that item.";
      if (!shopping.itemOrderShown) return "Switch to manual order and clear the filters to move items.";
      const moved = await shopping.moveItem(intent.itemId, intent.direction);
      return moved ? `Moved item ${intent.direction}.` : "That item cannot move further.";
    }
    case "check_all": {
      if (!currentListId) return "No list is selected.";
      await updateAllItems(currentListId, true, editor);
      return "Checked all items.";
    }
    case "uncheck_all": {
      if (!currentListId) return "No list is selected.";
      await updateAllItems(currentListId, false, editor);
      return "Unchecked all items.";
    }
    case "clear_checked": {
      if (!currentListId) return "No list is selected.";
      await clearCheckedItems(currentListId, editor);
      return "Cleared checked items.";
    }
    case "clear_all": {
      if (!currentListId) return "No list is selected.";
      await clearAllItems(currentListId, editor);
      return "Cleared all items.";
    }
    case "create_list": {
      const name = intent.listName?.trim().slice(0, maxListNameLength);
      if (!name) return "I need a name for the new list.";
      const listId = await createList({ name, editor, isDefault: false });
      shopping.selectList(listId);
      return `Created list ${name}.`;
    }
    case "select_list": {
      if (!intent.listId) return "I need a list to select.";
      if (!hasList(intent.listId)) return "Could not find that list.";
      shopping.selectList(intent.listId);
      return "List selected.";
    }
    case "rename_list": {
      const targetListId = intent.listId ?? currentListId ?? undefined;
      const newName = intent.newName?.trim().slice(0, maxListNameLength);
      if (!targetListId || !newName) return "I need the list and new name.";
      if (!hasList(targetListId)) return "Could not find that list.";
      await updateList(targetListId, newName, editor);
      return "List renamed.";
    }
    case "delete_list": {
      const targetListId = intent.listId ?? currentListId ?? undefined;
      if (!targetListId) return "No list is selected.";
      if (!hasList(targetListId)) return "Could not find that list.";
      await deleteListWithItems({
        listId: targetListId,
        keepItems: Boolean(intent.keepItems),
        defaultListId: findDefaultListId(lists, targetListId),
        editor,
      });
      return "List deleted.";
    }
    case "move_list": {
      if (!intent.listId || !intent.direction) return "I need list and direction.";
      if (!hasList(intent.listId)) return "Could not find that list.";
      if (!shopping.listOrderShown) return "Switch the lists to manual order to move them.";
      const moved = await shopping.moveList(intent.listId, intent.direction);
      return moved ? `Moved list ${intent.direction}.` : "That list cannot move further.";
    }
    case "read_items": {
      // Read what the screen shows, with the current sort and filters.
      return listReadoutText(shopping.currentList, shopping.visibleItems);
    }
    default:
      return "I could not understand the command.";
  }
}
