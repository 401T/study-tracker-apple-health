/** Subject detail / edit sheets and task management. */

import { html, raw } from "../components/html";
import { chart } from "../components/chart";
import { metric, progress, subjectIcon } from "../components/ui";
import { icon } from "../design-system/icons";
import { recordsInRange, summarizePeriod, weeklyTrend } from "../analytics";
import { fmtDuration, fmtPercent, fmtRange } from "../analytics/format";
import { addDays, startOfWeek, today } from "../data/time";
import { SUBJECT_COLORS, type SubjectColor } from "../data/schema";
import { registerActions, registerSheets, registerSubmits } from "../app/context";
import { subjectDataset } from "./subjects";
import { recordRow } from "./summary";

const COLOR_NAMES: Record<SubjectColor, string> = {
  blue: "ブルー", green: "グリーン", orange: "オレンジ", pink: "ピンク", purple: "パープル",
  teal: "ティール", yellow: "イエロー", red: "レッド", indigo: "インディゴ", brown: "ブラウン",
};

registerSheets({
  subject(ctx, { id }) {
    const ds = ctx.store.data;
    const s = ds.subjects.find((x) => x.id === id);
    if (!s) return { title: "科目", body: html`<p class="muted">この科目は見つかりません。</p>` };
    const t = today();
    const sub = subjectDataset(ds, s.id);
    const wStart = startOfWeek(t, ds.settings.weekStartsOn);
    const week = summarizePeriod(sub, wStart, addDays(wStart, 6), t);
    const month = summarizePeriod(sub, t.slice(0, 8) + "01", t, t);
    const all = sub.records.filter((r) => !r.deletedAt);
    const total = all.reduce((a, r) => a + r.durationSec, 0);
    const trend = weeklyTrend(sub, 8, t);
    const recent = recordsInRange(sub, "0000-01-01", t).slice(-5).reverse();
    const tasks = ds.tasks.filter((x) => x.subjectId === s.id);
    return {
      title: s.name,
      live: true,
      trailing: html`<button type="button" class="bar-button glass glass-interactive" data-action="edit-subject" data-id="${s.id}">編集</button>`,
      body: html`
        <div class="detail-hero">${subjectIcon(s.color)}<span class="metric-label">累計</span>${metric(total, "xl")}<span class="card-text">${all.length}件の記録</span></div>
        <div class="card" style="background:var(--color-card)">
          <div class="kpi-row" style="margin-bottom:12px">
            <div class="kpi"><span class="metric-label">今週</span>${metric(week.totalSec, "m")}</div>
            <div class="kpi"><span class="metric-label">今月</span>${metric(month.totalSec, "m")}</div>
          </div>
          ${s.weeklyGoalSec ? html`${progress(week.totalSec / s.weeklyGoalSec, s.color, "週の目標")}<p class="card-footer">週の目標 ${fmtDuration(s.weeklyGoalSec)} · ${fmtPercent(week.totalSec / s.weeklyGoalSec)}</p>` : html`<p class="card-footer">週の目標は未設定です（編集から設定できます）</p>`}
        </div>
        <h3 class="list-header">週ごとの推移（直近8週）</h3>
        <div class="card" style="background:var(--color-card)">
          ${chart({
            kind: "bar",
            height: 170,
            data: trend.weeks.map((w, i) => ({ key: w.key, axisLabel: i % 2 === 1 ? `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8))}` : "", label: `${fmtRange(w.start, w.end)}の週`, value: w.sec, partial: w.end >= t })),
            goal: s.weeklyGoalSec ? { value: s.weeklyGoalSec, label: `週目標 ${fmtDuration(s.weeklyGoalSec)}` } : null,
            summary: `${s.name}の直近8週の週間勉強時間`,
            formatValue: fmtDuration,
          }, `subject-${s.id}`)}
        </div>
        <h3 class="list-header">タスク</h3>
        <div class="list">
          ${tasks.map((x) => html`<button type="button" class="row" data-action="toggle-task" data-id="${x.id}" role="checkbox" aria-checked="${x.status === "done"}">
            <span class="row-icon" style="--cat:${x.status === "done" ? `var(--subject-${s.color})` : "var(--color-fill)"};border-radius:50%;width:26px;height:26px">${raw(icon(x.status === "done" ? "check" : "circle"))}</span>
            <span class="row-main"><span class="row-title" style="${x.status === "done" ? "text-decoration:line-through;color:var(--color-label-secondary)" : ""}">${x.title}</span></span></button>`)}
          <form class="field" data-submit="add-task" data-subject="${s.id}">
            <label class="sr-only" for="new-task">新しいタスク</label>
            <input id="new-task" name="title" placeholder="＋ タスクを追加" style="text-align:left;color:var(--color-label)" autocomplete="off" enterkeyhint="done">
          </form>
        </div>
        <h3 class="list-header">直近の記録</h3>
        ${recent.length ? html`<div class="list">${recent.map((r) => recordRow(ds, r, true))}</div>` : html`<p class="muted" style="margin:0 16px">まだ記録はありません。</p>`}
      `,
    };
  },

  "subject-edit"(ctx, { id }) {
    const s = id ? ctx.store.data.subjects.find((x) => x.id === id) : undefined;
    const color = s?.color ?? SUBJECT_COLORS[ctx.store.data.subjects.length % SUBJECT_COLORS.length];
    return {
      title: s ? "科目を編集" : "科目を追加",
      leading: html`<button type="button" class="bar-button glass glass-interactive" data-action="sheet-close">キャンセル</button>`,
      trailing: html`<button type="submit" form="subject-form" class="bar-button prominent">${s ? "保存" : "追加"}</button>`,
      body: html`<form id="subject-form" data-submit="save-subject">
        <input type="hidden" name="id" value="${s?.id ?? ""}">
        <input type="hidden" name="color" value="${color}">
        <div class="list">
          <div class="field"><label for="s-name">名前</label><input id="s-name" name="name" required maxlength="40" value="${s?.name ?? ""}" placeholder="例: 数学" style="text-align:right;color:var(--color-label)" autofocus></div>
          <div class="field"><label for="s-goal">週の目標</label><span class="duration-input"><input id="s-goal" name="goal" type="number" inputmode="decimal" min="0" step="0.5" placeholder="—" value="${s?.weeklyGoalSec ? String(s.weeklyGoalSec / 3600) : ""}"><span>時間</span></span></div>
        </div>
        <h3 class="list-header" id="color-h">色</h3>
        <div class="list"><div class="swatches" role="radiogroup" aria-labelledby="color-h">
          ${SUBJECT_COLORS.map((c) => html`<button type="button" class="swatch" role="radio" aria-checked="${c === color}" aria-label="${COLOR_NAMES[c]}" style="--cat: var(--subject-${c})" data-action="pick-color" data-color="${c}">${raw(icon("check"))}</button>`)}
        </div></div>
        <p class="list-footer">色だけで科目を区別しないよう、グラフや一覧には常に科目名も表示されます。</p>
        <div class="field-error" id="subject-error" role="alert"></div>
        ${s ? html`<div class="spacer"></div><button type="button" class="btn block" data-action="archive-subject" data-id="${s.id}">${s.archived ? "アーカイブを解除" : "アーカイブ（記録は残ります）"}</button>` : ""}
      </form>`,
    };
  },
});

