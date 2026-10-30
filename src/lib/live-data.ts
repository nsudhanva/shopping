import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeItems, subscribeLists } from "./firestore";
import type { ItemDoc, ListDoc } from "./types";

// Firestore snapshots go into the TanStack Query cache. Queries do not fetch. All components read the same
// live data, and a list that you show again renders from the cache immediately.
export const listsKey = ["lists"] as const;
export const itemsKey = (listId: string) => ["items", listId] as const;

export function useLists() {
  const queryClient = useQueryClient();
  useEffect(() => subscribeLists((lists) => queryClient.setQueryData(listsKey, lists)), [queryClient]);
  return useQuery<ListDoc[]>({ queryKey: listsKey, queryFn: skipToken });
}

export function useItems(listId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!listId) return;
    return subscribeItems(listId, (items) => queryClient.setQueryData(itemsKey(listId), items));
  }, [queryClient, listId]);
  return useQuery<ItemDoc[]>({ queryKey: itemsKey(listId ?? ""), queryFn: skipToken });
}
