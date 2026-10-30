import { createFileRoute } from "@tanstack/react-router";
import { ShoppingApp } from "../components/ShoppingApp";
import { defaultView, itemPeople, itemShows, itemSorts, listSorts, pick, type View } from "../lib/view";

type Search = { list?: string } & Partial<View>;

// Firestore auto-IDs. The app ignores other values (a "/" makes an invalid collection path).
const listIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

// Default values stay out of the URL, so the URL of the plain view is only ?list=<id>.
function nonDefault<K extends keyof View>(key: K, value: View[K] | undefined) {
  return value === defaultView[key] ? undefined : value;
}

// The URL holds the selected list (?list=<id>) and the view, so users can link to them and Back works.
export const Route = createFileRoute("/")({
  // Set each key in all cases. The router merges this result over the raw search, so a missing key keeps the raw value.
  validateSearch: (search: Record<string, unknown>): Search => ({
    list: typeof search.list === "string" && listIdPattern.test(search.list) ? search.list : undefined,
    sort: nonDefault("sort", pick(itemSorts, search.sort)),
    show: nonDefault("show", pick(itemShows, search.show)),
    who: nonDefault("who", pick(itemPeople, search.who)),
    lists: nonDefault("lists", pick(listSorts, search.lists)),
  }),
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = {
    sort: search.sort ?? defaultView.sort,
    show: search.show ?? defaultView.show,
    who: search.who ?? defaultView.who,
    lists: search.lists ?? defaultView.lists,
  };
  return (
    <ShoppingApp
      requestedListId={search.list}
      onSelectList={(listId, options) => {
        if (listId !== search.list) {
          void navigate({ search: (previous) => ({ ...previous, list: listId }), replace: options?.replace });
        }
      }}
      view={view}
      onViewChange={(change) => {
        const next = { ...view, ...change };
        void navigate({
          search: (previous) => ({
            ...previous,
            sort: nonDefault("sort", next.sort),
            show: nonDefault("show", next.show),
            who: nonDefault("who", next.who),
            lists: nonDefault("lists", next.lists),
          }),
          replace: true,
        });
      }}
    />
  );
}
