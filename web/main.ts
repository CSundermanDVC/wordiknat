import type { Location } from "../src/core/types.ts";
import { ApiError, fetchForecast, searchPlaces, type ForecastView } from "./lib/api.ts";
import { mountCaption } from "./caption.ts";
import { mountGraph } from "./graph.ts";
import { mountLocation } from "./location.ts";
import { mountMap } from "./map.ts";
import { fetchRadar, nowIndex } from "./lib/radar-data.ts";
import { formatLocationName, staleRadarMessage } from "./lib/format.ts";
import { createRecentStore } from "./lib/recent.ts";
import { createRefresher } from "./lib/refresh.ts";
import { type SceneKey, sceneAtStep, sceneKeyOf } from "./lib/scene-model.ts";
import { mountScene } from "./scene.ts";

export type State = { location: Location | null; forecast: ForecastView | null; error: string | null };

let state: State = { location: null, forecast: null, error: null };

// 1.8 and 1.9 register here instead of reshaping this file.
export const renderHooks: Array<(s: State) => void> = [];

const graphEl = document.getElementById("graph")!;
let scene: ReturnType<typeof mountScene>;
let sceneKey: SceneKey = "neutral"; // what the real answer shows; a graph or map scrub overrides it until the next render
// The point index graph, map and scene share; -1 until the user picks a step. Equal index = no call, so the panels never echo.
let selected = -1;
let lastRadar: Awaited<ReturnType<typeof fetchRadar>> | null = null;
const graph = mountGraph(graphEl, {
  onSelect(i) {
    const pts = state.forecast?.points;
    const p = pts?.[i];
    if (!pts || !p || i === selected) return;
    scene.set(sceneAtStep(pts, i, new Date()) ?? sceneKey);
    selected = i;
    if (lastRadar) map.setStep(nowIndex(lastRadar.times, p.time));
  },
});
renderHooks.push((s) => {
  graphEl.hidden = !s.forecast;
  selected = -1;
  if (s.forecast) graph.update(s.forecast, new Date());
});

const map = mountMap(document.getElementById("map")!, {
  onStep(time) {
    const pts = state.forecast?.points;
    if (!pts?.length) return;
    const i = nowIndex(pts.map((p) => p.time), time);
    if (i === selected) return;
    selected = i;
    graph.show(i);
    scene.set(sceneAtStep(pts, i, new Date()) ?? sceneKey);
  },
});
renderHooks.push((s) => map.setPin(s.location));

async function loadRadar(): Promise<void> {
  try {
    const radar = await fetchRadar();
    lastRadar = radar;
    map.setRadar(radar);
  } catch (e) {
    const msg = lastRadar
      ? staleRadarMessage(lastRadar.issuedAt)
      : e instanceof ApiError
        ? e.message
        : "De radar kon niet worden geladen.";
    map.setRadar(lastRadar, msg);
  }
}

const el = (id: string) => document.getElementById(id)!;

scene = mountScene(el("stage"));
const status = document.createElement("p");
status.id = "status";
status.className = "status";
status.setAttribute("role", "status");
el("issued").after(status);
const caption = mountCaption({ summary: el("summary"), detail: el("detail"), issued: el("issued"), status, announce: el("announce") });

const pill = el("place-pill");
const pickerEl = el("picker");
const panels = document.querySelector<HTMLElement>(".panels")!;

function showPicker(open: boolean): void {
  pickerEl.hidden = !open;
  pill.setAttribute("aria-expanded", String(open));
}

function render(): void {
  const view = caption.update(state, new Date());
  sceneKey = sceneKeyOf(view);
  scene.set(sceneKey);
  el("place-name").textContent = state.location ? formatLocationName(state.location.name) : "Kies een plaats";
  panels.hidden = !state.location;
  if (!state.location) showPicker(true);
  for (const hook of renderHooks) hook(state);
}

let seq = 0;

export async function loadLocation(loc: Location): Promise<void> {
  const mine = ++seq;
  const sameSpot = state.location?.lat === loc.lat && state.location?.lon === loc.lon;
  // A different place must not show the previous place's forecast.
  state = { location: loc, forecast: sameSpot ? state.forecast : null, error: null };
  if (!state.forecast) render();
  try {
    const forecast = await fetchForecast({ lat: loc.lat, lon: loc.lon });
    if (mine !== seq) return;
    state = { location: loc, forecast, error: null };
  } catch (e) {
    if (mine !== seq) return;
    const error = e instanceof ApiError ? e.message : "Er ging iets mis. Probeer het later opnieuw.";
    state = { ...state, error };
  }
  render();
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const recent = createRecentStore(storage());
const picker = mountLocation(el("location"), {
  onSelect: (loc) => {
    void loadLocation(loc);
    recent.add(loc);
    picker.refreshRecent();
    showPicker(false);
    pill.focus();
  },
  recent,
  search: (q) => searchPlaces(q),
  geolocate: "geolocation" in navigator ? navigator.geolocation : undefined,
});
const refresher = createRefresher({
  run: () => Promise.all([state.location ? loadLocation(state.location) : undefined, loadRadar()]),
  now: () => Date.now(),
  isVisible: () => document.visibilityState === "visible",
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (h) => window.clearTimeout(h as number),
});

pill.addEventListener("click", () => {
  const open = !state.location || pickerEl.hidden;
  showPicker(open);
  if (open) el("place-search").focus();
});
// Capture phase: see whether the results list is open before the combobox's own Escape closes it.
pickerEl.addEventListener(
  "keydown",
  (ev) => {
    if (ev.key !== "Escape" || !state.location || !el("place-results").hidden) return;
    showPicker(false);
    pill.focus();
  },
  true,
);

// The visible countdown follows the clock: one tick per full minute while the tab is visible.
let tickTimer: number | undefined;
function scheduleTick(): void {
  window.clearTimeout(tickTimer);
  if (document.visibilityState !== "visible") return;
  tickTimer = window.setTimeout(() => {
    caption.tick(new Date());
    scheduleTick();
  }, 60_000 - (Date.now() % 60_000));
}

document.addEventListener("visibilitychange", () => {
  refresher.onVisibilityChange();
  if (document.visibilityState === "visible") caption.tick(new Date());
  scheduleTick();
});

showPicker(false);
const initial = recent.list()[0];
if (initial) void loadLocation(initial);
else render();
void loadRadar();
refresher.start();
scheduleTick();
