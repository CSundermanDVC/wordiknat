import { ApiError, type HourlyView } from "./lib/api.ts";
import { formatMm } from "./lib/format.ts";
import { buildHourlyModel, selectHour } from "./lib/hourly.ts";

function node(name: string, className: string, text?: string): HTMLElement {
  const n = document.createElement(name);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** An HTML label placed in percent of the plot box via the CSSOM. */
function placed(className: string, text: string, x: number | null, y: number | null): HTMLElement {
  const n = node("span", className, text);
  if (x !== null) n.style.left = `${x}%`;
  if (y !== null) n.style.top = `${y}%`;
  return n;
}

const el = (id: string) => document.getElementById(id)!;

/** Fills the static "Komende 24 uur" markup; the bars, labels and table are rebuilt on every update. */
export function mountHourly(): {
  update(view: HourlyView, now: Date): void;
  showError(e: unknown): void;
  reset(): void;
} {
  const body = el("day-body");
  const error = el("day-error");
  const plot = el("day-plot");
  const slider = el("day-slider") as HTMLInputElement;
  const bars = el("day-bars");
  const dot = el("day-dot");
  const scrub = el("day-scrub");
  let model: ReturnType<typeof buildHourlyModel> | null = null;
  let index = 0;

  function show(i: number): void {
    if (!model || model.hours.length === 0) return;
    index = selectHour(index, i, model.hours.length);
    const h = model.hours[index]!;
    const x = ((index + 0.5) / model.hours.length) * 100;
    el("day-readout").replaceChildren(node("b", "", h.time), ` · ${h.amount}`);
    scrub.style.left = `${x}%`;
    dot.style.left = `${x}%`;
    dot.style.top = `${100 - h.heightPct}%`;
    slider.value = String(index);
    slider.setAttribute("aria-valuetext", h.valueText);
  }

  slider.addEventListener("input", () => show(Number(slider.value)));
  const fromPointer = (e: PointerEvent): void => {
    const rect = plot.getBoundingClientRect();
    if (model && rect.width > 0) show(Math.floor(((e.clientX - rect.left) / rect.width) * model.hours.length));
  };
  plot.addEventListener("pointerdown", (e) => {
    plot.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  plot.addEventListener("pointermove", (e) => {
    if (plot.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  plot.addEventListener("pointerup", (e) => plot.releasePointerCapture(e.pointerId));

  return {
    update(view, now) {
      model = buildHourlyModel(view, now);
      const n = model.hours.length;
      error.textContent = "";
      body.hidden = false;
      el("day-summary").textContent = n === 0 ? "Geen verwachting beschikbaar" : model.summary;
      // Without hours there is nothing to scrub or draw.
      for (const id of ["day-readout", "day-plot", "day-ticks", "day-slider", "day-legend", "day-table"]) el(id).hidden = n === 0;
      bars.replaceChildren(
        ...model.hours.map((h) => {
          const b = node("span", h.cls ? `bar ${h.cls}` : "bar nil");
          if (h.cls) b.style.height = `${h.heightPct}%`;
          return b;
        }),
      );
      el("day-refs").replaceChildren(...model.refs.map((r) => placed("dref", "", null, 100 - r.pct)));
      el("day-labels").replaceChildren(
        placed("lab y-lab", formatMm(model.yMax), null, 0),
        placed("lab y-lab", "0", null, 100),
        ...model.refs.map((r) => placed("lab ref-lab", r.label, null, 100 - r.pct)),
        placed("lab dnow", "nu", 50 / n, null),
      );
      el("day-ticks").replaceChildren(
        ...model.ticks.map((t) => placed(t.every6 ? "lab k6" : "lab", t.text, ((t.index + 0.5) / n) * 100, null)),
      );
      slider.max = String(Math.max(0, n - 1));
      const caption = document.createElement("caption");
      caption.textContent = "Neerslag per uur, komende 24 uur";
      const rows = model.hours.map((h) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = h.time;
        const td = document.createElement("td");
        td.textContent = h.amount;
        tr.append(th, td);
        return tr;
      });
      el("day-table").replaceChildren(caption, ...rows);
      show(0);
    },
    showError(e) {
      model = null;
      body.hidden = true;
      error.textContent = e instanceof ApiError ? e.message : "De 24-uursverwachting kon niet worden geladen.";
    },
    reset() {
      model = null;
      body.hidden = true;
      error.textContent = "";
    },
  };
}
