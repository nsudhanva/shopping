import type { State } from "./types";

export const state: State = {
  user: null,
  lists: [],
  items: [],
  currentListId: null,
  listsLoaded: false,
  ensureDefaultInFlight: false,
  editingItemId: null,
  editingItemText: "",
  backfillListsInFlight: false,
  backfilledItemLists: new Set<string>(),
};
