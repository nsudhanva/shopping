import {
  addDoc,
  collection,
  type DocumentData,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  type QuerySnapshot,
  query,
  serverTimestamp,
  updateDoc,
  type WriteBatch,
  writeBatch,
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

function resolveUnit(data: DocumentData): string {
  return typeof data.unit === "string" ? data.unit : "";
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
    const unit = resolveUnit(data);
    return {
      id: docSnap.id,
      text: String(data.text ?? ""),
      checked: Boolean(data.checked),
      quantity,
      unit,
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

function logListenError(error: Error) {
  console.warn("Firestore listener failed", error);
}

export function subscribeLists(onChange: (lists: ListDoc[]) => void): () => void {
  const listsQuery = query(listCollection, orderBy("order", "asc"));
  return onSnapshot(listsQuery, (snapshot) => onChange(mapList(snapshot)), logListenError);
}

export function subscribeItems(listId: string, onChange: (items: ItemDoc[]) => void): () => void {
  const itemsQuery = query(collection(db, "lists", listId, "items"), orderBy("order", "asc"));
  return onSnapshot(itemsQuery, (snapshot) => onChange(mapItems(snapshot)), logListenError);
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
  quantity?: number;
  unit?: string;
}) {
  await addDoc(collection(db, "lists", params.listId, "items"), {
    text: params.text,
    checked: false,
    quantity: params.quantity ?? 1,
    unit: params.unit ?? "",
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
  data: { text?: string; checked?: boolean; quantity?: number; unit?: string; userName: string },
) {
  const payload: {
    text?: string;
    checked?: boolean;
    quantity?: number;
    unit?: string;
    updatedByName: string;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    updatedByName: data.userName,
    updatedAt: serverTimestamp(),
  };
  if (data.text !== undefined) payload.text = data.text;
  if (data.checked !== undefined) payload.checked = data.checked;
  if (data.quantity !== undefined) payload.quantity = data.quantity;
  if (data.unit !== undefined) payload.unit = data.unit;
  await updateDoc(doc(db, "lists", listId, "items", itemId), payload);
  await touchList(listId, data.userName);
}

export async function deleteItem(listId: string, itemId: string, userName: string) {
  await deleteDoc(doc(db, "lists", listId, "items", itemId));
  await touchList(listId, userName);
}

// Firestore allows 500 writes in each batch. Use a lower number for a safety margin.
async function commitInBatches<T>(entries: T[], write: (batch: WriteBatch, entry: T) => void) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(i, i + 400)) write(batch, entry);
    await batch.commit();
  }
}

function itemsOf(listId: string) {
  return getDocs(collection(db, "lists", listId, "items"));
}

export async function updateAllItems(listId: string, checked: boolean, userName: string) {
  const itemsSnap = await itemsOf(listId);
  await commitInBatches(itemsSnap.docs, (batch, item) =>
    batch.update(item.ref, { checked, updatedAt: serverTimestamp(), updatedByName: userName }),
  );
  await touchList(listId, userName);
}

export async function clearAllItems(listId: string, userName: string) {
  const itemsSnap = await itemsOf(listId);
  await commitInBatches(itemsSnap.docs, (batch, item) => batch.delete(item.ref));
  await touchList(listId, userName);
}

export async function clearCheckedItems(listId: string, userName: string) {
  const itemsSnap = await itemsOf(listId);
  const checkedDocs = itemsSnap.docs.filter((docSnap) => Boolean(docSnap.data().checked));
  await commitInBatches(checkedDocs, (batch, item) => batch.delete(item.ref));
  await touchList(listId, userName);
}

export function createDefaultList(params: { userId: string; userName: string }): Promise<string> {
  return createList({ name: "Inbox", userId: params.userId, userName: params.userName, isDefault: true });
}

export async function deleteListWithItems(params: {
  listId: string;
  keepItems: boolean;
  defaultListId?: string;
  userId: string;
  userName: string;
}) {
  const itemsSnap = await itemsOf(params.listId);
  // Do not move items into the list that the user deletes. Firestore would delete them with that list.
  const usableDefault = params.defaultListId === params.listId ? undefined : params.defaultListId;
  const targetListId = params.keepItems
    ? (usableDefault ?? (await createDefaultList({ userId: params.userId, userName: params.userName })))
    : null;

  await commitInBatches(itemsSnap.docs, (batch, item) => {
    if (targetListId) {
      const data = item.data();
      // The rules require createdBy to be the writer, so moved items get the current user as createdBy.
      batch.set(doc(db, "lists", targetListId, "items", item.id), {
        text: String(data.text ?? ""),
        checked: Boolean(data.checked),
        quantity: resolveQuantity(data).quantity,
        unit: resolveUnit(data),
        createdAt: data.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: params.userId,
        createdByName: params.userName,
        updatedByName: params.userName,
        order: resolveOrder(data).order,
      });
    }
    batch.delete(item.ref);
  });

  await deleteDoc(doc(db, "lists", params.listId));
}

// Gives an `order` from the creation time to entries that have none. Their relative order stays the same.
function backfillOrders<T extends { createdAt: Date }>(entries: T[]) {
  return [...entries]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((entry, index) => ({ entry, fallbackOrder: entry.createdAt.getTime() + index }));
}

export async function backfillListOrder(userName: string) {
  const snapshot = await getDocs(listCollection);
  const missing = snapshot.docs
    .filter((docSnap) => !isFiniteNumber(docSnap.data().order))
    .map((docSnap) => ({ ref: docSnap.ref, createdAt: toDate(docSnap.data().createdAt) }));
  if (missing.length === 0) return;

  await commitInBatches(backfillOrders(missing), (batch, { entry, fallbackOrder }) =>
    batch.update(entry.ref, { order: fallbackOrder, updatedAt: serverTimestamp(), updatedByName: userName }),
  );
}

export async function backfillItemOrder(listId: string, userName: string) {
  const itemsSnap = await itemsOf(listId);
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

  await commitInBatches(backfillOrders(missing), (batch, { entry, fallbackOrder }) =>
    batch.update(entry.ref, {
      order: entry.order ?? fallbackOrder,
      quantity: entry.quantity ?? 1,
      updatedAt: serverTimestamp(),
      updatedByName: userName,
    }),
  );
  await touchList(listId, userName);
}

export async function persistListOrder(lists: Array<{ id: string; order: number }>, userName: string) {
  await commitInBatches(lists, (batch, list) =>
    batch.update(doc(db, "lists", list.id), {
      order: list.order,
      updatedAt: serverTimestamp(),
      updatedByName: userName,
    }),
  );
}

export async function persistItemOrder(listId: string, items: Array<{ id: string; order: number }>, userName: string) {
  await commitInBatches(items, (batch, item) =>
    batch.update(doc(db, "lists", listId, "items", item.id), {
      order: item.order,
      updatedAt: serverTimestamp(),
      updatedByName: userName,
    }),
  );
  await touchList(listId, userName);
}
