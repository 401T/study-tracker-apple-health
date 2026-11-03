/** 科目 (Subjects): per-subject totals and weekly goal progress. */

import { html, raw } from "../components/html";
import { empty, progress, subjectIcon } from "../components/ui";
import { icon } from "../design-system/icons";
import { activeRecords, summarizePeriod } from "../analytics";
import { fmtDuration, fmtPercent } from "../analytics/format";
import { addDays, startOfWeek, today } from "../data/time";
import { registerActions, type Ctx } from "../app/context";
import type { StudyDataset } from "../data/schema";

export function subjectDataset(ds: StudyDataset, subjectId: string | null): StudyDataset {
  return { ...ds, records: ds.records.filter((r) => r.subjectId === subjectId) };
}

export function renderSubjects(ctx: Ctx) {
  const ds = ctx.store.data;
  const t = today();
  const wStart = startOfWeek(t, ds.settings.weekStartsOn);
  const visible = ds.subjects.filter((s) => ctx.ui.subjectsShowArchived || !s.archived).sort((a, b) => a.order - b.order);
  const archivedCount = ds.subjects.filter((s) => s.archived).length;
  const totals = new Map<string, number>();
  for (const r of activeRecords(ds)) totals.set(r.subjectId ?? "", (totals.get(r.subjectId ?? "") ?? 0) + r.durationSec);

  const trailing = html`<button type="button" class="bar-button icon-only glass glass-interactive" data-action="new-subject" aria-label="科目を追加">${raw(icon("plus"))}</button>`;
  if (!ds.subjects.length) {
    return {
      trailing,
      body: html`<div class="card">${empty({ icon: "subjects", title: "科目がありません", text: "科目を追加すると、科目ごとの累計や週の目標を確認できます。", actions: html`<button type="button" class="btn primary" data-action="new-subject">${raw(icon("plus"))}科目を追加</button>` })}</div>`,
    };
  }

  const cards = visible.map((s) => {
    const sub = subjectDataset(ds, s.id);
    const week = summarizePeriod(sub, wStart, addDays(wStart, 6), t);
    const month = summarizePeriod(sub, t.slice(0, 8) + "01", t, t);
    const goal = s.weeklyGoalSec;
    return html`<button type="button" class="card is-link" data-action="open-subject" data-id="${s.id}" aria-label="${s.name}、今週${fmtDuration(week.totalSec)}${goal ? `、週の目標${fmtDuration(goal)}` : ""}、累計${fmtDuration(totals.get(s.id) ?? 0)}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        ${subjectIcon(s.color)}
        <div style="flex:1;min-width:0"><div class="card-title" style="margin:0;color:var(--subject-${s.color}-ink)">${s.name}${s.archived ? html` <span class="tag">アーカイブ</span>` : ""}</div>
        <div class="card-text" style="font:var(--type-footnote)">累計 ${fmtDuration(totals.get(s.id) ?? 0)} · 今月 ${fmtDuration(month.totalSec)}</div></div>
        ${raw(icon("chevronRight", "row-chevron"))}
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px">
        <span class="metric-label">今週</span>
        <span class="num" style="font:var(--type-subhead)"><strong>${fmtDuration(week.totalSec)}</strong>${goal ? ` / 目標 ${fmtDuration(goal)}` : ""}</span>
      </div>
      ${goal ? progress(week.totalSec / goal, s.color, `${s.name}の週目標 ${fmtPercent(week.totalSec / goal)}`) : html`<p class="card-text" style="font:var(--type-footnote)">週の目標は未設定</p>`}
    </button>`;
  });

  const unassigned = totals.get("") ?? 0;
  const body = html`
    <div class="grid-cards">${cards}</div>
    ${unassigned ? html`<p class="list-footer" style="margin-top:12px">科目なしの記録: 累計 ${fmtDuration(unassigned)}</p>` : ""}
    ${archivedCount ? html`<div style="text-align:center;margin-top:16px"><button type="button" class="text-button" data-action="toggle-archived">${ctx.ui.subjectsShowArchived ? "アーカイブを隠す" : `アーカイブ済み（${archivedCount}）を表示`}</button></div>` : ""}
  `;
  return { body, trailing };
}

registerActions({
  "toggle-archived": (ctx) => {
    ctx.ui.subjectsShowArchived = !ctx.ui.subjectsShowArchived;
    ctx.rerender();
  },
});
