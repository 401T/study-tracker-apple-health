/** Reusable presentational pieces. Pure functions → Safe HTML. */

import { durationParts, fmtDuration, fmtSignedDuration, fmtPercent } from "../analytics/format";
import type { Comparison } from "../analytics";
import { icon } from "../design-system/icons";
import { attr, html, raw, type Safe } from "./html";

/** "2時間15分" with large numerals and small units; aria-label carries the plain text. */
export function metric(sec: number, size: "" | "xl" | "m" = ""): Safe {
  const { h, m } = durationParts(sec);
  const parts = h
    ? html`${h}<span class="unit">時間</span>${m ? html`${m}<span class="unit">分</span>` : ""}`
    : html`${m}<span class="unit">分</span>`;
  return html`<div class="metric ${size}" role="text" aria-label="${fmtDuration(sec)}">${parts}</div>`;
}

export function cardHeader(opts: { icon: string; label: string; color?: string; meta?: string; chevron?: boolean }): Safe {
  const ink = opts.color ? `--cat-ink: var(--subject-${opts.color}-ink)` : "";
  return html`<div class="card-header">
    <span class="cat" style="${ink}">${raw(icon(opts.icon))}${opts.label}</span>
    ${opts.meta || opts.chevron ? html`<span class="meta">${opts.meta ?? ""}${opts.chevron ? raw(icon("chevronRight")) : ""}</span>` : ""}
  </div>`;
}

export function subjectIcon(color: string, name = "subjects"): Safe {
  return html`<span class="row-icon" style="--cat: var(--subject-${color})">${raw(icon(name))}</span>`;
}

/** Change vs previous period. Uses arrow + sign + words, so it never relies on color alone. */
export function delta(c: Comparison, noun = "前期間"): Safe {
  const dir = Math.abs(c.deltaSec) < 60 ? "flat" : c.deltaSec > 0 ? "up" : "down";
  const pct = c.deltaRatio === null ? "" : `（${c.deltaRatio > 0 ? "+" : c.deltaRatio < 0 ? "−" : ""}${fmtPercent(Math.abs(c.deltaRatio))}）`;
  const text = dir === "flat" ? `${noun}と同じ` : `${noun}より${fmtSignedDuration(c.deltaSec)}${pct}`;
  return html`<span class="delta ${dir}">${raw(icon(dir === "up" ? "arrowUp" : dir === "down" ? "arrowDown" : "minus"))}${text}</span>`;
}

export function segmented(name: string, options: { value: string; label: string }[], value: string, action: string): Safe {
  return html`<div class="segmented" role="radiogroup" aria-label="${name}">${options.map(
    (o) => html`<button type="button" role="radio" aria-checked="${o.value === value}" data-action="${action}" data-value="${o.value}">${o.label}</button>`,
  )}</div>`;
}

export function empty(opts: { icon: string; title: string; text: string; actions?: Safe }): Safe {
  return html`<div class="empty">${raw(icon(opts.icon))}<h3>${opts.title}</h3><p>${opts.text}</p>${opts.actions ?? ""}</div>`;
}

export function rowButton(opts: {
  action: string; data?: Record<string, string>; title: string | Safe; sub?: string | Safe; value?: string | Safe;
  leading?: Safe; chevron?: boolean; label?: string; strong?: boolean;
}): Safe {
  const data = Object.entries(opts.data ?? {}).map(([k, v]) => attr(`data-${k}`, v));
  return html`<button type="button" class="row${opts.leading ? " has-icon" : ""}" data-action="${opts.action}"${data}${attr("aria-label", opts.label)}>
    ${opts.leading ?? ""}
    <span class="row-main"><span class="row-title">${opts.title}</span>${opts.sub ? html`<span class="row-sub">${opts.sub}</span>` : ""}</span>
    ${opts.value !== undefined ? html`<span class="row-value${opts.strong ? " strong" : ""}">${opts.value}</span>` : ""}
    ${opts.chevron !== false ? raw(icon("chevronRight", "row-chevron")) : ""}
  </button>`;
}

export function progress(ratio: number, color?: string, label = ""): Safe {
  const pct = Math.max(0, Math.min(1, ratio));
  return html`<div class="progress${ratio >= 1 ? " over" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}" aria-label="${label}" style="${color ? `--cat: var(--subject-${color})` : ""}"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>`;
}
