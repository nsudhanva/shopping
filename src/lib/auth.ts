import {
  browserPopupRedirectResolver,
  signOut as firebaseSignOut,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";
import { useSyncExternalStore } from "react";
import { auth, provider } from "./firebase";

const redirectPendingKey = "shopping-auth-redirect";

function subscribe(onChange: () => void) {
  return onAuthStateChanged(auth, onChange);
}

export function useAuthUser(): User | null {
  return useSyncExternalStore(
    subscribe,
    () => auth.currentUser,
    () => null,
  );
}

export function userLabel(user: User | null): string {
  return user?.displayName ?? user?.email ?? "Someone";
}

export async function signIn() {
  try {
    await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/popup-blocked" && code !== "auth/operation-not-supported-in-this-environment") {
      // A closed popup or a second click is not a reason to leave the page.
      console.warn("Popup sign-in failed", error);
      return;
    }
    console.warn("Popup sign-in unavailable, redirecting", error);
    try {
      sessionStorage.setItem(redirectPendingKey, "1");
    } catch {
      // Without the marker, the app does not collect the redirect result. The user can sign in again.
    }
    await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
  }
}

export async function signOut() {
  await firebaseSignOut(auth);
}

// Auth starts without the redirect resolver, so the app must collect the redirect sign-in result.
export function completeRedirectSignIn() {
  try {
    if (!sessionStorage.getItem(redirectPendingKey)) return;
    sessionStorage.removeItem(redirectPendingKey);
  } catch {
    return;
  }
  getRedirectResult(auth, browserPopupRedirectResolver).catch((error) => {
    console.warn("Redirect sign-in failed", error);
  });
}
