import type { Location } from "../src/core/types.ts";
import { ApiError } from "./lib/api.ts";
import { formatLocationName } from "./lib/format.ts";
import { nextActiveIndex } from "./lib/listbox.ts";
import type { createRecentStore } from "./lib/recent.ts";

export type LocationOptions = {
  onSelect(loc: Location): void;
  recent: Pick<ReturnType<typeof createRecentStore>, "list">;
  search(q: string): Promise<Location[]>;
  geolocate: Pick<Geolocation, "getCurrentPosition"> | undefined;
};

const MSG_FAIL = "Locatie niet beschikbaar. Zoek een plaats.";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountLocation(container: HTMLElement, opts: LocationOptions): { refreshRecent(): void } {
  const label = h("label", { for: "place-search", class: "visually-hidden" }, "Plaats zoeken");
  const input = h("input", {
    id: "place-search",
    type: "text",
    role: "combobox",
    autocomplete: "off",
    maxlength: "100",
    placeholder: "Bijvoorbeeld Utrecht",
    "aria-expanded": "false",
    "aria-controls": "place-results",
    "aria-autocomplete": "list",
  });
  const list = h("ul", { id: "place-results", role: "listbox", "aria-label": "Zoekresultaten" });
  list.hidden = true;
  const status = h("p", { role: "status", class: "loc-status" });
  const searchBtn = h("button", { type: "button", class: "pill solid" }, "Zoek");
  const search = h("div", { class: "search" });
  search.append(input, searchBtn);
  const geoBtn = h("button", { type: "button", class: "pill" }, "Gebruik mijn locatie");
  const geoStatus = h("p", { role: "status", class: "loc-status" });
  const recentWrap = h("div", { class: "recent" });
  const recentTitle = h("h3", {}, "Recent");
  const recentList = h("ul");
  recentWrap.append(recentTitle, recentList);
  container.replaceChildren(label, search, list, status, geoBtn, geoStatus, recentWrap);

  let results: Location[] = [];
  let active = -1;
  let timer: number | undefined;
  let seq = 0;

  function setActive(i: number): void {
    active = i;
    list.querySelectorAll("li").forEach((li, n) => {
      li.classList.toggle("active", n === i);
      li.setAttribute("aria-selected", String(n === i));
    });
    if (i >= 0) input.setAttribute("aria-activedescendant", `place-opt-${i}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function close(): void {
    window.clearTimeout(timer);
    seq++;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function select(loc: Location): void {
    close();
    input.value = "";
    status.textContent = "";
    opts.onSelect(loc);
  }

  function showResults(found: Location[]): void {
    results = found;
    list.replaceChildren(
      ...found.map((loc, i) => {
        const li = h("li", { id: `place-opt-${i}`, role: "option", "aria-selected": "false" }, formatLocationName(loc.name));
        li.addEventListener("click", () => select(loc));
        return li;
      }),
    );
    list.hidden = found.length === 0;
    input.setAttribute("aria-expanded", String(found.length > 0));
    setActive(-1);
    status.textContent = found.length ? `${found.length} resultaten` : "Geen plaatsen gevonden";
  }

  function query(delay: number): void {
    window.clearTimeout(timer);
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) {
      close();
      status.textContent = "";
      return;
    }
    timer = window.setTimeout(() => {
      opts.search(q).then(
        (found) => mine === seq && showResults(found),
        (e) => {
          if (mine !== seq) return;
          close();
          status.textContent = e instanceof ApiError ? e.message : "Zoeken mislukt. Probeer het opnieuw.";
        },
      );
    }, delay);
  }

  input.addEventListener("input", () => query(250));
  // "Zoek" runs the same search at once; focus goes back to the field so the arrow keys reach the results.
  searchBtn.addEventListener("click", () => {
    input.focus();
    query(0);
  });

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive(nextActiveIndex(active, ev.key, results.length));
    } else if (ev.key === "Enter" && active >= 0 && !list.hidden) {
      ev.preventDefault();
      select(results[active]!);
    } else if (ev.key === "Escape") close();
  });

  // Keep focus in the input while clicking an option, or the blur would close the list before the click lands.
  list.addEventListener("mousedown", (ev) => ev.preventDefault());
  // Close when focus leaves the search field and its results (the geolocate button counts as leaving).
  container.addEventListener("focusout", (ev) => {
    const to = ev.relatedTarget as Node | null;
    if (!to || (to !== input && !list.contains(to))) close();
  });

  geoBtn.addEventListener("click", () => {
    geoStatus.textContent = "";
    if (!opts.geolocate) {
      geoStatus.textContent = MSG_FAIL;
      return;
    }
    opts.geolocate.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) geoStatus.textContent = MSG_FAIL;
        else select({ name: "Huidige locatie", lat, lon });
      },
      () => {
        geoStatus.textContent = MSG_FAIL;
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  });

  function refreshRecent(): void {
    const items = opts.recent.list();
    recentWrap.hidden = items.length === 0;
    recentList.replaceChildren(
      ...items.map((loc) => {
        const li = h("li");
        const b = h("button", { type: "button", class: "pill" }, formatLocationName(loc.name));
        b.addEventListener("click", () => select(loc));
        li.append(b);
        return li;
      }),
    );
  }
  refreshRecent();
  return { refreshRecent };
}
