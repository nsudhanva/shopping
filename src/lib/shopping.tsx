import { useQueryClient } from "@tanstack/react-query";
import type { User } from "firebase/auth";
import { createContext, type ReactNode, use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuthUser, userLabel } from "./auth";
import {
  backfillItemOrder,
  backfillListOrder,
  createDefaultList,
  persistItemOrder,
  persistListOrder,
} from "./firestore";
import { itemsKey, listsKey, useItems, useLists } from "./live-data";
import { readStoredListId, storeSelectedListId } from "./storage";
import type { Editor, ItemDoc, ListDoc } from "./types";
import { defaultView, showsManualItemOrder, type View, viewItems, viewLists } from "./view";

export type Direction = "up" | "down";

export type Shopping = {
  user: User | null;
  /** The signed-in user as recorded on writes, or null when nobody is signed in. */
  editor: Editor | null;
  lists: ListDoc[];
  listsLoaded: boolean;
  /** All items of the current list, in manual order. */
  items: ItemDoc[];
  itemsLoaded: boolean;
  view: View;
  setView: (change: Partial<View>) => void;
  search: string;
  setSearch: (search: string) => void;
  /** The lists and items as the screen shows them, after the sort and the filters. */
  visibleLists: ListDoc[];
  visibleItems: ItemDoc[];
  /** True when the screen shows the manual order, so the user can move entries up and down. */
  listOrderShown: boolean;
  itemOrderShown: boolean;
  currentListId: string | null;
  currentList: ListDoc | null;
  selectList: (listId: string) => void;
  /** Resolves false when the list cannot move in that direction (not found, or already at the end). */
  moveList: (listId: string, direction: Direction) => Promise<boolean>;
  /** Resolves false when the item cannot move in that direction (not found, or already at the end). */
  moveItem: (itemId: string, direction: Direction) => Promise<boolean>;
};

const ShoppingContext = createContext<Shopping | null>(null);

export function useShopping(): Shopping {
  const value = use(ShoppingContext);
  if (!value) throw new Error("useShopping must be used inside ShoppingProvider");
  return value;
}

// A swap of two equal orders changes nothing, so move the two values apart by a small amount.
export function swapOrders(currentOrder: number, targetOrder: number, direction: Direction) {
  if (currentOrder !== targetOrder) {
    return { current: targetOrder, target: currentOrder };
  }
  const delta = 0.0001;
  if (direction === "up") {
    return { current: targetOrder - delta, target: targetOrder + delta };
  }
  return { current: targetOrder + delta, target: targetOrder - delta };
}

// The default list that gets the items when the user deletes `excludeListId`. It is never the deleted list.
export function findDefaultListId(lists: ListDoc[], excludeListId: string): string | undefined {
  return lists.find((list) => list.isDefault && list.id !== excludeListId)?.id;
}