registerActions({
  "open-subject": (ctx, el) => ctx.openSheet("subject", { id: el.dataset.id! }),
  "new-subject": (ctx) => ctx.openSheet("subject-edit", {}),
  "edit-subject": (ctx, el) => ctx.openSheet("subject-edit", { id: el.dataset.id! }),
  "pick-color": (_ctx, el) => {
    const form = el.closest("form")!;
    (form.elements.namedItem("color") as HTMLInputElement).value = el.dataset.color!;
    form.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s === el)));
  },
  "archive-subject": (ctx, el) => {
    const s = ctx.store.data.subjects.find((x) => x.id === el.dataset.id);
    if (!s) return;
    ctx.safely(() => ctx.store.updateSubject(s.id, { archived: !s.archived }));
    ctx.closeSheet();
    ctx.toast(s.archived ? `${s.name}をアーカイブしました` : `${s.name}のアーカイブを解除しました`);
  },
  "toggle-task": (ctx, el) => {
    const task = ctx.store.data.tasks.find((x) => x.id === el.dataset.id);
    if (task) ctx.safely(() => ctx.store.updateTask(task.id, { status: task.status === "done" ? "open" : "done" }));
  },
});

registerSubmits({
  "save-subject": (ctx, form) => {
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const err = form.querySelector("#subject-error")!;
    if (!name) return void (err.textContent = "名前を入力してください。");
    const id = String(fd.get("id") || "");
    if (ctx.store.data.subjects.some((s) => s.name === name && s.id !== id)) return void (err.textContent = "同じ名前の科目があります。");
    const goalH = String(fd.get("goal") || "").trim();
    const weeklyGoalSec = goalH === "" ? null : Math.round(Math.max(0, Number(goalH)) * 3600) || null;
    const color = String(fd.get("color")) as SubjectColor;
    const ok = ctx.safely(() => (id ? ctx.store.updateSubject(id, { name, color, weeklyGoalSec }) : ctx.store.addSubject(name, color, weeklyGoalSec)));
    if (!ok) return;
    ctx.closeSheet();
    ctx.toast(id ? "科目を更新しました" : `「${name}」を追加しました`);
  },
  "add-task": (ctx, form) => {
    const input = form.elements.namedItem("title") as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    if (ctx.safely(() => ctx.store.addTask(form.dataset.subject || null, title))) {
      requestAnimationFrame(() => document.getElementById("new-task")?.focus());
    }
  },
});
