// The signed-in user, as recorded on each write.
export type Editor = { uid: string; name: string };

export type ListDoc = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  createdByName?: string;
  // User id of the last editor. Documents that were last changed before this field existed do not have it.
  updatedBy?: string;
  updatedByName?: string;
  isDefault: boolean;
  order: number;
  orderMissing?: boolean;
};

export type ItemDoc = {
  id: string;
  text: string;
  checked: boolean;
  quantity: number;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  createdByName?: string;
  // User id of the last editor. Documents that were last changed before this field existed do not have it.
  updatedBy?: string;
  updatedByName?: string;
  order: number;
  orderMissing?: boolean;
  quantityMissing?: boolean;
};
