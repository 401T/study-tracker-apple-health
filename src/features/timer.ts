/**
 * Timer sheet. Shows STUDY time (breaks excluded) as the main number and the
 * wall-clock elapsed time separately, so the two are never confused.
 */

import { html, raw } from "../components/html";
import { icon } from "../design-system/icons";
import { fmtClock, fmtDuration } from "../analytics/format";
import { sessionTimes } from "../data/store";
import { clockOf } from "../data/time";
import { registerActions, registerSheets, type Ctx } from "../app/context";

let draftSubject: string | null | undefined;
let draftTask: string | null = null;

registerSheets({
  timer(ctx) {
    const ds = ctx.store.data;
    const s = ds.activeSession;
    const subjects = ds.subjects.filter((x) => !x.archived);
    const current = s ? s.subjectId : draftSubject !== undefined ? draftSubject : subjects[0]?.id ?? null;
    const tasks = ds.tasks.filter((t) => t.status === "open" && (!current || t.subjectId === current || !t.subjectId));
    const t = s ? sessionTimes(s) : null;

    const subjectChips = html`<div class="chips" role="radiogroup" aria-label="科目">${subjects.map(
      (x) => html`<button type="button" class="chip" role="radio" style="--cat: var(--subject-${x.color})" aria-pressed="${x.id === current}" aria-checked="${x.id === current}" data-action="timer-subject" data-id="${x.id}"><span class="dot"></span>${x.name}</button>`,
    )}<button type="button" class="chip" role="radio" aria-pressed="${current === null}" aria-checked="${current === null}" data-action="timer-subject" data-id="">科目なし</button></div>`;

    const body = html`
      <div class="timer-display" aria-live="off">
        <div class="clock num" data-live="timer-clock" role="timer" aria-label="勉強時間">${fmtClock(t?.studySec ?? 0)}</div>
        <div class="sub">${s
          ? html`${t!.paused ? "一時停止中" : "計測中"} · 開始 ${clockOf(s.startedAt)} · 経過 <span class="num" data-live="timer-elapsed">${fmtClock(t!.elapsedSec)}</span> · 休憩 <span class="num" data-live="timer-break">${fmtClock(t!.breakSec)}</span>`
          : "勉強時間は休憩を除いて計測されます"}</div>
      </div>
      <div class="timer-controls">
        ${s
          ? html`<div class="labelled"><button type="button" class="round-button" data-action="timer-finish" aria-label="終了して記録">${raw(icon("stop"))}</button>終了</div>
                 <div class="labelled"><button type="button" class="round-button primary" data-action="${t!.paused ? "timer-resume" : "timer-pause"}" aria-label="${t!.paused ? "再開" : "一時停止（休憩）"}">${raw(icon(t!.paused ? "play" : "pause"))}</button>${t!.paused ? "再開" : "休憩"}</div>`
          : html`<div class="labelled"><button type="button" class="round-button primary" data-action="timer-start" aria-label="計測を開始" autofocus>${raw(icon("play"))}</button>開始</div>`}
      </div>
      <h3 class="list-header">科目</h3>
      ${subjects.length ? subjectChips : html`<p class="muted" style="margin:0 4px">科目がありません。<button type="button" class="text-button" data-action="new-subject">科目を追加</button></p>`}
      <div class="spacer"></div>
      <div class="list">
        <div class="field"><label for="t-task">タスク</label>
          <select id="t-task" data-change="timer-task">
            <option value="">なし</option>
            ${tasks.map((x) => html`<option value="${x.id}" ${raw(x.id === s?.taskId ? "selected" : "")}>${x.title}</option>`)}
          </select></div>
        <div class="field stacked"><label for="t-note">学習内容</label>
          <textarea id="t-note" rows="3" placeholder="何を勉強しますか？" data-change="timer-note">${s?.note ?? ctx.ui.timerDraftNote ?? ""}</textarea></div>
      </div>
      <div class="spacer"></div>
      ${s
        ? html`<button type="button" class="btn block destructive" data-action="timer-discard">記録せずに破棄</button>`
        : html`<button type="button" class="btn block" data-action="timer-manual">${raw(icon("edit"))}時間を手入力して記録</button>`}
    `;
    return { title: s ? "計測中" : "タイマー", body };
  },
});

