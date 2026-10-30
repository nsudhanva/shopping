import { initializeApp } from "firebase/app";
import { browserLocalPersistence, GoogleAuthProvider, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDjK2UwzJpl_f-PhTCTHz_EENkypKiI7Jg",
  authDomain: "sudhanva-personal.firebaseapp.com",
  projectId: "sudhanva-personal",
  storageBucket: "sudhanva-personal.firebasestorage.app",
  messagingSenderId: "677321535908",
  appId: "1:677321535908:web:1e074c401cb1503df75131",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
// Use initializeAuth, not getAuth. getAuth registers the popup/redirect resolver, which loads Google's
// ~130 KB auth iframe on each visit. Sign-in gives the resolver itself (see lib/auth.ts).
export const auth = initializeAuth(app, { persistence: browserLocalPersistence });
export const provider = new GoogleAuthProvider();

// Only voice features call Cloud Functions, so the app loads the SDK on first use or on preload.
export function loadFunctionsSdk() {
  return import("firebase/functions");
}

export async function callFunction<Req, Res>(name: string, data: Req): Promise<Res> {
  const { getFunctions, httpsCallable } = await loadFunctionsSdk();
  const result = await httpsCallable<Req, Res>(getFunctions(app, "us-east1"), name)(data);
  return result.data;
}
