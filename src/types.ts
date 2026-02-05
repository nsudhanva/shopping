export type ListDoc = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDefault: boolean;
  order: number;
  orderMissing?: boolean;
};

export type ItemDoc = {
  id: string;
  text: string;
  checked: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedByName?: string;
  order: number;
  orderMissing?: boolean;
};

export type State = {
  user: import("firebase/auth").User | null;
  lists: ListDoc[];
  items: ItemDoc[];
  currentListId: string | null;
  listsLoaded: boolean;
  ensureDefaultInFlight: boolean;
  editingItemId: string | null;
  editingItemText: string;
  backfillListsInFlight: boolean;
  backfilledItemLists: Set<string>;
};
