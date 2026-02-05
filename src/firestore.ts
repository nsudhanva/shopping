import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import type { ItemDoc, ListDoc } from "./types";

const listCollection = collection(db, "lists");

function toDate(value: unknown): Date {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function makeOrder(): number {
  return Date.now() + Math.random();
}

function resolveOrder(data: DocumentData): { order: number; missing: boolean } {
  if (isFiniteNumber(data.order)) {
    return { order: data.order, missing: false };
  }
  return { order: toDate(data.createdAt).getTime(), missing: true };
}

function resolveQuantity(data: DocumentData): { quantity: number; missing: boolean } {
  if (isFiniteNumber(data.quantity)) {
    return { quantity: data.quantity, missing: false };
  }
  return { quantity: 1, missing: true };
}

function mapList(snapshot: QuerySnapshot<DocumentData>): ListDoc[] {
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    const { order, missing } = resolveOrder(data);
    return {
      id: docSnap.id,
      name: String(data.name ?? "Untitled"),
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      createdBy: String(data.createdBy ?? ""),
      createdByName: data.createdByName ? String(data.createdByName) : undefined,
      updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
      isDefault: Boolean(data.isDefault),
      order,
      orderMissing: missing,
    } satisfies ListDoc;
  });
}

function mapItems(snapshot: QuerySnapshot<DocumentData>): ItemDoc[] {
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    const { order, missing } = resolveOrder(data);
    const { quantity, missing: quantityMissing } = resolveQuantity(data);
    return {
      id: docSnap.id,
      text: String(data.text ?? ""),
      checked: Boolean(data.checked),
      quantity,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      createdBy: String(data.createdBy ?? ""),
      createdByName: data.createdByName ? String(data.createdByName) : undefined,
      updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
      order,
      orderMissing: missing,
      quantityMissing,
    } satisfies ItemDoc;
  });
}

export function subscribeLists(onChange: (lists: ListDoc[]) => void): () => void {
  const listsQuery = query(listCollection, orderBy("order", "asc"));
  return onSnapshot(listsQuery, (snapshot) => {
    onChange(mapList(snapshot));
  });
}

export function subscribeItems(
  listId: string,
  onChange: (items: ItemDoc[]) => void
): () => void {
  const itemsQuery = query(
    collection(db, "lists", listId, "items"),
    orderBy("order", "asc")
  );
  return onSnapshot(itemsQuery, (snapshot) => {
    onChange(mapItems(snapshot));
  });
}

export async function createList(params: {
  name: string;
  userId: string;
  userName: string;
  isDefault: boolean;
}): Promise<string> {
  const ref = await addDoc(listCollection, {
    name: params.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.userId,
    createdByName: params.userName,
    updatedByName: params.userName,
    isDefault: params.isDefault,
    order: makeOrder(),
  });
  return ref.id;
}

export async function updateList(listId: string, data: { name: string; userName: string }) {
  await updateDoc(doc(db, "lists", listId), {
    name: data.name,
    updatedByName: data.userName,
    updatedAt: serverTimestamp(),
  });
}

export async function touchList(listId: string, userName: string) {
  await updateDoc(doc(db, "lists", listId), {
    updatedAt: serverTimestamp(),
    updatedByName: userName,
  });
}

export async function createItem(params: {
  listId: string;
  text: string;
  userId: string;
  userName: string;
}) {
  await addDoc(collection(db, "lists", params.listId, "items"), {
    text: params.text,
    checked: false,
    quantity: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.userId,
    createdByName: params.userName,
    updatedByName: params.userName,
    order: makeOrder(),
  });
  await touchList(params.listId, params.userName);
}

export async function updateItem(
  listId: string,
  itemId: string,
  data: { text?: string; checked?: boolean; quantity?: number; userName: string }
) {
  const payload: {
    text?: string;
    checked?: boolean;
    quantity?: number;
    updatedByName: string;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    updatedByName: data.userName,
    updatedAt: serverTimestamp(),
  };
  if (data.text !== undefined) payload.text = data.text;
  if (data.checked !== undefined) payload.checked = data.checked;
  if (data.quantity !== undefined) payload.quantity = data.quantity;
  await updateDoc(doc(db, "lists", listId, "items", itemId), payload);
  await touchList(listId, data.userName);
}

export async function deleteItem(listId: string, itemId: string, userName: string) {
  await deleteDoc(doc(db, "lists", listId, "items", itemId));
  await touchList(listId, userName);
}

