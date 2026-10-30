// localStorage can throw an error (private browsing, blocked storage). Then each access returns "nothing stored".

export type Theme = "shopping-dark" | "shopping-light";

const themeKey = "shopping-theme";
const selectedListKey = "shopping-selected-list-id";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export function readStoredTheme(): Theme {
  return read(themeKey) === "shopping-light" ? "shopping-light" : "shopping-dark";
}

export function storeTheme(theme: Theme) {
  write(themeKey, theme);
}

export function readStoredListId(): string | null {
  return read(selectedListKey);
}

export function storeSelectedListId(listId: string | null) {
  write(selectedListKey, listId);
}

// Runs inline in <head> before the first paint, so a stored light theme does not show dark first.
export const themeBootScript = `try{if(localStorage.getItem("${themeKey}")==="shopping-light")document.documentElement.dataset.theme="shopping-light"}catch{}`;
