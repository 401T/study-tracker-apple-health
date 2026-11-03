/**
 * Accessible SVG charts (bar + line), rendered at the container's real pixel
 * width so text never scales with the chart.
 *
 * HIG "Charting data" rules applied:
 * - Bars start at zero; Y range is dynamic with familiar tick steps (15m/30m/1h/2h…).
 * - Y axis on the trailing side so the leading edge aligns with the card.
 * - Light grid, few ticks; reference lines are labelled in text (not color only).
 * - Every mark has an accessibility label; arrow keys move between marks.
 * - A text headline (callout) summarises the chart and updates on selection.
 */

import { durationTicks } from "../analytics";
import { fmtAxis } from "../analytics/format";
import { escapeHTML, html, raw, type Safe } from "./html";

export interface ChartDatum {
  key: string;
  /** Short axis label (may be "" to skip). */
  axisLabel: string;
  /** Full label for callout and screen readers, e.g. "11月3日(月)". */
  label: string;
  value: number;
  future?: boolean;
  /** Period still in progress: drawn lighter / dashed so it is not read as a drop. */
  partial?: boolean;
}

export interface ChartSpec {
  kind: "bar" | "line";
  data: ChartDatum[];
  height?: number;
  goal?: { value: number; label: string } | null;
  average?: { value: number; label: string } | null;
  /** Called with the datum (or null) when selection changes. */
  onSelect?: (d: ChartDatum | null) => void;
  /** Accessible summary of the whole chart. */
  summary: string;
  formatValue: (v: number) => string;
}

const specs = new Map<string, ChartSpec>();
const selected = new Map<string, string | null>();
let seq = 0;

/** Placeholder; real SVG is drawn by `hydrateCharts` after insertion. */
export function chart(spec: ChartSpec, persistKey?: string): Safe {
  const id = persistKey ?? `chart-${++seq}`;
  specs.set(id, spec);
  if (!selected.has(id)) selected.set(id, null);
  return html`<div class="chart" data-chart="${id}" role="group" aria-label="${spec.summary}" style="min-height:${spec.height ?? 200}px"></div>`;
}

export function resetChartSelection(id: string) {
  selected.set(id, null);
}

export function hydrateCharts(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-chart]").forEach((el) => draw(el));
}

let ro: ResizeObserver | null = null;
export function observeChartResizes(root: HTMLElement) {
  if (ro || typeof ResizeObserver === "undefined") return;
  let lastW = 0;
  ro = new ResizeObserver(() => {
    const w = root.clientWidth;
    if (Math.abs(w - lastW) > 4) {
      lastW = w;
      hydrateCharts(root);
    }
  });
  ro.observe(root);
}

