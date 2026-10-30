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
  quantity: number;
  unit: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  createdByName?: string;
  updatedByName?: string;
  order: number;
  orderMissing?: boolean;
  quantityMissing?: boolean;
};
