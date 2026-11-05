import type { Actor, Pose, SceneKey } from "./lib/scene-model.ts";
import { sceneFor } from "./lib/scene-model.ts";

const NS = "http:" + "//www.w3.org/2000/svg";
const INK = "var(--ink)";
type Attrs = Record<string, string | number>;

function svg(tag: string, attrs: Attrs = {}, kids: readonly Element[] = [], text?: string): SVGElement {
  const node = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  node.append(...kids);
  return node;
}

const LINE: Attrs = { stroke: INK, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" };
const ln = (attrs: Attrs): Attrs => ({ ...LINE, ...attrs });
const path = (d: string, attrs: Attrs = {}) => svg("path", { d, ...attrs });
const circle = (cx: number, cy: number, r: number, attrs: Attrs = {}) => svg("circle", { cx, cy, r, ...attrs });
const rect = (x: number, y: number, width: number, height: number, rx: number, attrs: Attrs = {}) =>
  svg("rect", { x, y, width, height, rx, ...attrs });
const root = (cls: string, viewBox: string, kids: Element[], extra: Attrs = {}) =>
  svg("svg", { class: cls, viewBox, "aria-hidden": "true", ...extra }, kids);

// Outlined limb: ink underlay plus a coloured core.
const limb = (d: string, fill: string, w = 13): Element[] => [
  path(d, { stroke: INK, "stroke-width": w + 6, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }),
  path(d, { stroke: fill, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }),
];
const hand = (x: number, y: number) => circle(x, y, 10, ln({ fill: "var(--skin)" }));
const radial = (n: number, f: (r: number, i: number) => Element) =>
  Array.from({ length: n }, (_, i) => f((i * 2 * Math.PI) / n, i));

export function house(): SVGElement {
  const bricks = [[20, -20], [190, 30], [200, 96], [150, 190], [230, 236], [12, 300], [40, 372]] as const;
  return root("house", "0 0 300 420", [
    rect(-700, -500, 980, 920, 0, ln({ fill: "var(--brick)" })),
    svg("g", { fill: "var(--brick-shade)" }, bricks.map(([x, y]) => rect(x, y, 38, 12, 3))),
    rect(34, 90, 130, 120, 6, ln({ fill: "var(--window)" })),
    path("M99 90v120M34 150h130", ln({ fill: "none" })),
    rect(24, 208, 150, 14, 4, ln({ fill: "var(--sill)" })),
    rect(148, 262, 34, 22, 5, ln({ fill: "var(--sill)" })),
    svg("text", { x: 165, y: 279, "text-anchor": "middle", class: "nr" }, [], "12"),
    rect(196, 248, 76, 172, 3, ln({ fill: "var(--door)" })),
    rect(210, 264, 48, 58, 5, ln({ fill: "var(--window)" })),
    circle(260, 350, 5, ln({ fill: "var(--sun)", "stroke-width": 2 })),
    rect(186, 410, 96, 10, 3, ln({ fill: "var(--sill)" })),
  ]);
}

const ARMS: Record<Pose, (S: string) => Element[]> = {
  wave: (S) => [...limb("M154 180 L182 138 L194 92", S), hand(194, 88)],
  "point-up": (S) => [...limb("M154 180 L190 138 L222 96", S), hand(224, 92)],
  umbrella: (S) => [...limb("M154 182 L172 196 L170 204", S), hand(170, 204)],
  "closed-umbrella": (S) => [...limb("M154 182 L168 214 L170 236", S), hand(170, 238)],
  "head-scratch": (S) => [...limb("M154 180 L184 126 L152 60", S), hand(150, 58)],
};

const MOUTHS: Record<Pose, () => Element> = {
  wave: () => path("M94 112q14 14 28 0", ln({ fill: "none" })),
  "point-up": () => path("M100 116q8-4 16 0", ln({ fill: "none" })),
  umbrella: () => path("M96 112q12 9 24 0", ln({ fill: "none" })),
  "closed-umbrella": () => path("M92 110q16 16 32 0", ln({ fill: "var(--mouth)" })),
  "head-scratch": () => path("M98 114l20-4", ln({ fill: "none" })),
};

function umbrellaParts(pose: Pose): Element[] {
  if (pose === "umbrella") {
    return [
      path("M170 204V-96", ln({ "stroke-width": 4, fill: "none" })),
      path("M50 -6Q170 -126 290 -6q-20-14-40 0q-20-14-40 0q-20-14-40 0q-20-14-40 0q-20-14-40 0q-20-14-40 0z", ln({ fill: "var(--rain)" })),
      path("M110 -10Q130 -70 170 -98M230 -10Q210 -70 170 -98", { stroke: "var(--rain-3)", "stroke-width": 2, fill: "none" }),
      circle(170, -100, 5, { fill: INK }),
    ];
  }
  if (pose === "closed-umbrella") {
    return [
      path("M170 238q-14 0-14-12", ln({ fill: "none" })),
      path("M170 248q14-2 18 10l6 104q-2 10-12 6l-26-100q-2-14 14-20z", ln({ fill: "var(--rain)" })),
      path("M176 262l8 96", { stroke: "var(--rain-3)", "stroke-width": 2 }),
      path("M188 370l4 18", ln({ fill: "none" })),
    ];
  }
  return [];
}

export function cyclist(pose: Pose): SVGElement {
  const thinking = pose === "point-up" || pose === "head-scratch";
  const eyes = thinking
    ? [circle(96, 88, 5, { fill: INK }), circle(126, 88, 5, { fill: INK }), circle(98, 86, 1.6, { fill: "var(--paper)" }), circle(128, 86, 1.6, { fill: "var(--paper)" })]
    : [circle(92, 92, 5, { fill: INK }), circle(124, 92, 5, { fill: INK })];
  const bubble =
    pose === "head-scratch"
      ? [
          svg("g", { transform: "translate(176 0)" }, [
            path("M10 34q0-26 30-26h20q30 0 30 26q0 24-30 24h-16l-14 14 2-15q-22-3-22-23z", ln({ fill: "var(--paper)" })),
            svg("text", { x: 50, y: 44, "text-anchor": "middle", class: "q" }, [], "?"),
          ]),
        ]
      : [];
  return root("cyclist", "0 0 260 420", [
    ...umbrellaParts(pose),
    rect(80, 244, 24, 146, 12, { fill: INK }),
    rect(114, 244, 24, 146, 12, { fill: INK }),
    path("M60 398q4-16 34-12q4 4 2 16H64q-6 0-4-4z", { fill: INK }),
    path("M158 398q-4-16-34-12q-4 4-2 16h30q6 0 6-4z", { fill: INK }),
    path("M62 178q0-26 30-28h34q30 2 30 28v84q-47 18-94 0z", ln({ fill: "var(--sun)" })),
    path("M96 150q13 14 26 0", ln({ fill: "none" })),
    // left hand rests on the hip, the other arm follows the pose
    ...limb("M66 182 L42 214 L64 240", "var(--sun)"),
    hand(64, 240),
    ...ARMS[pose]("var(--sun)"),
    circle(110, 96, 52, ln({ fill: "var(--skin)" })),
    path("M58 92q-4-58 54-60q54 0 56 54q-10-20-30-26q-6 10-22 10q-22 0-30-12q-16 12-28 34z", ln({ fill: "var(--hair)" })),
    path("M104 34q2-22 22-22q-6 8-4 18", ln({ fill: "var(--hair)" })),
    path("M60 62q50-16 100 0", ln({ "stroke-width": 6, fill: "none" })),
    svg("g", LINE, [circle(92, 58, 13, { fill: "var(--goggle)" }), circle(128, 58, 13, { fill: "var(--goggle)" })]),
    circle(88, 54, 3.5, { fill: "var(--paper)" }),
    circle(124, 54, 3.5, { fill: "var(--paper)" }),
    ...eyes,
    circle(80, 108, 8, { fill: "var(--blush)" }),
    circle(140, 108, 8, { fill: "var(--blush)" }),
    MOUTHS[pose](),
    ...bubble,
  ]);
}

export function bike(): SVGElement {
  const spokes = [0, 30, 60, 90, 120, 150]
    .map((a) => (a * Math.PI) / 180)
    .map((r) => {
      const dx = Math.cos(r) * 52;
      const dy = Math.sin(r) * 52;
      return path(`M${62 - dx} ${134 - dy}L${62 + dx} ${134 + dy}M${234 - dx} ${134 - dy}L${234 + dx} ${134 + dy}`);
    });
  return root("bike", "0 0 300 200", [
    path("M8 112q54-60 108 0", ln({ fill: "none" })),
    path("M180 112q54-60 108 0", ln({ fill: "none" })),
    svg("g", ln({ fill: "var(--wheel)" }), [circle(62, 134, 56), circle(234, 134, 56)]),
    svg("g", { stroke: "var(--spoke)", "stroke-width": 1.5 }, spokes),
    svg("g", ln({ fill: INK }), [circle(62, 134, 6), circle(234, 134, 6)]),
    path("M62 134 120 134 98 64 196 64 234 134M120 134 196 64M98 64 92 46", {
      stroke: "var(--frame)", "stroke-width": 10, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none",
    }),
    circle(120, 134, 14, ln({ fill: "var(--wheel)" })),
    path("M120 134l14 18", ln({ fill: "none" })),
    rect(126, 150, 20, 7, 3, { fill: INK }),
    path("M70 40q22-8 44 0q0 10-22 10t-22-10z", { fill: INK }),
    path("M196 64 188 30q14-10 30-4", ln({ fill: "none" })),
    path("M202 16h52l-6 36h-40z", ln({ fill: "var(--basket)" })),
    path("M215 16v36M228 16v36M241 16v36", { stroke: INK, "stroke-width": 1.5 }),
  ]);
}

export function sun(): SVGElement {
  const rays = radial(8, (r) =>
    path(
      `M${110 + Math.cos(r) * 70} ${110 + Math.sin(r) * 70}L${110 + Math.cos(r) * 96} ${110 + Math.sin(r) * 96}`,
      { "stroke-width": 9 },
    ),
  );
  return root("actor sun", "0 0 220 220", [
    svg("g", LINE, rays),
    circle(110, 110, 54, ln({ fill: "var(--sun)" })),
    path("M90 116q20 18 40 0", ln({ fill: "none" })),
    circle(92, 98, 5, { fill: INK }),
    circle(128, 98, 5, { fill: INK }),
  ]);
}

export function puffs(count: 1 | 2): SVGElement[] {
  const one = (w: number) =>
    root(
      "puff",
      "0 0 140 80",
      [path("M30 68q-24 0-24-20q0-20 22-20q4-22 30-22q22 0 28 18q8-6 18-4q22 4 20 26q16 4 12 16q-2 6-12 6z", ln({ fill: "var(--puff)" }))],
      { width: w },
    );
  return count === 2 ? [one(150), one(110)] : [one(120)];
}

export function grump(mood: "angry" | "calm", drops: number): SVGElement {
  const angry = mood === "angry";
  const cream = { stroke: "var(--cream)", "stroke-width": 4, "stroke-linecap": "round" };
  const brows = path(angry ? "M96 70l22 6M168 76l22-6" : "M96 76l22-4M168 72l22 4", ln({ fill: "none" }));
  const eyes = angry
    ? path("M104 88h16M166 88h16", cream)
    : path("M104 92q8-8 16 0M166 92q8-8 16 0", { ...cream, fill: "none" });
  const rain = drops
    ? [
        svg(
          "g",
          { class: "drops" },
          Array.from({ length: drops }, (_, i) => {
            const x = 60 + i * (170 / Math.max(1, drops - 1));
            const y = 172 + (i % 2) * 30;
            return path(`M${x} ${y}q-8 14 0 20q8-6 0-20z`, ln({ fill: "var(--rain)", "stroke-width": 2 }));
          }),
        ),
      ]
    : [];
  return root("actor grump", "0 0 290 240", [
    ...rain,
    path("M58 160q-48 0-48-38q0-38 44-40q4-50 62-50q40 0 58 30q14-14 36-10q44 8 40 52q34 6 30 34q-4 22-30 22z", ln({ fill: "var(--grump)" })),
    brows,
    eyes,
  ]);
}

function actorEls(a: Actor): SVGElement[] {
  const els = a.kind === "sun" ? [sun()] : a.kind === "puffs" ? puffs(a.count) : [grump(a.mood, a.drops)];
  els.forEach((el, i) => {
    el.classList.add(`spot-${a.spot}`);
    if (a.kind === "sun" && a.small) el.classList.add("small");
    if (a.kind === "puffs" && i > 0) el.classList.add("second");
  });
  return els;
}

export function mountScene(stage: HTMLElement): { set(key: SceneKey): void } {
  const sky = document.createElement("div");
  sky.className = "sky";
  const rider = document.createElement("div");
  rider.className = "rider";
  let figure = cyclist("head-scratch");
  rider.append(figure, bike());
  stage.replaceChildren(sky, house(), rider);
  let last: SceneKey | null = null;
  return {
    set(key) {
      stage.closest(".street")?.setAttribute("data-scene", key);
      if (key === last) return;
      last = key;
      const scene = sceneFor(key);
      sky.replaceChildren(...scene.actors.flatMap(actorEls));
      const next = cyclist(scene.pose);
      figure.replaceWith(next);
      figure = next;
    },
  };
}
