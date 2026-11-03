/** 記録 (Study Records): grouped by day, searchable, filterable by subject and period. */

import { html, raw } from "../components/html";
import { empty } from "../components/ui";
import { icon } from "../design-system/icons";
import { activeRecords, subjectName } from "../analytics";
import { fmtDate, fmtDuration } from "../analytics/format";
import { addDays, today } from "../data/time";
import { registerActions, type Ctx } from "../app/context";
import { recordRow } from "./summary";

export function renderRecords(ctx: Ctx) {
  const ds = ctx.store.data;
  const f = ctx.ui.records;
  const q = f.q.trim().toLowerCase();
  const from = f.range === "all" ? "0000-01-01" : addDays(today(), -(Number(f.range) - 1));
  const taskTitle = new Map(ds.tasks.map((t) => [t.id, t.title]));

  const list = activeRecords(ds)
    .filter((r) => r.date >= from)
    .filter((r) => f.subject === "all" || (f.subject === "none" ? !r.subjectId : r.subjectId === f.subject))
    .filter((r) => {
      if (!q) return true;
      const hay = [r.note, subjectName(ds, r.subjectId), r.taskId ? taskTitle.get(r.taskId) ?? "" : "", r.date].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.date + (b.startAt ?? b.createdAt)).localeCompare(a.date + (a.startAt ?? a.createdAt)));

  // Render a page at a time: hundreds of rows at once are heavy on phones.
  const shown = list.slice(0, shownCount);
  const groups = new Map<string, typeof list>();
  for (const r of shown) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date)!.push(r);
  }
  const total = list.reduce((s, r) => s + r.durationSec, 0);
  const subjects = ds.subjects.filter((s) => !s.archived);

  const chips = html`<div class="chips" role="group" aria-label="科目で絞り込み">
    <button type="button" class="chip" aria-pressed="${f.subject === "all"}" data-action="records-subject" data-value="all">すべて</button>
    ${subjects.map((s) => html`<button type="button" class="chip" style="--cat: var(--subject-${s.color})" aria-pressed="${f.subject === s.id}" data-action="records-subject" data-value="${s.id}"><span class="dot"></span>${s.name}</button>`)}
    ${ds.records.some((r) => !r.subjectId && !r.deletedAt) ? html`<button type="button" class="chip" aria-pressed="${f.subject === "none"}" data-action="records-subject" data-value="none">科目なし</button>` : ""}
  </div>`;

  const body = html`
    <div class="stack" style="margin-bottom:8px">
      <label class="search">${raw(icon("search"))}<span class="sr-only">記録を検索</span>
        <input type="search" placeholder="学習内容・科目・タスクを検索" value="${f.q}" data-input="records-search" enterkeyhint="search" autocomplete="off">
      </label>
      ${chips}
      <div class="segmented" role="radiogroup" aria-label="期間" data-lens="records-range">
        ${(["all", "7", "30"] as const).map((v) => html`<button type="button" role="radio" aria-checked="${f.range === v}" data-action="records-range" data-value="${v}">${v === "all" ? "すべて" : `直近${v}日`}</button>`)}
      </div>
    </div>
    <p class="list-footer" aria-live="polite" style="margin:12px 4px 0">${list.length}件 · 合計 ${fmtDuration(total)}</p>
    ${list.length === 0
      ? html`<div class="card" style="margin-top:12px">${empty({
          icon: q ? "search" : "records",
          title: q || f.subject !== "all" || f.range !== "all" ? "該当する記録がありません" : "記録はまだありません",
          text: q || f.subject !== "all" || f.range !== "all" ? "検索語や絞り込み条件を変えてみてください。" : "右下の ＋ から記録を追加するか、タイマーで計測できます。",
        })}</div>`
      : [...groups].map(
          ([date, recs]) => html`<h2 class="list-header"><span>${fmtDate(date, { relative: true })}</span><strong class="num">${fmtDuration(recs.reduce((s, r) => s + r.durationSec, 0))}</strong></h2>
            <div class="list">${recs.map((r) => recordRow(ds, r))}</div>`,
        )}
    ${list.length > shown.length ? html`<div style="display:grid;place-items:center;margin-top:16px"><button type="button" class="btn small" data-action="records-more">さらに表示（残り${list.length - shown.length}件）</button></div>` : ""}
  `;
  const trailing = html`<button type="button" class="bar-button icon-only glass glass-interactive" data-action="new-record" aria-label="記録を追加">${raw(icon("plus"))}</button>`;
  return { body, trailing };
}

const PAGE = 60;
let shownCount = PAGE;

registerActions({
  "records-more": (ctx) => {
    shownCount += PAGE;
    ctx.rerender();
  },
  "records-search": (ctx, el) => {
    shownCount = PAGE;
    const input = el as HTMLInputElement;
    const pos = input.selectionStart ?? input.value.length;
    ctx.ui.records.q = input.value;
    ctx.rerender();
    const next = document.querySelector<HTMLInputElement>('[data-input="records-search"]');
    next?.focus({ preventScroll: true });
    next?.setSelectionRange(pos, pos);
  },
  "records-subject": (ctx, el) => {
    ctx.ui.records.subject = el.dataset.value!;
    shownCount = PAGE;
    ctx.rerender();
  },
  "records-range": (ctx, el) => {
    ctx.ui.records.range = el.dataset.value as Ctx["ui"]["records"]["range"];
    shownCount = PAGE;
    ctx.rerender();
  },
});
