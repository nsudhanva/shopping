import { type ComponentProps, useEffect, useState } from "react";
import { completeRedirectSignIn } from "../lib/auth";
import { ShoppingProvider } from "../lib/shopping";
import { ActiveList } from "./ActiveList";
import { ListsSidebar } from "./ListsSidebar";
import { Navbar } from "./Navbar";

export function ShoppingApp(props: Omit<ComponentProps<typeof ShoppingProvider>, "children">) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(completeRedirectSignIn, []);

  return (
    <ShoppingProvider {...props}>
      <Navbar />
      <div className="drawer lg:drawer-open">
        <input
          id="lists-drawer-toggle"
          type="checkbox"
          className="drawer-toggle"
          aria-label="Show lists"
          checked={drawerOpen}
          onChange={(event) => setDrawerOpen(event.target.checked)}
        />
        <main className="drawer-content p-4 lg:p-6">
          <ActiveList />
        </main>
        <div className="drawer-side z-40">
          <label htmlFor="lists-drawer-toggle" className="drawer-overlay">
            <span className="sr-only">Close lists</span>
          </label>
          <ListsSidebar onListChosen={() => setDrawerOpen(false)} />
        </div>
      </div>
    </ShoppingProvider>
  );
}