export function chunkDocs<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export async function updateAllItems(listId: string, checked: boolean, userName: string) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.update(item.ref, {
        checked,
        updatedAt: serverTimestamp(),
        updatedByName: userName,
      });
    }
    await batch.commit();
  }
  await touchList(listId, userName);
}

export async function clearAllItems(listId: string, userName: string) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
  await touchList(listId, userName);
}

export async function clearCheckedItems(listId: string, userName: string) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const checkedDocs = itemsSnap.docs.filter((docSnap) => Boolean(docSnap.data().checked));
  const batches = chunkDocs(checkedDocs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
  await touchList(listId, userName);
}

export async function ensureDefaultListId(params: {
  existingId?: string;
  userId: string;
  userName: string;
}): Promise<string> {
  if (params.existingId) return params.existingId;
  return createList({
    name: "Inbox",
    userId: params.userId,
    userName: params.userName,
    isDefault: true,
  });
}

export async function deleteListWithItems(params: {
  listId: string;
  keepItems: boolean;
  defaultListId?: string;
  userId: string;
  userName: string;
}) {
  const itemsSnap = await getDocs(collection(db, "lists", params.listId, "items"));
  const itemDocs = itemsSnap.docs;
  const defaultListId = params.keepItems
    ? await ensureDefaultListId({
        existingId: params.defaultListId,
        userId: params.userId,
        userName: params.userName,
      })
    : null;

  const batches = chunkDocs(itemDocs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      if (params.keepItems && defaultListId) {
        const targetRef = doc(db, "lists", defaultListId, "items", item.id);
        const data = item.data();
        const order = isFiniteNumber(data.order)
          ? data.order
          : toDate(data.createdAt).getTime();
        const quantity = isFiniteNumber(data.quantity) ? data.quantity : 1;
        batch.set(targetRef, {
          text: String(data.text ?? ""),
          checked: Boolean(data.checked),
          quantity,
          createdAt: data.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: params.userId,
          createdByName: params.userName,
          updatedByName: params.userName,
          order,
        });
      }
      batch.delete(item.ref);
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, "lists", params.listId));
}

export async function backfillListOrder(userName: string) {
  const snapshot = await getDocs(listCollection);
  const missing = snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        ref: docSnap.ref,
        createdAt: toDate(data.createdAt),
        order: isFiniteNumber(data.order) ? data.order : null,
      };
    })
    .filter((entry) => entry.order === null);

  if (missing.length === 0) return;

  missing.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const updates = missing.map((entry, index) => ({
    ref: entry.ref,
    order: entry.createdAt.getTime() + index,
  }));

  const batches = chunkDocs(updates, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const entry of batchDocs) {
      batch.update(entry.ref, {
        order: entry.order,
        updatedAt: serverTimestamp(),
        updatedByName: userName,
      });
    }
    await batch.commit();
  }
}

export async function backfillItemOrder(listId: string, userName: string) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const missing = itemsSnap.docs
    .map((docSnap) => {
      const data = docSnap.data();
      return {
        ref: docSnap.ref,
        createdAt: toDate(data.createdAt),
        order: isFiniteNumber(data.order) ? data.order : null,
        quantity: isFiniteNumber(data.quantity) ? data.quantity : null,
      };
    })
    .filter((entry) => entry.order === null || entry.quantity === null);

  if (missing.length === 0) return;

  missing.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const updates = missing.map((entry, index) => ({
    ref: entry.ref,
    order: entry.order ?? entry.createdAt.getTime() + index,
    quantity: entry.quantity ?? 1,
  }));

  const batches = chunkDocs(updates, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const entry of batchDocs) {
      batch.update(entry.ref, {
        order: entry.order,
        quantity: entry.quantity,
        updatedAt: serverTimestamp(),
        updatedByName: userName,
      });
    }
    await batch.commit();
  }
  await touchList(listId, userName);
}

export async function persistListOrder(lists: Array<{ id: string; order: number }>, userName: string) {
  const batch = writeBatch(db);
  for (const list of lists) {
    batch.update(doc(db, "lists", list.id), {
      order: list.order,
      updatedAt: serverTimestamp(),
      updatedByName: userName,
    });
  }
  await batch.commit();
}

export async function persistItemOrder(
  listId: string,
  items: Array<{ id: string; order: number }>,
  userName: string
) {
  const batch = writeBatch(db);
  for (const item of items) {
    batch.update(doc(db, "lists", listId, "items", item.id), {
      order: item.order,
      updatedAt: serverTimestamp(),
      updatedByName: userName,
    });
  }
  await batch.commit();
  await touchList(listId, userName);
}
