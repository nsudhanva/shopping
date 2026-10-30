import { useQueryClient } from "@tanstack/react-query";
import type { User } from "firebase/auth";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";
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
import type { ItemDoc, ListDoc } from "./types";

export type Direction = "up" | "down";

export type Shopping = {
  user: User | null;
  userName: string;
  lists: ListDoc[];
  listsLoaded: boolean;
  items: ItemDoc[];
  itemsLoaded: boolean;
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

export function ShoppingProvider(props: {
  requestedListId: string | undefined;
  onSelectList: (listId: string, options?: { replace: boolean }) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const user = useAuthUser();
  const userName = userLabel(user);
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

  useListMaintenance(user, userName, lists, listsLoaded);
  useItemMaintenance(user, userName, currentListId, items);

  const value: Shopping = {
    user,
    userName,
    lists,
    listsLoaded,
    items,
    itemsLoaded: itemsQuery.data !== undefined,
    currentListId,
    currentList,
    selectList: (listId) => onSelectList(listId),
    moveList: async (listId, direction) => {
      const result = user ? reorder(lists, listId, direction) : null;
      if (!result) return false;
      queryClient.setQueryData(listsKey, result.next);
      await persistListOrder(result.changes, userName);
      return true;
    },
    moveItem: async (itemId, direction) => {
      const result = user && currentListId ? reorder(items, itemId, direction) : null;
      if (!result || !currentListId) return false;
      queryClient.setQueryData(itemsKey(currentListId), result.next);
      await persistItemOrder(currentListId, result.changes, userName);
      return true;
    },
  };

  return <ShoppingContext value={value}>{props.children}</ShoppingContext>;
}

function useListMaintenance(user: User | null, userName: string, lists: ListDoc[], listsLoaded: boolean) {
  const ensuringDefault = useRef(false);
  const listOrderBackfilled = useRef(false);
  const hasDefault = lists.some((list) => list.isDefault);

  useEffect(() => {
    if (!user || !listsLoaded || hasDefault || ensuringDefault.current) return;
    ensuringDefault.current = true;
    void createDefaultList({ userId: user.uid, userName }).finally(() => {
      ensuringDefault.current = false;
    });
  }, [user, userName, listsLoaded, hasDefault]);

  // The orderBy query excludes lists that have no `order` field, so these lists never show in the snapshot.
  // Check the full collection one time in each session.
  useEffect(() => {
    if (!user || listOrderBackfilled.current) return;
    listOrderBackfilled.current = true;
    backfillListOrder(userName).catch(() => {
      listOrderBackfilled.current = false;
    });
  }, [user, userName]);
}

function useItemMaintenance(user: User | null, userName: string, listId: string | null, items: ItemDoc[]) {
  const backfilled = useRef(new Set<string>());
  const needsBackfill = items.some((item) => item.orderMissing || item.quantityMissing);

  useEffect(() => {
    if (!user || !listId || !needsBackfill || backfilled.current.has(listId)) return;
    backfilled.current.add(listId);
    backfillItemOrder(listId, userName).catch(() => {
      backfilled.current.delete(listId);
    });
  }, [user, userName, listId, needsBackfill]);
}
