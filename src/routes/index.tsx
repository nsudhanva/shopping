import { createFileRoute } from "@tanstack/react-router";
import { ShoppingApp } from "../components/ShoppingApp";

type Search = { list?: string };

// Firestore auto-IDs. The app ignores other values (a "/" makes an invalid collection path).
const listIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

// The URL holds the selected list (?list=<id>), so users can link to a list and Back works.
export const Route = createFileRoute("/")({
  // Set `list` in all cases. The router merges this result over the raw search, so a missing key keeps the raw value.
  validateSearch: (search: Record<string, unknown>): Search => ({
    list: typeof search.list === "string" && listIdPattern.test(search.list) ? search.list : undefined,
  }),
  component: Home,
});

function Home() {
  const { list } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ShoppingApp
      requestedListId={list}
      onSelectList={(listId, options) => {
        if (listId !== list) void navigate({ search: { list: listId }, replace: options?.replace });
      }}
    />
  );
}