// Swaps an entry with its neighbor. Returns null when the entry is already at that end.
function reorder<T extends { id: string; order: number }>(entries: T[], id: string, direction: Direction) {
  const index = entries.findIndex((entry) => entry.id === id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return null;
  const orders = swapOrders(entries[index].order, entries[targetIndex].order, direction);
  const current = { ...entries[index], order: orders.current };
  const target = { ...entries[targetIndex], order: orders.target };
  const next = [...entries];
  next[index] = target;
  next[targetIndex] = current;
  return {
    next,
    changes: [
      { id: current.id, order: current.order },
      { id: target.id, order: target.order },
    ],
  };
}

function resolveListId(requested: string | undefined, stored: string | null, lists: ListDoc[] | undefined) {
  // Before the lists arrive, use the URL or the last list. Then its items load at the same time as the lists.
  if (!lists) return requested ?? stored;
  const exists = (id: string | null | undefined): id is string => Boolean(id && lists.some((list) => list.id === id));
  // If the requested list is gone (for example, deleted), use the default list, not the last list.
  if (requested) return exists(requested) ? requested : defaultListId(lists);
  return exists(stored) ? stored : defaultListId(lists);
}

function defaultListId(lists: ListDoc[]) {
  return (lists.find((list) => list.isDefault) ?? lists[0])?.id ?? null;
}

function noSubscription() {
  return () => {};
}

export function toEditor(user: User | null): Editor | null {
  return user ? { uid: user.uid, name: userLabel(user) } : null;
}

export function ShoppingProvider(props: {
  requestedListId: string | undefined;
  onSelectList: (listId: string, options?: { replace: boolean }) => void;
  view: View;
  onViewChange: (change: Partial<View>) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const user = useAuthUser();
  const editor = toEditor(user);
  const [search, setSearch] = useState("");
  const listsQuery = useLists();
  const [storedListId] = useState(readStoredListId);
  const currentListId = resolveListId(props.requestedListId, storedListId, listsQuery.data);
  const itemsQuery = useItems(currentListId);

  const lists = listsQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const listsLoaded = listsQuery.data !== undefined;
  const currentList = lists.find((list) => list.id === currentListId) ?? null;

  const { requestedListId, onSelectList } = props;
  useEffect(() => {
    if (!listsLoaded) return;
    storeSelectedListId(currentListId);
    // If the URL points to a deleted or unknown list, change the URL to the list on screen.
    if (requestedListId && currentListId && requestedListId !== currentListId) {
      onSelectList(currentListId, { replace: true });
    }
  }, [listsLoaded, currentListId, requestedListId, onSelectList]);

  useListMaintenance(user, lists, listsLoaded);
  useItemMaintenance(user, currentListId, items);

  // The prerendered HTML has the default view. Use the view from the URL only after hydration, so the first
  // client render agrees with that HTML. Without a signed-in user, "added by me" and "edited by me" mean nothing.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const urlView = hydrated ? props.view : defaultView;
  const view = editor ? urlView : { ...urlView, who: defaultView.who };
  const listOrderShown = view.lists === "manual";
  const itemOrderShown = showsManualItemOrder(view, search);

  const value: Shopping = {
    user,
    editor,
    lists,
    listsLoaded,
    items,
    itemsLoaded: itemsQuery.data !== undefined,
    view,
    setView: props.onViewChange,
    search,
    setSearch,
    visibleLists: viewLists(lists, view.lists),
    visibleItems: viewItems(items, view, editor, search),
    listOrderShown,
    itemOrderShown,
    currentListId,
    currentList,
    selectList: (listId) => onSelectList(listId),
    moveList: async (listId, direction) => {
      const result = editor && listOrderShown ? reorder(lists, listId, direction) : null;
      if (!result || !editor) return false;
      queryClient.setQueryData(listsKey, result.next);
      await persistListOrder(result.changes, editor);
      return true;
    },
    moveItem: async (itemId, direction) => {
      const result = editor && currentListId && itemOrderShown ? reorder(items, itemId, direction) : null;
      if (!result || !editor || !currentListId) return false;
      queryClient.setQueryData(itemsKey(currentListId), result.next);
      await persistItemOrder(currentListId, result.changes, editor);
      return true;
    },
  };

  return <ShoppingContext value={value}>{props.children}</ShoppingContext>;
}

function useListMaintenance(user: User | null, lists: ListDoc[], listsLoaded: boolean) {
  const ensuringDefault = useRef(false);
  const listOrderBackfilled = useRef(false);
  const hasDefault = lists.some((list) => list.isDefault);

  useEffect(() => {
    const editor = toEditor(user);
    if (!editor || !listsLoaded || hasDefault || ensuringDefault.current) return;
    ensuringDefault.current = true;
    void createDefaultList(editor).finally(() => {
      ensuringDefault.current = false;
    });
  }, [user, listsLoaded, hasDefault]);

  // The orderBy query excludes lists that have no `order` field, so these lists never show in the snapshot.
  // Check the full collection one time in each session.
  useEffect(() => {
    const editor = toEditor(user);
    if (!editor || listOrderBackfilled.current) return;
    listOrderBackfilled.current = true;
    backfillListOrder(editor).catch(() => {
      listOrderBackfilled.current = false;
    });
  }, [user]);
}

function useItemMaintenance(user: User | null, listId: string | null, items: ItemDoc[]) {
  const backfilled = useRef(new Set<string>());
  const needsBackfill = items.some((item) => item.orderMissing || item.quantityMissing);

  useEffect(() => {
    const editor = toEditor(user);
    if (!editor || !listId || !needsBackfill || backfilled.current.has(listId)) return;
    backfilled.current.add(listId);
    backfillItemOrder(listId, editor).catch(() => {
      backfilled.current.delete(listId);
    });
  }, [user, listId, needsBackfill]);
}
