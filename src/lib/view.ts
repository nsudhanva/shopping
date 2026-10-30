import type { Editor, ItemDoc, ListDoc } from "./types";

// How the user sorts and filters the lists and items. The URL holds these values; manual order is the default.
export const itemSorts = ["manual", "name", "newest", "edited", "tobuy"] as const;
export const itemShows = ["all", "tobuy", "bought"] as const;
export const itemPeople = ["anyone", "added-me", "edited-me"] as const;
export const listSorts = ["manual", "name", "updated"] as const;

export type View = {
  sort: (typeof itemSorts)[number];
  show: (typeof itemShows)[number];
  who: (typeof itemPeople)[number];
  lists: (typeof listSorts)[number];
};

export const defaultView: View = { sort: "manual", show: "all", who: "anyone", lists: "manual" };

/** Returns `value` if it is one of `options`, else undefined. */
export function pick<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true }).compare;

function matchesPerson(item: ItemDoc, who: View["who"], editor: Editor | null) {
  if (who === "anyone") return true;
  if (!editor) return false;
  if (who === "added-me") return item.createdBy === editor.uid;
  // Items that were last changed before updatedBy existed have only the name of the editor.
  return item.updatedBy ? item.updatedBy === editor.uid : item.updatedByName === editor.name;
}

/** The items to show, in the order to show them. */
export function viewItems(items: ItemDoc[], view: View, editor: Editor | null, search: string): ItemDoc[] {
  const text = search.trim().toLocaleLowerCase();
  const shown = items.filter(
    (item) =>
      (view.show === "all" || item.checked === (view.show === "bought")) &&
      matchesPerson(item, view.who, editor) &&
      (!text || item.text.toLocaleLowerCase().includes(text)),
  );
  // Array.sort is stable, so items that compare equal keep their manual order.
  switch (view.sort) {
    case "name":
      return shown.sort((a, b) => byName(a.text, b.text));
    case "newest":
      return shown.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    case "edited":
      return shown.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    case "tobuy":
      return shown.sort((a, b) => Number(a.checked) - Number(b.checked));
    default:
      return shown;
  }
}

export function viewLists(lists: ListDoc[], sort: View["lists"]): ListDoc[] {
  switch (sort) {
    case "name":
      return [...lists].sort((a, b) => byName(a.name, b.name));
    case "updated":
      return [...lists].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    default:
      return lists;
  }
}

/** Moving items up and down changes the manual order, so it is possible only when the screen shows that order. */
export function showsManualItemOrder(view: View, search: string) {
  return view.sort === "manual" && view.show === "all" && view.who === "anyone" && !search.trim();
}
