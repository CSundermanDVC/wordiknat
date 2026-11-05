import type { ForecastView } from "./lib/api.ts";
import { formatMm, formatTime, scrubLabel } from "./lib/format.ts";
import { buildGraphModel, nearestIndex, stepIndex } from "./lib/graph-model.ts";

const NS = "http://www.w3.org/2000/svg";
const FULL = { top: 0, right: 0, bottom: 0, left: 0 };

function svgEl(name: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function htmlEl(name: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(name);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** An HTML label placed in percent of the plot box via the CSSOM. */
function placed(className: string, text: string, x: number | null, y: number | null): HTMLElement {
  const node = htmlEl("span", className, text);
  if (x !== null) node.style.left = `${x}%`;
  if (y !== null) node.style.top = `${y}%`;
  return node;
}

export function mountGraph(
  container: HTMLElement,
  opts: { onSelect?(index: number): void } = {},
): { update(forecast: ForecastView, now: Date): void; show(index: number): void } {
  const label = htmlEl("p", "readout");
  label.setAttribute("aria-hidden", "true");
  const caption = htmlEl("p", "visually-hidden");
  caption.setAttribute("aria-hidden", "true"); // names the svg via aria-labelledby; hidden so it is not read twice
  caption.id = "graph-caption";
  const svg = svgEl("svg", {
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none",
    role: "img",
    "aria-labelledby": caption.id,
  });
  const dynamic = svgEl("g");
  const marker = svgEl("line", { class: "graph-scrub", y1: 0, y2: 100 });
  svg.append(dynamic, marker);
  const labels = htmlEl("div", "graph-labels");
  const dot = htmlEl("span", "graph-dot");
  const ticks = htmlEl("div", "graph-ticks");
  // Slider lives outside the role=img svg so assistive tech can see it.
  const target = htmlEl("div", "graph-target");
  for (const [k, v] of Object.entries({
    tabindex: 0,
    role: "slider",
    "aria-label": "Tijdstip in de verwachting",
    "aria-valuemin": 0,
    "aria-orientation": "horizontal",
  })) target.setAttribute(k, String(v));
  const plot = htmlEl("div", "graph-plot");
  plot.append(svg, labels, dot, target);
  const chart = htmlEl("div", "graph-chart");
  chart.append(plot, ticks);
  const table = document.createElement("table");
  table.className = "visually-hidden";
  container.append(label, chart, caption, table);

  let forecast: ForecastView | null = null;
  let xs: number[] = [];
  let ys: number[] = [];
  let defaultIndex = 0;
  let index = 0;

  function show(i: number): void {
    if (!forecast || i < 0 || i >= forecast.points.length) return;
    index = i;
    marker.classList.remove("graph-hidden");
    dot.classList.remove("graph-hidden");
    const p = forecast.points[i];
    const text = scrubLabel(p);
    label.replaceChildren(htmlEl("b", "", formatTime(p.time)), ` · ${formatMm(p.mmPerHour)} mm/u`);
    marker.setAttribute("x1", String(xs[i]));
    marker.setAttribute("x2", String(xs[i]));
    dot.style.left = `${xs[i]}%`;
    dot.style.top = `${ys[i]}%`;
    target.setAttribute("aria-valuenow", String(i));
    target.setAttribute("aria-valuetext", text);
  }

  function select(i: number): void {
    show(i);
    if (forecast && i >= 0 && i < forecast.points.length) opts.onSelect?.(i);
  }

  const fromPointer = (e: PointerEvent): void => {
    const rect = plot.getBoundingClientRect();
    if (rect.width > 0) select(nearestIndex(((e.clientX - rect.left) / rect.width) * 100, xs));
  };
  target.addEventListener("pointerdown", (e) => {
    target.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  target.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || target.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  target.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !target.hasPointerCapture(e.pointerId)) select(defaultIndex);
  });
  target.addEventListener("pointerup", (e) => target.releasePointerCapture(e.pointerId));
  target.addEventListener("keydown", (e) => {
    if (!forecast) return;
    if (e.key === "Escape") select(defaultIndex);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      select(stepIndex(index, e.key, forecast.points.length));
    } else return;
    e.preventDefault();
  });

  return {
    show,
    update(next, now) {
      forecast = next;
      const pts = next.points;
      const model = buildGraphModel(pts, now, { width: 100, height: 100, padding: FULL });
      xs = model.xs;
      ys = model.ys;

      const nodes: SVGElement[] = [];
      for (const l of model.lines) nodes.push(svgEl("line", { class: "graph-ref", x1: 0, x2: 100, y1: l.y, y2: l.y }));
      if (model.areaPath) {
        nodes.push(svgEl("path", { class: "graph-area", d: model.areaPath }), svgEl("path", { class: "graph-line", d: model.linePath }));
      }
      if (model.nowX !== null) nodes.push(svgEl("line", { class: "graph-now", x1: model.nowX, x2: model.nowX, y1: 0, y2: 100 }));
      nodes.push(svgEl("line", { class: "graph-base", x1: 0, x2: 100, y1: 100, y2: 100 }));
      dynamic.replaceChildren(...nodes);

      const html: HTMLElement[] = [
        placed("lab y-lab", "0", null, 100),
        placed("lab y-lab", formatMm(model.yMax), null, 0),
        ...model.lines.map((l) => placed("lab ref-lab", `${l.label} ${formatMm(l.mm)}`, null, l.y)),
      ];
      if (model.nowX !== null) html.push(placed("lab now-lab", "nu", model.nowX, null));
      labels.replaceChildren(...html);
      ticks.replaceChildren(...model.timeLabels.map((t) => placed("lab tick", t.text, t.x, null)));

      caption.textContent = `${next.summary} Maximaal ${formatMm(next.maxMmPerHour)} mm/u.`;
      const cap = document.createElement("caption");
      cap.textContent = "Neerslagverwachting per vijf minuten";
      const head = document.createElement("tr");
      for (const h of ["Tijd", "mm/u"]) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = h;
        head.append(th);
      }
      const rows = pts.map((p) => {
        const tr = document.createElement("tr");
        for (const v of [formatTime(p.time), formatMm(p.mmPerHour)]) {
          const td = document.createElement("td");
          td.textContent = v;
          tr.append(td);
        }
        return tr;
      });
      table.replaceChildren(cap, head, ...rows);

      target.setAttribute("aria-valuemax", String(Math.max(0, pts.length - 1)));
      defaultIndex = nearestIndex(model.nowX ?? xs[0] ?? 0, xs);
      if (pts.length > 0) show(defaultIndex);
      else {
        label.textContent = "";
        marker.classList.add("graph-hidden");
        dot.classList.add("graph-hidden");
        target.removeAttribute("aria-valuenow");
        target.removeAttribute("aria-valuetext");
      }
    },
  };
}
