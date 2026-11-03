/** サマリー (Dashboard): the most important numbers first, one idea per card. */

import { html, raw } from "../components/html";
import { chart, ring } from "../components/chart";
import { cardHeader, delta, empty, metric, progress, rowButton, subjectIcon } from "../components/ui";
import { icon } from "../design-system/icons";
import {
  bySubject, compareToPrevious, planVsActual, recordsInRange, streak, summarizeDay, summarizePeriod, weeklyTrend,
} from "../analytics";
import { fmtDate, fmtDuration, fmtPercent, fmtRange, weekdayShort } from "../analytics/format";
import { addDays, clockOf, startOfWeek, today } from "../data/time";
import type { Ctx } from "../app/context";
import { registerActions } from "../app/context";
import type { StudyDataset, StudyRecord } from "../data/schema";
import { syntheticDataset } from "../data/synthetic";
import { coachCard } from "./coach";

export function recordRow(ds: StudyDataset, r: StudyRecord, showDate = false) {
  const s = ds.subjects.find((x) => x.id === r.subjectId);
  const task = r.taskId ? ds.tasks.find((t) => t.id === r.taskId)?.title : null;
  const time = r.startAt ? `${clockOf(r.startAt)}${r.endAt ? `–${clockOf(r.endAt)}` : ""}` : "時刻なし";
  const sub = [showDate ? fmtDate(r.date, { relative: true }) : time, task, r.note].filter(Boolean).join(" · ");
  return rowButton({
    action: "open-record",
    data: { id: r.id },
    leading: subjectIcon(s?.color ?? "gray"),
    title: s?.name ?? "科目なし",
    sub,
    value: fmtDuration(r.durationSec),
    strong: true,
    label: `${s?.name ?? "科目なし"}、${fmtDuration(r.durationSec)}、${showDate ? fmtDate(r.date) : time}${r.note ? "、" + r.note : ""}`,
  });
}

