export type ListDoc = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  isDefault: boolean;
};

export type ItemDoc = {
  id: string;
  text: string;
  checked: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
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
};
