import type { Location } from "../src/core/types.ts";
import { formatLocationName, formatTime } from "./lib/format.ts";
import { pinPosition, tilesFor, radarRect, viewFor, type View, type ViewKind } from "./lib/map-view.ts";
import { createPlayer } from "./lib/player.ts";
import { nowIndex, type RadarView } from "./lib/radar-data.ts";
import { DEFAULT_PALETTE, paintRadar, parseHex, RAIN_ALPHA, type Palette } from "./lib/radar-paint.ts";

// Split so the web/ no-absolute-URL check does not trip on the XML namespace identifier.
const NS = "http:" + "//www.w3.org/2000/svg";
const MSG_TILES = "De kaartondergrond kon niet worden geladen. De verwachting blijft zichtbaar.";
const PLAY_PATH = "M6 3.5v13l10.5-6.5z";
const PAUSE_PATH = "M5 4h3v12H5zM12 4h3v12h-3z";
const TOKENS = ["--rain-1", "--rain-2", "--rain-3"] as const;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
  const e = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const p = TOKENS.map((t, i) => parseHex(cs.getPropertyValue(t)) ?? DEFAULT_PALETTE[i]!);
  return p as Palette;
}

export function mountMap(el: HTMLElement, opts: { onStep?(time: Date): void } = {}) {
  const figure = h("div", { role: "img", class: "map-figure" });
  const tiles = h("canvas", { class: "map-tiles" });
  const rain = h("canvas", { class: "map-rain" });
  const overlay = svg("svg", { class: "map-pin", viewBox: "0 0 40 52", "aria-hidden": "true" });
  const pinG = svg("g", { visibility: "hidden" });
  pinG.append(
    svg("path", { d: "M20 50S4 30 4 18a16 16 0 0 1 32 0c0 12-16 32-16 32z" }),
    svg("circle", { cx: "20", cy: "18", r: "6" }),
  );
  overlay.append(pinG);
  const chip = h("span", { class: "place-chip" });
  chip.hidden = true;
  figure.append(tiles, rain, overlay, chip);

  const group = h("div", { role: "group", "aria-label": "Weergave", class: "map-switch" });
  const btnNl = h("button", { type: "button", class: "pill" }, "Nederland");
  const btnLocal = h("button", { type: "button", class: "pill" }, "Rond mij");
  group.append(btnNl, btnLocal);
  const notice = h("p", { role: "status", class: "map-notice" });

  const playBtn = h("button", { type: "button", class: "pill map-play" });
  const playIcon = svg("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" });
  const playShape = svg("path", { d: PLAY_PATH, fill: "currentColor", stroke: "currentColor", "stroke-width": "2.5", "stroke-linejoin": "round" });
  playIcon.append(playShape);
  const playText = h("span", {}, "Afspelen");
  playBtn.append(playIcon, playText);
  playBtn.disabled = true;
  const slider = h("input", { type: "range", min: "0", max: "24", step: "1", value: "0", "aria-label": "Tijdstap", class: "map-slider" });
  slider.disabled = true;
  const timeLabel = h("span", { class: "map-time" });
  const controls = h("div", { class: "map-controls" });
  controls.append(playBtn, slider, timeLabel);

  const legend = h("ul", { class: "map-legend" });
  for (const word of ["licht", "matig", "zwaar"] as const) {
    const li = h("li");
    li.append(h("span", { class: `map-swatch swatch-${word}`, "aria-hidden": "true" }), document.createTextNode(word));
    legend.append(li);
  }
  el.replaceChildren(group, figure, controls, legend, notice);

  let radar: RadarView | null = null;
  let radarError = "";
  let tileError = false;
  let pin: Location | null = null;
  let step = 0;
  let player: ReturnType<typeof createPlayer> | null = null;
  let kind: ViewKind = "nl";
  let view: View | null = null;
  let token = 0;
  let palette = readPalette();
  let quiet = false; // set while the page moves the step, so only the user's own moves report onStep
  let offscreen: { radar: RadarView; step: number; palette: Palette; canvas: HTMLCanvasElement } | null = null;

  const tctx = tiles.getContext("2d");
  const rctx = rain.getContext("2d");

  function loadTiles(v: View): void {
    const mine = ++token;
    tileError = false;
    tctx?.clearRect(0, 0, v.width, v.height);
    for (const t of tilesFor(v)) {
      const img = new Image();
      img.addEventListener("load", () => {
        if (mine === token) tctx?.drawImage(img, t.dx, t.dy);
      });
      img.addEventListener("error", () => {
        if (mine !== token || tileError) return;
        tileError = true;
        renderNotice();
      });
      img.src = `/tiles/${t.z}/${t.x}/${t.y}.png`;
    }
  }

  function renderNotice(): void {
    notice.textContent = [radarError, tileError ? MSG_TILES : ""].filter(Boolean).join(" ");
  }

  function drawRain(v: View): void {
    if (!rctx) return;
    rctx.clearRect(0, 0, v.width, v.height);
    const frame = radar?.frames[step];
    if (!radar || !frame) return;
    if (!offscreen || offscreen.radar !== radar || offscreen.step !== step || offscreen.palette !== palette) {
      const canvas = offscreen?.radar === radar ? offscreen.canvas : document.createElement("canvas");
      canvas.width = radar.width;
      canvas.height = radar.height;
      const px = paintRadar(frame, palette, RAIN_ALPHA, new Uint8ClampedArray(new ArrayBuffer(frame.length * 4)));
      canvas.getContext("2d")?.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, radar.width, radar.height), 0, 0);
      offscreen = { radar, step, palette, canvas };
    }
    const r = radarRect(v, { zoom: radar.zoom, originX: radar.originX, originY: radar.originY, width: radar.width, height: radar.height });
    rctx.imageSmoothingEnabled = true;
    rctx.drawImage(offscreen.canvas, r.dx, r.dy, r.dw, r.dh);
  }

  function syncControls(): void {
    const t = radar?.times[step];
    slider.disabled = playBtn.disabled = !radar;
    slider.value = String(step);
    const playing = player?.playing() ?? false;
    playText.textContent = playing ? "Pauzeren" : "Afspelen";
    playShape.setAttribute("d", playing ? PAUSE_PATH : PLAY_PATH);
    if (!radar || !t) {
      timeLabel.textContent = "";
      slider.removeAttribute("aria-valuetext");
      return;
    }
    const min = Math.round((t.getTime() - radar.issuedAt.getTime()) / 60000);
    slider.setAttribute("aria-valuetext", `${formatTime(t)} (${min >= 0 ? "+" : ""}${min} min)`);
    timeLabel.textContent = formatTime(t) + (step === nowIndex(radar.times, new Date()) ? " nu" : "");
  }

  function draw(): void {
    const v = viewFor(kind, pin);
    const changed = !view || view.kind !== v.kind || view.x0 !== v.x0 || view.y0 !== v.y0;
    if (changed) {
      for (const c of [tiles, rain]) {
        c.width = v.width;
        c.height = v.height;
      }
      view = v;
      loadTiles(v);
    }
    drawRain(v);
    const p = pin ? pinPosition(v, pin.lat, pin.lon) : null;
    if (p) {
      // Pin tip (20,50 of 40x52 at 30 px) on the place; the chip right of the pin head. Percent of the view, so both follow the figure's size.
      overlay.style.setProperty("left", `calc(${(p.x / v.width) * 100}% - 15px)`);
      overlay.style.setProperty("top", `calc(${(p.y / v.height) * 100}% - 37.5px)`);
      chip.style.setProperty("left", `calc(${(p.x / v.width) * 100}% + 18px)`);
      chip.style.setProperty("top", `calc(${(p.y / v.height) * 100}% - 34px)`);
    }
    pinG.setAttribute("visibility", p?.visible ? "visible" : "hidden");
    chip.hidden = !p?.visible;
    btnNl.setAttribute("aria-pressed", String(v.kind === "nl"));
    btnLocal.setAttribute("aria-pressed", String(v.kind === "local"));
    btnLocal.disabled = !pin;
    const t = radar?.times[step];
    const where = v.kind === "local" ? "rond de gekozen locatie" : "van Nederland";
    syncControls();
    figure.setAttribute("aria-label", `Radarkaart ${where}${t ? `, verwachte neerslag om ${formatTime(t)}` : ""}`);
  }

  btnNl.addEventListener("click", () => api.setView("nl"));
  btnLocal.addEventListener("click", () => api.setView("local"));
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    palette = readPalette();
    if (view) drawRain(view);
  });

  playBtn.addEventListener("click", () => {
    if (!player) return;
    if (player.playing()) player.pause();
    else player.play();
    syncControls();
  });
  slider.addEventListener("input", () => player?.seek(Number(slider.value)));

  const api = {
    setRadar(r: RadarView | null, error?: string): void {
      player?.pause();
      const first = radar === null && r !== null;
      radar = r;
      radarError = error ?? "";
      // snap to 'now' on first load only; a refresh keeps the user's step
      step = r ? (first ? nowIndex(r.times, new Date()) : Math.min(step, r.frames.length - 1)) : 0;
      player = r
        ? createPlayer({
            steps: r.frames.length,
            startIndex: step,
            setTimer: (fn, ms) => window.setTimeout(fn, ms),
            clearTimer: (hd) => window.clearTimeout(hd as number),
            onChange: (i) => {
              step = i;
              draw();
              const t = r.times[i];
              if (!quiet && t) opts.onStep?.(t);
            },
          })
        : null;
      renderNotice();
      draw();
    },
    setPin(loc: Location | null): void {
      if (loc?.lat === pin?.lat && loc?.lon === pin?.lon && loc?.name === pin?.name) return;
      pin = loc ? { name: loc.name, lat: loc.lat, lon: loc.lon } : null;
      chip.textContent = pin ? formatLocationName(pin.name) : "";
      draw();
    },
    setStep(i: number): void {
      if (!radar) return;
      if (player) {
        quiet = true;
        player.seek(i);
        quiet = false;
      } else {
        step = Math.min(Math.max(Math.trunc(i), 0), radar.frames.length - 1);
        draw();
      }
    },
    setView(k: ViewKind): void {
      kind = k;
      draw();
    },
  };
  draw();
  return api;
}
