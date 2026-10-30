import { useShopping } from "../lib/shopping";
import { defaultView, itemPeople, itemShows, itemSorts, pick } from "../lib/view";

export function ViewToolbar() {
  const { view, setView, search, setSearch, editor } = useShopping();
  const changed =
    view.sort !== defaultView.sort || view.show !== defaultView.show || view.who !== defaultView.who || search !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="search"
        className="input input-sm input-bordered flex-1 min-w-40"
        placeholder="Search items"
        aria-label="Search items"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        className="select select-sm w-auto"
        aria-label="Sort items"
        value={view.sort}
        onChange={(event) => setView({ sort: pick(itemSorts, event.target.value) ?? defaultView.sort })}
      >
        <option value="manual">Sort: my order</option>
        <option value="name">Sort: name</option>
        <option value="newest">Sort: newest added</option>
        <option value="edited">Sort: recently edited</option>
        <option value="tobuy">Sort: to buy first</option>
      </select>
      <select
        className="select select-sm w-auto"
        aria-label="Show items"
        value={view.show}
        onChange={(event) => setView({ show: pick(itemShows, event.target.value) ?? defaultView.show })}
      >
        <option value="all">Show: all</option>
        <option value="tobuy">Show: to buy</option>
        <option value="bought">Show: bought</option>
      </select>
      <select
        className="select select-sm w-auto"
        aria-label="Filter items by person"
        value={view.who}
        disabled={!editor}
        onChange={(event) => setView({ who: pick(itemPeople, event.target.value) ?? defaultView.who })}
      >
        <option value="anyone">By: anyone</option>
        <option value="added-me">Added by me</option>
        <option value="edited-me">Edited by me</option>
      </select>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={!changed}
        onClick={() => {
          setSearch("");
          setView({ sort: defaultView.sort, show: defaultView.show, who: defaultView.who });
        }}
      >
        Reset
      </button>
    </div>
  );
}
