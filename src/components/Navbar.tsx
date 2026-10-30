import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signIn, signOut } from "../lib/auth";
import { useShopping } from "../lib/shopping";
import { readStoredTheme, storeTheme, type Theme } from "../lib/storage";

export function Navbar() {
  const { user, homeListId, setSearch } = useShopping();
  // The prerendered HTML uses the dark theme. The inline head script applies a stored light theme before this runs.
  const [theme, setTheme] = useState<Theme>("shopping-dark");
  useEffect(() => setTheme(readStoredTheme()), []);

  function toggleTheme() {
    const next = theme === "shopping-dark" ? "shopping-light" : "shopping-dark";
    storeTheme(next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  return (
    <header className="navbar bg-base-100 px-4 lg:px-8 shadow-sm">
      <div className="flex-none lg:hidden">
        <label htmlFor="lists-drawer-toggle" className="btn btn-square btn-ghost drawer-button">
          <span className="sr-only">Open lists</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            className="inline-block w-5 h-5 stroke-current"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </label>
      </div>
      <div className="flex-1">
        {/* Home: the default list with the default sort and no filters. */}
        <Link
          to="/"
          search={{ list: homeListId }}
          onClick={() => setSearch("")}
          className="flex w-fit items-center gap-3 rounded-lg"
        >
          <div className="avatar avatar-placeholder" aria-hidden="true">
            <div className="bg-primary text-primary-content rounded-xl w-10">
              <span className="text-lg font-bold">S</span>
            </div>
          </div>
          <h1 className="font-bold text-lg">shopping</h1>
        </Link>
      </div>
      <div className="flex-none gap-2 flex items-center">
        <button type="button" className="btn btn-ghost btn-sm hidden sm:inline-flex" onClick={toggleTheme}>
          {theme === "shopping-dark" ? "Light mode" : "Dark mode"}
        </button>
        {user ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
              Sign out
            </button>
            <span className="text-xs text-muted text-right leading-tight max-w-24 sm:max-w-none">
              {user.displayName ?? user.email ?? ""}
            </span>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void signIn()}>
            Sign in with Google
          </button>
        )}
      </div>
    </header>
  );
}
