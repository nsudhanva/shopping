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

function mapList(snapshot: QuerySnapshot<DocumentData>): ListDoc[] {
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: String(data.name ?? "Untitled"),
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      createdBy: String(data.createdBy ?? ""),
      isDefault: Boolean(data.isDefault),
    } satisfies ListDoc;
  });
}

function mapItems(snapshot: QuerySnapshot<DocumentData>): ItemDoc[] {
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      text: String(data.text ?? ""),
      checked: Boolean(data.checked),
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      createdBy: String(data.createdBy ?? ""),
    } satisfies ItemDoc;
  });
}

export function subscribeLists(onChange: (lists: ListDoc[]) => void): () => void {
  const listsQuery = query(listCollection, orderBy("updatedAt", "desc"));
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
    orderBy("createdAt", "asc")
  );
  return onSnapshot(itemsQuery, (snapshot) => {
    onChange(mapItems(snapshot));
  });
}

export async function createList(params: {
  name: string;
  userId: string;
  isDefault: boolean;
}): Promise<string> {
  const ref = await addDoc(listCollection, {
    name: params.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.userId,
    isDefault: params.isDefault,
  });
  return ref.id;
}

export async function updateList(listId: string, data: { name?: string }) {
  await updateDoc(doc(db, "lists", listId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function touchList(listId: string) {
  await updateDoc(doc(db, "lists", listId), {
    updatedAt: serverTimestamp(),
  });
}

export async function createItem(params: {
  listId: string;
  text: string;
  userId: string;
}) {
  await addDoc(collection(db, "lists", params.listId, "items"), {
    text: params.text,
    checked: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.userId,
  });
  await touchList(params.listId);
}

export async function updateItem(
  listId: string,
  itemId: string,
  data: { text?: string; checked?: boolean }
) {
  await updateDoc(doc(db, "lists", listId, "items", itemId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  await touchList(listId);
}

export async function deleteItem(listId: string, itemId: string) {
  await deleteDoc(doc(db, "lists", listId, "items", itemId));
  await touchList(listId);
}

export function chunkDocs<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export async function updateAllItems(listId: string, checked: boolean) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.update(item.ref, {
        checked,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await touchList(listId);
}

export async function clearAllItems(listId: string) {
  const itemsSnap = await getDocs(collection(db, "lists", listId, "items"));
  const batches = chunkDocs(itemsSnap.docs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      batch.delete(item.ref);
    }
    await batch.commit();
  }
  await touchList(listId);
}

export async function clearCheckedItems(listId: string) {
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
  await touchList(listId);
}

export async function ensureDefaultListId(params: {
  existingId?: string;
  userId: string;
}): Promise<string> {
  if (params.existingId) return params.existingId;
  return createList({ name: "Inbox", userId: params.userId, isDefault: true });
}

export async function deleteListWithItems(params: {
  listId: string;
  keepItems: boolean;
  defaultListId?: string;
  userId: string;
}) {
  const itemsSnap = await getDocs(collection(db, "lists", params.listId, "items"));
  const itemDocs = itemsSnap.docs;
  const defaultListId = params.keepItems
    ? await ensureDefaultListId({ existingId: params.defaultListId, userId: params.userId })
    : null;

  const batches = chunkDocs(itemDocs, 400);
  for (const batchDocs of batches) {
    const batch = writeBatch(db);
    for (const item of batchDocs) {
      if (params.keepItems && defaultListId) {
        const targetRef = doc(db, "lists", defaultListId, "items", item.id);
        const data = item.data();
        batch.set(targetRef, {
          text: String(data.text ?? ""),
          checked: Boolean(data.checked),
          createdAt: data.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: params.userId,
        });
      }
      batch.delete(item.ref);
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, "lists", params.listId));
}