export function renderSummary(ctx: Ctx) {
  const ds = ctx.store.data;
  const t = today();
  const subtitle = fmtDate(t);
  const hasData = ds.records.some((r) => !r.deletedAt) || ds.subjects.length > 0;

  if (!hasData) {
    return {
      subtitle,
      body: html`<div class="card">${empty({
        icon: "subjects",
        title: "学習記録をはじめましょう",
        text: "科目を登録して、タイマーで計測するか、学習した時間を手入力します。記録は端末内に保存されます。",
        actions: html`<div class="stack" style="width:100%;max-width:320px">
          <button type="button" class="btn primary block" data-action="new-subject">${raw(icon("plus"))}科目を追加</button>
          <button type="button" class="btn block" data-action="new-record">記録を手入力</button>
          <button type="button" class="btn block" data-action="load-demo">サンプルデータで試す</button>
        </div>`,
      })}</div>`,
    };
  }

  const day = summarizeDay(ds, t);
  const ws = ds.settings.weekStartsOn;
  const wStart = startOfWeek(t, ws);
  const wEnd = addDays(wStart, 6);
  const week = summarizePeriod(ds, wStart, wEnd, t);
  const cmp = compareToPrevious(ds, wStart, wEnd, t);
  const st = streak(ds, t);
  const trend = weeklyTrend(ds, 8, t);
  const recent = recordsInRange(ds, "0000-01-01", t).slice(-5).reverse();
  const plan = planVsActual(ds, wStart, wEnd, t).find((p) => p.subjectId === null && p.periodStart === wStart);
  const subjToday = bySubject(ds, t, t);

  const goal = day.goalSec;
  const remaining = Math.max(0, goal - day.totalSec);
  const goalLine = goal
    ? remaining > 0
      ? html`<span class="nowrap">目標 ${fmtDuration(goal)}</span> · <span class="nowrap">あと${fmtDuration(remaining)}</span>`
      : html`<span class="nowrap">目標 ${fmtDuration(goal)} を達成</span> · <span class="nowrap">+${fmtDuration(day.totalSec - goal)}</span>`
    : html`目標は未設定です`;
  const pct = day.goalRatio === null ? "—" : fmtPercent(day.goalRatio);

  const maxWeek = Math.max(...week.daily.map((d) => d.sec), 1);
  const weekBars = html`<div class="mini-bars" role="img" aria-label="${`今週の日別: ${week.daily.map((d) => `${weekdayShort(d.date)} ${fmtDuration(d.sec)}`).join("、")}`}">${week.daily.map(
    (d) => html`<div><i class="${d.sec === 0 ? "zero" : d.date === t ? "today" : ""}" style="height:${d.sec ? Math.max(4, (d.sec / maxWeek) * 40) : 3}px"></i><small>${weekdayShort(d.date)}</small></div>`,
  )}</div>`;

  const trendText =
    trend.direction === "flat" ? "直近の週間勉強時間はほぼ横ばいです。" :
    trend.direction === "up" ? `週あたり平均 ${fmtDuration(Math.abs(trend.slopeSecPerWeek))} のペースで増えています。` :
    `週あたり平均 ${fmtDuration(Math.abs(trend.slopeSecPerWeek))} のペースで減っています。`;

  const body = html`
    <div class="grid-cards">
      <section class="card span-2" aria-labelledby="today-h">
        ${cardHeader({ icon: "target", label: "今日の勉強", meta: day.records.length ? `${day.records.length}件の記録` : "記録なし" })}
        <h2 id="today-h" class="sr-only">今日の勉強</h2>
        <div class="hero">
          <div class="hero-main">
            ${metric(day.totalSec, "xl")}
            <p class="card-text">${goalLine}</p>
            ${subjToday.length ? html`<p class="card-text">${subjToday.slice(0, 3).map((s, i, all) => html`<span class="nowrap">${s.name} ${fmtDuration(s.sec)}${i < all.length - 1 ? " ·" : ""}</span> `)}</p>` : ""}
            <div style="margin-top:4px">${ctx.store.data.activeSession
              ? html`<button type="button" class="btn small primary" data-action="open-timer">${raw(icon("timer"))}計測中のタイマー</button>`
              : html`<button type="button" class="btn small primary" data-action="open-timer">${raw(icon("play"))}タイマーを開始</button>`}</div>
          </div>
          ${ring(day.goalRatio, html`<span class="pct num">${pct}</span><span class="cap">目標達成</span>`, `今日の目標達成率 ${pct}`)}
        </div>
      </section>

      ${coachCard(ctx)}

      <button type="button" class="card is-link" data-action="goto-analytics" data-kind="week" aria-label="今週の勉強時間 ${fmtDuration(week.totalSec)}、分析を開く">
        ${cardHeader({ icon: "calendar", label: "今週", meta: fmtRange(wStart, wEnd), chevron: true })}
        <div class="kpi-row" style="margin-bottom:12px">
          <div class="kpi"><span class="metric-label">合計</span>${metric(week.totalSec)}</div>
          <div class="kpi"><span class="metric-label">1日平均</span>${metric(week.avgPerDaySec, "m")}</div>
        </div>
        ${weekBars}
        <div class="card-footer">${delta(cmp, "先週の同じ時点")}</div>
      </button>

      <button type="button" class="card is-link" data-action="goto-tab" data-tab="subjects" aria-label="今週の科目別配分、科目を開く">
        ${cardHeader({ icon: "subjects", label: "科目別（今週）", chevron: true })}
        ${week.bySubject.length
          ? html`<div class="share-bar" aria-hidden="true">${week.bySubject.map((s) => html`<span style="--cat: var(--subject-${s.color}); flex:${s.share.toFixed(4)}"></span>`)}</div>
            <div class="share-list">${week.bySubject.slice(0, 4).map(
              (s) => html`<div class="share-item" style="--cat: var(--subject-${s.color})"><span class="dot"></span><span class="name">${s.name}</span><span class="val num">${fmtDuration(s.sec)}</span><span class="pct num">${fmtPercent(s.share)}</span></div>`,
            )}</div>`
          : html`<p class="card-text">今週の記録はまだありません。</p>`}
      </button>

      <section class="card">
        ${cardHeader({ icon: "flame", label: "継続", color: "orange" })}
        <div class="kpi-row">
          <div class="kpi"><span class="metric-label">連続日数</span><div class="metric"><span class="num">${st.current}</span><span class="unit">日</span></div></div>
          <div class="kpi"><span class="metric-label">最長記録</span><div class="metric m"><span class="num">${st.longest}</span><span class="unit">日</span></div></div>
        </div>
        <p class="card-footer">${st.pendingToday ? "今日記録すると連続日数が続きます。" : st.current ? "今日も記録済みです。" : "記録した日が続くとここに表示されます。"}</p>
      </section>

      ${plan ? html`<section class="card">
        ${cardHeader({ icon: "target", label: "今週の計画", meta: fmtRange(plan.periodStart, plan.periodEnd) })}
        <div class="kpi-row" style="margin-bottom:12px">
          <div class="kpi"><span class="metric-label">実績</span>${metric(plan.actualSec)}</div>
          <div class="kpi"><span class="metric-label">計画</span>${metric(plan.plannedSec, "m")}</div>
        </div>
        ${progress(plan.ratio ?? 0, undefined, `計画達成率 ${plan.ratio === null ? "—" : fmtPercent(plan.ratio)}`)}
        <p class="card-footer">達成率 ${plan.ratio === null ? "—" : fmtPercent(plan.ratio)}（週の途中）</p>
      </section>` : ""}

      <section class="card" aria-labelledby="trend-h">
        <div class="card-header">
          <span class="cat">${raw(icon("trend"))}<span id="trend-h">推移（直近8週）</span></span>
          <button type="button" class="text-button meta" style="margin-left:auto" data-action="goto-analytics" data-kind="halfyear">詳細${raw(icon("chevronRight"))}</button>
        </div>
        <p class="card-title">${trendText}</p>
        ${chart({
          kind: "line",
          height: 150,
          data: trend.weeks.map((w, i) => ({
            key: w.key,
            axisLabel: i % 2 === 1 ? `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8))}` : "",
            label: `${fmtRange(w.start, w.end)}の週`,
            value: w.sec,
            partial: w.end >= t,
          })),
          summary: `直近8週の週間勉強時間の折れ線グラフ。${trendText}`,
          formatValue: fmtDuration,
        }, "summary-trend")}
        <div class="chart-legend"><span><i class="legend-swatch dotted" style="border-color:var(--chart-bar)"></i>点線 = 進行中の今週</span></div>
        <p class="card-footer">傾向は完了した週のみで計算しています。</p>
      </section>
    </div>

    <h2 class="section-title">直近の記録 <button type="button" class="text-button" data-action="goto-tab" data-tab="records">すべて表示${raw(icon("chevronRight"))}</button></h2>
    ${recent.length ? html`<div class="list">${recent.map((r) => recordRow(ds, r, true))}</div>` : html`<p class="muted">記録はまだありません。</p>`}
  `;
  return { subtitle, body };
}

registerActions({
  "goto-tab": (ctx, el) => {
    ctx.ui.tab = el.dataset.tab as Ctx["ui"]["tab"];
    window.scrollTo(0, 0);
    ctx.rerender();
  },
  "goto-analytics": (ctx, el) => {
    ctx.ui.tab = "analytics";
    ctx.ui.analytics = { kind: (el.dataset.kind as Ctx["ui"]["analytics"]["kind"]) ?? "week", anchor: today() };
    window.scrollTo(0, 0);
    ctx.rerender();
  },
  "load-demo": async (ctx) => {
    if (ctx.store.data.records.length || ctx.store.data.subjects.length) {
      ctx.toast("既存のデータがあるため、サンプルは読み込みません");
      return;
    }
    if (!(await ctx.confirm({ title: "サンプルデータを読み込みますか？", message: "架空の記録で画面を試せます。「設定 → サンプルデータを消す」でいつでも空に戻せます。", ok: "読み込む" }))) return;
    await ctx.store.replaceDataset(syntheticDataset(), "サンプル読込前のバックアップ");
    ctx.toast("サンプルデータを読み込みました（架空のデータです）");
  },
});