registerActions({
  "open-timer": (ctx) => {
    draftSubject = undefined;
    ctx.openSheet("timer");
  },
  "timer-subject": (ctx, el) => {
    const id = el.dataset.id || null;
    if (ctx.store.data.activeSession) ctx.safely(() => ctx.store.updateSession({ subjectId: id, taskId: null }));
    else draftSubject = id;
    patchSelection(ctx, id);
  },
  "timer-task": (ctx, el) => {
    const v = (el as HTMLSelectElement).value || null;
    if (ctx.store.data.activeSession) ctx.safely(() => ctx.store.updateSession({ taskId: v }));
    else draftTask = v;
  },
  "timer-note": (ctx, el) => {
    const v = (el as HTMLTextAreaElement).value;
    if (ctx.store.data.activeSession) ctx.safely(() => ctx.store.updateSession({ note: v }));
    else ctx.ui.timerDraftNote = v;
  },
  "timer-start": (ctx) => {
    const ds = ctx.store.data;
    const subjectId = draftSubject !== undefined ? draftSubject : ds.subjects.find((x) => !x.archived)?.id ?? null;
    const note = (document.getElementById("t-note") as HTMLTextAreaElement | null)?.value ?? "";
    const task = (document.getElementById("t-task") as HTMLSelectElement | null)?.value || draftTask;
    if (ctx.safely(() => ctx.store.startSession(subjectId, task || null, note))) {
      ctx.ui.timerDraftNote = "";
      ctx.rerenderSheet();
    }
  },
  "timer-pause": (ctx) => {
    ctx.safely(() => ctx.store.pauseSession());
    ctx.rerenderSheet();
  },
  "timer-resume": (ctx) => {
    ctx.safely(() => ctx.store.resumeSession());
    ctx.rerenderSheet();
  },
  "timer-finish": (ctx) => {
    const s = ctx.store.data.activeSession;
    if (!s) return;
    const { studySec } = sessionTimes(s);
    if (studySec < 60 && !confirm("勉強時間が1分未満です。記録しますか？")) return;
    let rec: ReturnType<typeof ctx.store.finishSession> = null;
    if (!ctx.safely(() => (rec = ctx.store.finishSession()))) return;
    ctx.closeSheet();
    if (rec) {
      const id = (rec as { id: string }).id;
      ctx.toast(`${studySec < 60 ? "1分未満" : fmtDuration(studySec)}を記録しました`, { label: "詳細", run: () => ctx.openSheet("record", { id }) });
    }
  },
  "timer-discard": (ctx) => {
    if (!confirm("計測中の時間を記録せずに破棄しますか？")) return;
    ctx.safely(() => ctx.store.discardSession());
    ctx.closeSheet();
  },
  "timer-manual": (ctx) => ctx.replaceSheet("record-edit", {}),
});

/** Update chip selection in place (no full re-render, keeps textarea focus/content). */
function patchSelection(ctx: Ctx, id: string | null) {
  document.querySelectorAll<HTMLElement>('[data-action="timer-subject"]').forEach((c) => {
    const on = (c.dataset.id || null) === id;
    c.setAttribute("aria-pressed", String(on));
    c.setAttribute("aria-checked", String(on));
  });
  const sel = document.getElementById("t-task") as HTMLSelectElement | null;
  if (sel) {
    const tasks = ctx.store.data.tasks.filter((t) => t.status === "open" && (!id || t.subjectId === id || !t.subjectId));
    sel.innerHTML = `<option value="">なし</option>` + tasks.map((t) => html`<option value="${t.id}">${t.title}</option>`.value).join("");
    draftTask = null;
  }
}
