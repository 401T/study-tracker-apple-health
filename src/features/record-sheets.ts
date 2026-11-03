/** Record detail + add/edit sheets. */

import { html, raw } from "../components/html";
import { metric, subjectIcon } from "../components/ui";
import { icon } from "../design-system/icons";
import { fmtDate, fmtDuration } from "../analytics/format";
import { clockOf, combineLocal, isLocalDate, secondsBetween, today } from "../data/time";
import { registerActions, registerSheets, registerSubmits, type Ctx } from "../app/context";
import type { StudyRecord } from "../data/schema";

const SOURCE: Record<StudyRecord["source"], string> = {
  timer: "タイマーで計測", manual: "手入力", import: "インポート", legacy: "移行前のデータ", agent: "AIの提案（承認済み）",
};

function detailRow(label: string, value: string, opts: { measured?: boolean } = {}) {
  return html`<div class="row"><span class="row-main"><span class="row-title">${label}</span></span><span class="row-value num">${value}${opts.measured ? html` <span class="tag measured">実測</span>` : ""}</span></div>`;
}

registerSheets({
  record(ctx, { id }) {
    const ds = ctx.store.data;
    const r = ds.records.find((x) => x.id === id);
    if (!r) return { title: "記録", body: html`<p class="muted">この記録は見つかりません。</p>` };
    const s = ds.subjects.find((x) => x.id === r.subjectId);
    const task = r.taskId ? ds.tasks.find((t) => t.id === r.taskId) : null;
    const timeRange = r.startAt ? `${clockOf(r.startAt)} – ${clockOf(r.endAt) ?? "?"}` : "記録なし";
    return {
      title: "記録の詳細",
      live: true,
      trailing: r.deletedAt ? undefined : html`<button type="button" class="bar-button glass glass-interactive" data-action="edit-record" data-id="${r.id}">編集</button>`,
      body: html`
        ${r.deletedAt ? html`<div class="banner warning">${raw(icon("trash"))}<div>この記録は削除済みです。集計には含まれません。</div></div>` : ""}
        <div class="detail-hero">
          ${subjectIcon(s?.color ?? "gray")}
          <div class="card-text">${s?.name ?? "科目なし"}${task ? ` · ${task.title}` : ""}</div>
          ${metric(r.durationSec, "xl")}
          <div class="card-text">${fmtDate(r.date)} · ${timeRange}</div>
        </div>
        <div class="list">
          ${detailRow("勉強時間（休憩除く）", fmtDuration(r.durationSec), { measured: r.source === "timer" && !r.extra?.editedAfterMeasurement })}
          ${detailRow("休憩", fmtDuration(r.breakSec))}
          ${detailRow("経過時間（休憩含む）", r.elapsedSec === null ? "—" : fmtDuration(r.elapsedSec))}
          ${detailRow("記録方法", SOURCE[r.source])}
        </div>
        <h3 class="list-header">学習内容</h3>
        <div class="list"><div class="note-block">${r.note || html`<span class="muted">（未入力）</span>`}</div></div>
        <div class="spacer"></div>
        ${r.deletedAt
          ? html`<button type="button" class="btn block" data-action="restore-record" data-id="${r.id}">記録を元に戻す</button>`
          : html`<button type="button" class="btn block destructive" data-action="delete-record" data-id="${r.id}">${raw(icon("trash"))}記録を削除</button>`}
        <p class="list-footer">作成 ${new Date(r.createdAt).toLocaleString("ja-JP")} · 更新 ${new Date(r.updatedAt).toLocaleString("ja-JP")}<br>ID <span class="num">${r.id}</span></p>
      `,
    };
  },

  "record-edit"(ctx, { id, date }) {
    const ds = ctx.store.data;
    const r = id ? ds.records.find((x) => x.id === id) : undefined;
    const subjects = ds.subjects.filter((s) => !s.archived || s.id === r?.subjectId);
    const subjectId = r?.subjectId ?? subjects[0]?.id ?? "";
    const tasks = ds.tasks.filter((t) => t.status === "open" || t.id === r?.taskId);
    const totalMin = r ? Math.round(r.durationSec / 60) : 30;
    const times = !!(r?.startAt && r?.endAt);
    return {
      title: r ? "記録を編集" : "記録を追加",
      leading: html`<button type="button" class="bar-button glass glass-interactive" data-action="sheet-close">キャンセル</button>`,
      trailing: html`<button type="submit" form="record-form" class="bar-button prominent glass-interactive">${r ? "保存" : "追加"}</button>`,
      body: html`<form id="record-form" data-submit="save-record" novalidate>
        <input type="hidden" name="id" value="${r?.id ?? ""}">
        <div class="list">
          <div class="field"><label for="f-subject">科目</label>
            <select id="f-subject" name="subjectId" data-change="record-form-subject">
              ${subjects.map((s) => html`<option value="${s.id}" ${raw(s.id === subjectId ? "selected" : "")}>${s.name}</option>`)}
              <option value="" ${raw(subjectId === "" ? "selected" : "")}>科目なし</option>
            </select></div>
          <div class="field"><label for="f-task">タスク</label>
            <select id="f-task" name="taskId">
              <option value="">なし</option>
              ${tasks.map((t) => html`<option value="${t.id}" data-subject="${t.subjectId ?? ""}" ${raw(t.id === r?.taskId ? "selected" : "")} ${raw(t.subjectId && t.subjectId !== subjectId && t.id !== r?.taskId ? "hidden" : "")}>${t.title}</option>`)}
            </select></div>
        </div>
        <div class="spacer"></div>
        <div class="list">
          <div class="field"><label for="f-date">日付</label><input id="f-date" name="date" type="date" required value="${r?.date ?? date ?? today()}" max="${today()}"></div>
          <div class="field"><label for="f-start">開始</label><input id="f-start" name="start" type="time" value="${clockOf(r?.startAt ?? null) ?? ""}" data-change="record-form-times"></div>
          <div class="field"><label for="f-end">終了</label><input id="f-end" name="end" type="time" value="${clockOf(r?.endAt ?? null) ?? ""}" data-change="record-form-times"></div>
          <div class="field"><label for="f-break">休憩</label><span class="duration-input"><input id="f-break" name="breakMin" type="number" inputmode="numeric" min="0" step="1" value="${r ? Math.round(r.breakSec / 60) : 0}" data-change="record-form-times"><span>分</span></span></div>
          <div class="field"><span class="label" id="dur-label">勉強時間</span>
            <span class="duration-input" role="group" aria-labelledby="dur-label">
              <input name="hours" type="number" inputmode="numeric" min="0" max="23" aria-label="時間" value="${Math.floor(totalMin / 60)}" ${raw(times ? "readonly" : "")}><span>時間</span>
              <input name="minutes" type="number" inputmode="numeric" min="0" max="59" aria-label="分" value="${totalMin % 60}" ${raw(times ? "readonly" : "")}><span>分</span>
            </span></div>
        </div>
        <p class="list-footer" id="dur-hint">${times ? "開始・終了時刻から休憩を差し引いて自動計算しています。" : "開始・終了時刻を入れると勉強時間を自動計算します（任意）。"}</p>
        <div class="spacer"></div>
        <div class="list"><div class="field stacked"><label for="f-note">学習内容</label>
          <textarea id="f-note" name="note" rows="4" placeholder="例: 微分の応用問題 p.42–48">${r?.note ?? ""}</textarea></div></div>
        <div class="field-error" id="form-error" role="alert"></div>
      </form>`,
    };
  },
});

