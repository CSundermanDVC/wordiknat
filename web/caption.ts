import { heroView, type Caption, type HeroInput, type HeroView } from "./lib/answer-state.ts";
import { formatTime } from "./lib/format.ts";

export type CaptionEls = Record<"summary" | "detail" | "issued" | "status" | "announce", HTMLElement>;

const captionOf = (view: HeroView): Caption => (view.mode === "state" ? view.view : view.caption);

export function mountCaption(els: CaptionEls): { update(input: HeroInput, now: Date): HeroView; tick(now: Date): void } {
  let input: HeroInput | null = null;
  let announced: string | null = null;

  function paint(current: HeroInput, now: Date): HeroView {
    const view = heroView(current, now);
    const c = captionOf(view);
    const strong = document.createElement("strong");
    strong.textContent = c.emphasis;
    const parts = c.emphasis ? [c.before && `${c.before} `, strong, c.after && ` ${c.after}`] : [c.sentence];
    els.summary.replaceChildren(...parts.filter((p) => p !== ""));
    els.detail.textContent = c.detail;
    const { forecast, error } = current;
    els.issued.textContent = forecast
      ? `KNMI-verwachting van ${formatTime(forecast.issuedAt)} · ${error === null ? "ververst elke 5 minuten" : "verouderd"}`
      : "";
    // #status is a polite live region: rewriting identical text every minute can re-announce it.
    const status = forecast && error !== null ? `Fout: ${error}` : "";
    if (els.status.textContent !== status) els.status.textContent = status;
    return view;
  }

  return {
    update(next, now) {
      input = next;
      const view = paint(next, now);
      els.summary.classList.add("fade");
      const c = captionOf(view);
      // The live region speaks only when the state, the place or the forecast changes, never on the countdown.
      const key = JSON.stringify([c.label, next.location?.name ?? null, next.forecast?.issuedAt.getTime() ?? null]);
      if (key !== announced) {
        announced = key;
        els.announce.textContent = `${c.label}. ${c.sentence}`;
      }
      return view;
    },
    tick(now) {
      if (input) paint(input, now);
    },
  };
}