function draw(el: HTMLElement) {
  const id = el.dataset.chart!;
  const spec = specs.get(id);
  if (!spec) return;
  const W = Math.max(240, Math.round(el.clientWidth || 320));
  const H = spec.height ?? 200;
  const axisW = 52;
  const top = 10;
  const bottom = 22;
  const plotW = W - axisW;
  const plotH = H - top - bottom;
  const maxVal = Math.max(...spec.data.map((d) => d.value), spec.goal?.value ?? 0, spec.average?.value ?? 0, 1);
  const { max, ticks } = durationTicks(maxVal, 3);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const n = spec.data.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * (n > 40 ? 0.7 : 0.58)));
  const sel = selected.get(id) ?? null;

  const parts: string[] = [];
  parts.push(`<g class="grid">`);
  for (const t of ticks) parts.push(`<line class="${t === 0 ? "zero" : ""}" x1="0" x2="${plotW}" y1="${y(t)}" y2="${y(t)}"/>`);
  for (let i = 0; i <= n; i += labelStep(n)) {
    // vertical guides at label positions (subtle, HIG: "tailor grid density")
    if (i > 0 && i < n && n > 12) parts.push(`<line x1="${i * slot}" x2="${i * slot}" y1="${top}" y2="${top + plotH}"/>`);
  }
  parts.push(`</g><g class="axis">`);
  for (const t of ticks) parts.push(`<text x="${plotW + 8}" y="${y(t) + 4}">${escapeHTML(fmtAxis(t))}</text>`);
  spec.data.forEach((d, i) => {
    if (d.axisLabel) parts.push(`<text x="${i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${escapeHTML(d.axisLabel)}</text>`);
  });
  parts.push(`</g>`);

  if (spec.kind === "bar") {
    parts.push(`<g>`);
    spec.data.forEach((d, i) => {
      const h = Math.max(d.value > 0 ? 2 : 0, top + plotH - y(d.value));
      const x = i * slot + (slot - barW) / 2;
      const r = Math.min(4, barW / 2, h / 2);
      if (h > 0) parts.push(`<path class="bar${d.partial ? " partial" : ""}${d.key === sel ? " is-selected" : ""}" d="${roundedTop(x, top + plotH - h, barW, h, r)}"/>`);
      else if (d.future) parts.push(`<rect class="bar future" x="${x}" y="${top + plotH - 2}" width="${barW}" height="2" rx="1"/>`);
    });
    parts.push(`</g>`);
  } else {
    const shown = spec.data.map((d, i) => ({ d, x: i * slot + slot / 2, y: y(d.value) })).filter((p) => !p.d.future);
    const solid = shown.filter((p) => !p.d.partial);
    if (shown.length) {
      const path = (ps: typeof shown) => ps.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
      if (solid.length) {
        const line = path(solid);
        parts.push(`<path class="area" d="${line}L${solid[solid.length - 1].x},${top + plotH}L${solid[0].x},${top + plotH}Z" opacity="0.6"/>`);
        parts.push(`<path class="line" d="${line}"/>`);
      }
      // In-progress period: dashed connector from the last complete point.
      const firstPartial = shown.findIndex((p) => p.d.partial);
      if (firstPartial >= 0) parts.push(`<path class="line partial" d="${path(shown.slice(Math.max(0, firstPartial - 1)))}"/>`);
      spec.data.forEach((d, i) => {
        if (d.future) return;
        parts.push(`<circle class="point${d.partial ? " partial" : ""}${d.key === sel ? " is-selected" : ""}" cx="${i * slot + slot / 2}" cy="${y(d.value)}" r="${d.key === sel ? 5 : 3.5}"/>`);
      });
    }
  }

  const rule = (v: number, cls: string, label: string) => {
    const ry = y(v);
    parts.push(`<line class="${cls}" x1="0" x2="${plotW}" y1="${ry}" y2="${ry}"/>`);
    parts.push(`<text class="rule-label ${cls === "rule-goal" ? "goal" : "avg"}" x="4" y="${ry - 5}">${escapeHTML(label)}</text>`);
  };
  if (spec.average && spec.average.value > 0) rule(spec.average.value, "rule-avg", spec.average.label);
  if (spec.goal && spec.goal.value > 0) rule(spec.goal.value, "rule-goal", spec.goal.label);

  // Hit targets: full-height columns, keyboard focusable (roving tabindex).
  parts.push(`<g>`);
  const focusKey = sel ?? [...spec.data].reverse().find((d) => !d.future)?.key ?? spec.data[0]?.key;
  spec.data.forEach((d, i) => {
    const label = `${d.label}、${d.future ? "未来" : spec.formatValue(d.value)}${d.partial ? "（進行中）" : ""}`;
    parts.push(
      `<rect class="hit" data-key="${escapeHTML(d.key)}" x="${i * slot}" y="${top}" width="${slot}" height="${plotH}" role="button" tabindex="${d.key === focusKey ? 0 : -1}" aria-pressed="${d.key === sel}" aria-label="${escapeHTML(label)}"/>`,
    );
  });
  parts.push(`</g>`);

  el.classList.toggle("has-selection", sel !== null && spec.kind === "bar");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`;

  const choose = (key: string | null, focus = false) => {
    selected.set(id, key);
    spec.onSelect?.(key ? spec.data.find((d) => d.key === key) ?? null : null);
    draw(el);
    if (focus && key) el.querySelector<SVGRectElement>(`.hit[data-key="${CSS.escape(key)}"]`)?.focus();
  };
  el.querySelectorAll<SVGRectElement>(".hit").forEach((hit) => {
    hit.addEventListener("click", () => {
      const k = hit.dataset.key!;
      choose(selected.get(id) === k ? null : k, true);
    });
    hit.addEventListener("keydown", (e) => {
      const keys = spec.data.map((d) => d.key);
      const i = keys.indexOf(hit.dataset.key!);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const j = Math.min(keys.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
        choose(keys[j], true);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(selected.get(id) === keys[i] ? null : keys[i], true);
      } else if (e.key === "Escape") {
        choose(null, false);
      }
    });
  });
}

function labelStep(n: number) {
  if (n <= 7) return 1;
  if (n <= 12) return 1;
  if (n <= 31) return 7;
  return Math.ceil(n / 6);
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** 100% stacked bar with gaps (HIG: separate contiguous colors). */
export function shareBar(items: { name: string; share: number; color: string }[], label: string): Safe {
  return html`<div class="share-bar" role="img" aria-label="${label}">${items
    .filter((i) => i.share > 0)
    .map((i) => html`<span style="--cat: var(--subject-${i.color}); flex: ${i.share.toFixed(4)}"></span>`)}</div>`;
}

/** Goal ring (single progress ring; >100% draws a second lap in a darker tone). */
export function ring(ratio: number | null, center: Safe, label: string): Safe {
  const r = 56, c = 2 * Math.PI * r;
  const v = Math.max(0, ratio ?? 0);
  const first = Math.min(1, v);
  const over = Math.min(1, Math.max(0, v - 1));
  return html`<div class="ring" role="img" aria-label="${label}">
    <svg viewBox="0 0 132 132" aria-hidden="true">
      <circle class="track" cx="66" cy="66" r="${r}" fill="none" stroke-width="14"/>
      <circle class="progress" cx="66" cy="66" r="${r}" fill="none" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - first)}" ${raw(first === 0 ? 'opacity="0"' : "")}/>
      ${over > 0 ? raw(`<circle class="over" cx="66" cy="66" r="${r}" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - over)}"/>`) : ""}
    </svg>
    <div class="ring-center">${center}</div>
  </div>`;
}
