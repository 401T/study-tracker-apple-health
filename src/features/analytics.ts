/** 分析 (Analytics): period charts, comparison, allocation, goals, plan vs actual, changes. */

import { html, raw } from "../components/html";
import { chart, resetChartSelection, shareBar } from "../components/chart";
import { cardHeader, delta, metric, progress, segmented } from "../components/ui";
import { icon } from "../design-system/icons";
import {
  buckets, compare, compareToPrevious, periodRange, planVsActual, shiftAnchor, subjectChanges, summarizePeriod,
  type PeriodKind,
} from "../analytics";
import { fmtDate, fmtDuration, fmtPercent, fmtRange, fmtSignedDuration, weekdayShort } from "../analytics/format";
import { addDays, daysBetween, startOfWeek, today } from "../data/time";
import { registerActions, registerSheets, registerSubmits, type Ctx } from "../app/context";

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "week", label: "週" },
  { value: "month", label: "月" },
  { value: "halfyear", label: "6か月" },
  { value: "year", label: "年" },
];

export function renderAnalytics(ctx: Ctx) {
  const ds = ctx.store.data;
  const { kind, anchor } = ctx.ui.analytics;
  const ws = ds.settings.weekStartsOn;
  const t = today();
  const { start, end } = periodRange(kind, anchor, ws);
  const monthly = kind === "halfyear" || kind === "year";
  const p = summarizePeriod(ds, start, end, t);
  const bs = buckets(ds, kind, start, end, ws);
  const isCurrent = end >= t;
  const elapsedEnd = isCurrent ? t : end;
  const elapsedDays = Math.max(0, daysBetween(start, elapsedEnd) + 1);
  const unitLabel = kind === "halfyear" ? "週" : kind === "year" ? "月" : "日";
  const avgBucket = bs.filter((b) => b.start <= t).length ? Math.round(bs.filter((b) => b.start <= t).reduce((a, b) => a + b.sec, 0) / bs.filter((b) => b.start <= t).length) : 0;

  const cmp = isCurrent ? compareToPrevious(ds, start, end, t) : (() => {
    const len = daysBetween(start, end) + 1;
    const ps = addDays(start, -len), pe = addDays(start, -1);
    return { ...compare(p.totalSec, summarizePeriod(ds, ps, pe, t).totalSec), prevStart: ps, prevEnd: pe };
  })();

  const data = bs.map((b, i) => {
    const label = kind === "week" || kind === "month" ? fmtDate(b.start) : kind === "halfyear" ? `${fmtRange(b.start, b.end)}の週` : fmtRange(b.start, b.end, true);
    let axisLabel = "";
    if (kind === "week") axisLabel = weekdayShort(b.start);
    else if (kind === "month") axisLabel = [1, 8, 15, 22, 29].includes(Number(b.start.slice(8))) ? String(Number(b.start.slice(8))) : "";
    else if (kind === "halfyear") axisLabel = i % 4 === 0 ? `${Number(b.start.slice(5, 7))}/${Number(b.start.slice(8))}` : "";
    else axisLabel = `${Number(b.key.slice(5, 7))}月`;
    return { key: b.key, axisLabel, label, value: b.sec, future: b.start > t, partial: b.start <= t && b.end > t && kind !== "week" && kind !== "month" };
  });

  const chartId = `an-${kind}-${start}`;
  const calloutDefault = html`<span class="metric-label">${kind === "week" || kind === "month" ? "1日平均" : `1${unitLabel}平均`}</span>${metric(kind === "week" || kind === "month" ? p.avgPerDaySec : avgBucket)}<span class="card-text" style="font:var(--type-footnote)">${fmtRange(start, end, monthly)}${isCurrent ? "・進行中" : ""}</span>`;

  const goalLine = (kind === "week" || kind === "month") && ds.settings.dailyGoalSec > 0 ? { value: ds.settings.dailyGoalSec, label: `目標 ${fmtDuration(ds.settings.dailyGoalSec)}` } : null;
  const avgValue = kind === "week" || kind === "month" ? p.avgPerDaySec : avgBucket;

  const plans = planVsActual(ds, start, end, t);
  const changes = subjectChanges(ds, 14, t).filter((c) => c.recentSec + c.previousSec > 0);
  const declines = changes.filter((c) => c.deltaSec < -600).slice(0, 3);
  const increases = [...changes].reverse().filter((c) => c.deltaSec > 600).slice(0, 3);

  const body = html`
    <div class="stack">
      ${segmented("期間の単位", KINDS, kind, "an-kind")}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <button type="button" class="round-button" data-action="an-shift" data-dir="-1" aria-label="前の期間">${raw(icon("chevronLeft"))}</button>
        <div style="text-align:center;font:var(--type-headline)" aria-live="polite">${fmtRange(start, end, monthly)}</div>
        <button type="button" class="round-button" data-action="an-shift" data-dir="1" aria-label="次の期間" ${raw(isCurrent ? "disabled style=\"opacity:.3\"" : "")}>${raw(icon("chevronRight"))}</button>
      </div>
    </div>
    <div class="spacer"></div>
    <div class="grid-cards">
      <section class="card span-2" aria-labelledby="an-total-h">
        <div class="kpi-row" style="margin-bottom:8px">
          <div class="kpi"><span class="metric-label" id="an-total-h">合計</span>${metric(p.totalSec, "xl")}</div>
          <div class="kpi chart-callout" id="an-callout" aria-live="polite">${calloutDefault}</div>
        </div>
        ${chart({
          kind: "bar",
          height: 220,
          data,
          goal: goalLine,
          average: avgValue > 0 ? { value: avgValue, label: `平均 ${fmtDuration(avgValue)}` } : null,
          summary: `${fmtRange(start, end, monthly)}の${unitLabel}別勉強時間の棒グラフ。合計${fmtDuration(p.totalSec)}、${unitLabel}平均${fmtDuration(avgValue)}。各棒を選ぶと値を表示します。`,
          formatValue: fmtDuration,
          onSelect: (d) => {
            const el = document.getElementById("an-callout");
            if (!el) return;
            el.innerHTML = d
              ? html`<span class="metric-label">${d.label}</span>${metric(d.value)}<span class="card-text">${d.future ? "未来の期間" : goalLine && d.value >= goalLine.value ? "目標達成" : " "}</span>`.value
              : calloutDefault.value;
          },
        }, chartId)}
        <div class="chart-legend">
          <span><i class="legend-swatch" style="border-color:var(--chart-average)"></i>実線 = 平均</span>
          ${goalLine ? html`<span><i class="legend-swatch dashed" style="border-color:var(--chart-goal)"></i>破線 = 1日の目標</span>` : ""}
          ${monthly && isCurrent ? html`<span><i class="legend-box" style="background:var(--chart-bar-muted)"></i>淡色 = 進行中の${unitLabel}</span>` : ""}
          <span>単位: 時間・分（休憩を除く勉強時間）</span>
        </div>
      </section>

      <section class="card">
        ${cardHeader({ icon: "trend", label: "前の期間との比較" })}
        <div class="kpi-row" style="margin-bottom:8px">
          <div class="kpi"><span class="metric-label">${isCurrent ? "今期間（今日まで）" : "この期間"}</span>${metric(cmp.currentSec, "m")}</div>
          <div class="kpi"><span class="metric-label">前期間${isCurrent ? "（同じ日数）" : ""}</span>${metric(cmp.previousSec, "m")}</div>
        </div>
        ${delta(cmp, "前期間")}
        <p class="card-footer">比較対象: ${fmtRange(cmp.prevStart, cmp.prevEnd)}</p>
      </section>

      <section class="card">
        ${cardHeader({ icon: "target", label: "目標の達成" })}
        ${ds.settings.dailyGoalSec > 0
          ? html`<div class="kpi-row" style="margin-bottom:12px">
              <div class="kpi"><span class="metric-label">達成した日</span><div class="metric"><span class="num">${p.daysGoalMet}</span><span class="unit">/ ${elapsedDays}日</span></div></div>
              <div class="kpi"><span class="metric-label">学習した日</span><div class="metric m"><span class="num">${p.activeDays}</span><span class="unit">日</span></div></div>
            </div>
            ${progress(elapsedDays ? p.daysGoalMet / elapsedDays : 0, undefined, `目標達成日の割合 ${elapsedDays ? fmtPercent(p.daysGoalMet / elapsedDays) : "—"}`)}
            <p class="card-footer">1日の目標 ${fmtDuration(ds.settings.dailyGoalSec)}${p.bestDay && p.bestDay.sec > 0 ? ` · 最長は${fmtDate(p.bestDay.date)}の${fmtDuration(p.bestDay.sec)}` : ""}</p>`
          : html`<p class="card-text">1日の目標が設定されていません。設定から目標を決めると達成状況を表示します。</p>`}
      </section>

      <section class="card span-2">
        ${cardHeader({ icon: "subjects", label: "科目別の配分" })}
        ${p.bySubject.length
          ? html`${shareBar(p.bySubject.map((s) => ({ name: s.name, share: s.share, color: s.color })), `科目別の割合: ${p.bySubject.map((s) => `${s.name} ${fmtPercent(s.share)}`).join("、")}`)}
            <div class="share-list">${p.bySubject.map(
              (s) => html`<div class="share-item" style="--cat: var(--subject-${s.color})"><span class="dot"></span><span class="name">${s.name}</span><span class="val num">${fmtDuration(s.sec)}</span><span class="pct num">${fmtPercent(s.share)}</span></div>`,
            )}</div>`
          : html`<p class="card-text">この期間の記録はありません。</p>`}
      </section>

      <section class="card">
        <div class="card-header"><span class="cat">${raw(icon("target"))}計画と実績</span>
          <button type="button" class="text-button meta" style="margin-left:auto" data-action="open-plan">計画を設定${raw(icon("chevronRight"))}</button></div>
        ${plans.length
          ? html`<div class="stack">${plans.map(
              (pl) => html`<div>
                <div style="display:flex;justify-content:space-between;gap:8px;font:var(--type-subhead)"><span>${fmtRange(pl.periodStart, pl.periodEnd)} · ${pl.name}</span><span class="num"><strong>${fmtDuration(pl.actualSec)}</strong> / ${fmtDuration(pl.plannedSec)}</span></div>
                <div style="margin:6px 0 2px">${progress(pl.ratio ?? 0, ds.subjects.find((s) => s.id === pl.subjectId)?.color, `${pl.name}の計画達成率`)}</div>
                <div class="card-text" style="font:var(--type-footnote)">${pl.ratio === null ? "計画 0分" : `達成率 ${fmtPercent(pl.ratio)}`}${pl.inProgress ? "（進行中）" : ""} · 差 ${fmtSignedDuration(pl.actualSec - pl.plannedSec)}</div>
              </div>`,
            )}</div>`
          : html`<p class="card-text">この期間の計画はありません。週ごとに目標時間を計画すると、実績と比較できます。</p>`}
      </section>

      <section class="card">
        ${cardHeader({ icon: "analytics", label: "科目ごとの増減" })}
        <p class="card-text" style="margin-bottom:8px">直近14日（昨日まで）と、その前の14日の比較</p>
        ${declines.length || increases.length
          ? html`<div class="stack">
              ${declines.map((c) => html`<div class="share-item" style="grid-template-columns:auto 1fr auto"><span class="delta down">${raw(icon("arrowDown"))}</span><span class="name">${c.name}</span><span class="val num">${fmtSignedDuration(c.deltaSec)}</span></div>`)}
              ${increases.map((c) => html`<div class="share-item" style="grid-template-columns:auto 1fr auto"><span class="delta up">${raw(icon("arrowUp"))}</span><span class="name">${c.name}</span><span class="val num">${fmtSignedDuration(c.deltaSec)}</span></div>`)}
            </div>`
          : html`<p class="card-text">大きな増減（±10分超）はありません。</p>`}
      </section>
    </div>
  `;
  return { body };
}