function computeFromTimes(form: HTMLFormElement) {
  const f = form.elements as unknown as Record<string, HTMLInputElement>;
  const start = f.start.value, end = f.end.value;
  const hint = form.querySelector("#dur-hint")!;
  const hasBoth = !!(start && end);
  f.hours.readOnly = f.minutes.readOnly = hasBoth;
  if (!hasBoth) {
    hint.textContent = "開始・終了時刻を入れると勉強時間を自動計算します（任意）。";
    return;
  }
  let elapsed = (toMin(end) - toMin(start) + 1440) % 1440;
  if (elapsed === 0) elapsed = 0;
  const brk = Math.max(0, Number(f.breakMin.value) || 0);
  const dur = Math.max(0, elapsed - brk);
  f.hours.value = String(Math.floor(dur / 60));
  f.minutes.value = String(dur % 60);
  hint.textContent = `経過 ${fmtDuration(elapsed * 60)} − 休憩 ${fmtDuration(brk * 60)} = 勉強時間 ${fmtDuration(dur * 60)}${toMin(end) < toMin(start) ? "（日付をまたぐ記録）" : ""}`;
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

registerActions({
  "open-record": (ctx, el) => ctx.openSheet("record", { id: el.dataset.id! }),
  "new-record": (ctx) => ctx.openSheet("record-edit", {}),
  "edit-record": (ctx, el) => ctx.openSheet("record-edit", { id: el.dataset.id! }),
  "record-form-times": (_ctx, el) => computeFromTimes((el as HTMLInputElement).form!),
  "record-form-subject": (_ctx, el) => {
    const sel = el as HTMLSelectElement;
    const task = sel.form!.elements.namedItem("taskId") as HTMLSelectElement;
    for (const o of [...task.options]) if (o.value) o.hidden = !!o.dataset.subject && o.dataset.subject !== sel.value;
    if (task.selectedOptions[0]?.hidden) task.value = "";
  },
  "delete-record": (ctx, el) => {
    const id = el.dataset.id!;
    if (!confirm("この記録を削除しますか？ 削除した記録は集計から除外されます（元に戻せます）。")) return;
    if (!ctx.safely(() => ctx.store.deleteRecord(id))) return;
    ctx.closeSheet();
    ctx.toast("記録を削除しました", { label: "元に戻す", run: () => ctx.safely(() => ctx.store.restoreRecord(id)) });
  },
  "restore-record": (ctx, el) => {
    ctx.safely(() => ctx.store.restoreRecord(el.dataset.id!));
    ctx.toast("記録を元に戻しました");
  },
});

registerSubmits({
  "save-record": (ctx: Ctx, form) => {
    const fd = new FormData(form);
    const err = form.querySelector("#form-error")!;
    const id = String(fd.get("id") || "");
    const date = String(fd.get("date") || "");
    const start = String(fd.get("start") || "");
    const end = String(fd.get("end") || "");
    const breakSec = Math.max(0, Math.round(Number(fd.get("breakMin") || 0))) * 60;
    const durationSec = (Math.max(0, Number(fd.get("hours") || 0)) * 60 + Math.max(0, Number(fd.get("minutes") || 0))) * 60;
    if (!isLocalDate(date)) return void (err.textContent = "日付を入力してください。");
    if (date > today()) return void (err.textContent = "未来の日付には記録できません。");
    if ((start && !end) || (!start && end)) return void (err.textContent = "開始と終了は両方入力するか、両方空にしてください。");
    let startAt: string | null = null, endAt: string | null = null, elapsedSec: number | null = null;
    if (start && end) {
      startAt = combineLocal(date, start);
      endAt = combineLocal(date, end);
      if (endAt <= startAt) {
        const d = new Date(Date.parse(endAt) + 86_400_000);
        endAt = combineLocal(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, end);
      }
      elapsedSec = secondsBetween(startAt, endAt);
      if (breakSec > elapsedSec) return void (err.textContent = "休憩が経過時間より長くなっています。");
    }
    const finalDuration = elapsedSec !== null ? elapsedSec - breakSec : durationSec;
    if (finalDuration <= 0) return void (err.textContent = "勉強時間を1分以上にしてください。");
    if (finalDuration > 24 * 3600) return void (err.textContent = "1件の記録は24時間以内にしてください。");
    const input = {
      date, startAt, endAt, elapsedSec, breakSec: elapsedSec !== null ? breakSec : 0, durationSec: finalDuration,
      subjectId: String(fd.get("subjectId") || "") || null,
      taskId: String(fd.get("taskId") || "") || null,
      note: String(fd.get("note") || "").trim(),
    };
    const ok = ctx.safely(() => (id ? ctx.store.updateRecord(id, input) : ctx.store.addRecord({ ...input, source: "manual" })));
    if (!ok) return;
    ctx.closeSheet();
    ctx.toast(id ? "記録を更新しました" : `${fmtDuration(finalDuration)}の記録を追加しました`);
  },
});