registerActions({
  "an-kind": (ctx, el) => {
    ctx.ui.analytics = { kind: el.dataset.value as PeriodKind, anchor: today() };
    ctx.rerender();
  },
  "an-shift": (ctx, el) => {
    const a = ctx.ui.analytics;
    const next = shiftAnchor(a.kind, a.anchor, Number(el.dataset.dir) as -1 | 1);
    const { start } = periodRange(a.kind, next, ctx.store.data.settings.weekStartsOn);
    if (start > today()) return;
    ctx.ui.analytics = { ...a, anchor: next };
    resetChartSelection(`an-${a.kind}-${start}`);
    ctx.rerender();
  },
  "open-plan": (ctx) => ctx.openSheet("plan", { start: startOfWeek(today(), ctx.store.data.settings.weekStartsOn) }),
  "plan-shift": (ctx, el) => ctx.replaceSheet("plan", { start: addDays(el.dataset.start!, Number(el.dataset.dir) * 7) }),
});

registerSheets({
  plan(ctx, { start }) {
    const ds = ctx.store.data;
    const end = addDays(start, 6);
    const get = (sid: string | null) => ds.plans.find((p) => p.periodStart === start && p.periodEnd === end && p.subjectId === sid);
    const hours = (sid: string | null) => {
      const p = get(sid);
      return p ? String(Math.round((p.plannedSec / 3600) * 4) / 4) : "";
    };
    const subjects = ds.subjects.filter((s) => !s.archived);
    return {
      title: "週の計画",
      leading: html`<button type="button" class="bar-button glass glass-interactive" data-action="sheet-close">キャンセル</button>`,
      trailing: html`<button type="submit" form="plan-form" class="bar-button prominent">保存</button>`,
      body: html`
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <button type="button" class="round-button" data-action="plan-shift" data-dir="-1" data-start="${start}" aria-label="前の週">${raw(icon("chevronLeft"))}</button>
          <strong>${fmtRange(start, end)}</strong>
          <button type="button" class="round-button" data-action="plan-shift" data-dir="1" data-start="${start}" aria-label="次の週">${raw(icon("chevronRight"))}</button>
        </div>
        <form id="plan-form" data-submit="save-plan" data-start="${start}">
          <div class="list">
            <div class="field"><label for="pl-all">全体</label><span class="duration-input"><input id="pl-all" name="all" type="number" inputmode="decimal" min="0" step="0.25" placeholder="—" value="${hours(null)}"><span>時間</span></span></div>
            ${subjects.map((s) => html`<div class="field"><label for="pl-${s.id}">${s.name}</label><span class="duration-input"><input id="pl-${s.id}" name="s:${s.id}" type="number" inputmode="decimal" min="0" step="0.25" placeholder="—" value="${hours(s.id)}"><span>時間</span></span></div>`)}
          </div>
          <p class="list-footer">計画は実績とは別に保存され、記録は変更されません。空欄の項目は保存しません。</p>
        </form>`,
    };
  },
});

registerSubmits({
  "save-plan": (ctx, form) => {
    const start = form.dataset.start!;
    const end = addDays(start, 6);
    const fd = new FormData(form);
    let n = 0;
    for (const [k, v] of fd) {
      if (String(v).trim() === "") continue;
      const h = Number(v);
      if (!Number.isFinite(h) || h < 0) continue;
      const sid = k === "all" ? null : k.slice(2);
      const existing = ctx.store.data.plans.find((p) => p.periodStart === start && p.periodEnd === end && p.subjectId === sid);
      if (existing && existing.plannedSec === Math.round(h * 3600)) continue;
      if (!ctx.safely(() => ctx.store.setPlan(start, end, sid, Math.round(h * 3600)))) return;
      n++;
    }
    ctx.closeSheet();
    ctx.toast(n ? `計画を${n}件保存しました` : "変更はありません");
  },
});
