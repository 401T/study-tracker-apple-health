/**
 * Claude コーチ: Claude reads the study records and comments on them.
 *
 * Runs through the claude.ai artifact `sample` capability, so it works only when
 * the app is opened as a claude.ai artifact. Every request sends the rules from
 * docs/AGENT_INSTRUCTIONS.md plus a computed report (toMarkdown), so answers are
 * grounded in the records and separate facts from interpretation.
 * Comments are kept in the private db next to the data (…/tracker/coach/<id>).
 */

import { html, raw, type Safe } from "../components/html";
import { icon } from "../design-system/icons";
import { registerActions, registerSheets, registerSubmits, type Ctx } from "../app/context";
import { capability, type DbCollection, type SampleCap } from "../adapters/claude-runtime";
import { ClaudeDbStorage } from "../adapters/claude-db-storage";
import { toMarkdown } from "../adapters/ai-report";
import { recordsInRange, summarizePeriod, bySubject, subjectName } from "../analytics";
import { addDays, today } from "../data/time";
import { fmtDuration } from "../analytics/format";

interface CoachNote {
  id: string;
  kind: "comment" | "chat";
  createdAt: string;
  question?: string;
  text: string;
  range: { start: string; end: string };
}

type Msg = { role: "user" | "assistant"; content: string };

const state = {
  /** null = still checking, false = not available here */
  available: null as boolean | null,
  notes: [] as CoachNote[],
  busy: false,
  streaming: "",
  error: "",
  chat: [] as Msg[],
  abort: null as AbortController | null,
};

let sample: SampleCap | null = null;
let notesCol: DbCollection | null = null;
let toolsOk = false;

const RULES = `あなたは、この学習者専属の学習コーチ「Claude」です。以下の「データ」は学習者本人の勉強時間の記録から計算したものです。
必ず守ること:
- データにある数値だけを使い、存在しない記録や数値を作らない。期間（日付）を明記する。
- 勉強時間＝休憩を除いた時間。経過時間（休憩込み）と混同しない。計画と実績を区別する。
- 「事実（記録から計算）」と「あなたの解釈・推測」をはっきり分ける。
- 勉強時間だけから理解度・学力・集中力・やる気を断定しない。
- 記録のない日を「勉強しなかった日」と断定しない（記録しなかった可能性がある）。
- 進行中の週・月は途中の値として扱う。
- 前向きで具体的に。批判するときは数値の根拠と、実行できる代案（時間・曜日・科目）を添える。
- 判断に必要だが記録にない情報（試験日・優先度・苦手分野）は最後に1〜2個だけ質問してよい。
- 日本語。Markdown の見出し（###）、箇条書き（-）、太字（**）だけを使う。表は使わない。`;

function reportFor(ctx: Ctx, days: number) {
  const t = today();
  return toMarkdown(ctx.store.data, { start: addDays(t, -(days - 1)), end: t, asOf: t });
}

/** Tools Claude may call for detail beyond the report (only where the runtime supports them). */
function tools(ctx: Ctx) {
  const ds = () => ctx.store.data;
  return [
    {
      name: "get_records",
      description: "期間内の勉強記録を返す（日付は YYYY-MM-DD、両端を含む、最大200件）。分は休憩を除いた勉強時間。",
      inputSchema: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] },
      execute: (i: Record<string, unknown>) =>
        recordsInRange(ds(), String(i.start), String(i.end)).slice(-200).map((r) => ({
          id: r.id, date: r.date, start: r.startAt, end: r.endAt, min: Math.round(r.durationSec / 6) / 10,
          breakMin: Math.round(r.breakSec / 6) / 10, subject: subjectName(ds(), r.subjectId), note: r.note, source: r.source,
        })),
    },
    {
      name: "get_period_summary",
      description: "期間の合計・1日平均・学習日数・目標達成日数・科目別の分を返す。",
      inputSchema: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] },
      execute: (i: Record<string, unknown>) => {
        const p = summarizePeriod(ds(), String(i.start), String(i.end));
        return {
          totalMin: Math.round(p.totalSec / 60), avgPerDayMin: Math.round(p.avgPerDaySec / 60), activeDays: p.activeDays, days: p.days,
          daysGoalMet: p.daysGoalMet, bySubject: bySubject(ds(), p.start, p.end).map((s) => ({ name: s.name, min: Math.round(s.sec / 60), share: Math.round(s.share * 100) })),
        };
      },
    },
  ];
}

export async function initCoach(ctx: Ctx) {
  sample = await capability<SampleCap>("sample");
  state.available = !!sample;
  if (sample?.limits) {
    try {
      toolsOk = !!(await sample.limits()).tools;
    } catch {
      toolsOk = false;
    }
  }
  if (ctx.store.storage instanceof ClaudeDbStorage) {
    notesCol = ctx.store.storage.collection("coach");
    try {
      const q = await notesCol.orderBy("createdAt", "desc").limit(20).get();
      state.notes = q.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...(d.data() as Omit<CoachNote, "id">) }));
    } catch {
      /* comments history is optional */
    }
  }
  ctx.rerender();
}

async function saveNote(n: Omit<CoachNote, "id">) {
  if (!notesCol) {
    state.notes.unshift({ id: `local_${Date.now()}`, ...n });
    return;
  }
  const ref = notesCol.doc();
  try {
    await ref.set(n as unknown as Record<string, unknown>);
  } catch {
    /* keep it in memory even if it could not be stored */
  }
  state.notes.unshift({ id: ref.id, ...n });
  const extra = state.notes.slice(30);
  state.notes = state.notes.slice(0, 30);
  for (const old of extra) if (!old.id.startsWith("local_")) await notesCol.doc(old.id).delete().catch(() => {});
}

function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "cancelled") return "";
  if (code === "not_granted") return "Claude の利用が許可されていません。アーティファクトの権限設定から許可できます。";
  if (code === "rate_limited") return "利用回数の上限に達しました。しばらく時間をおいてから試してください。";
  return "Claude から返事を受け取れませんでした。時間をおいてもう一度試してください。";
}

async function ask(ctx: Ctx, messages: Msg[], onDone: (text: string) => void) {
  if (!sample || state.busy) return;
  state.busy = true;
  state.error = "";
  state.streaming = "";
  state.abort = new AbortController();
  const refresh = () => {
    document.querySelectorAll<HTMLElement>("[data-coach-stream]").forEach((el) => (el.innerHTML = renderMarkdown(state.streaming || "考えています…").value));
  };
  ctx.rerender();
  ctx.rerenderSheet();
  try {
    const res = await sample(messages, {
      modelTier: "default",
      cache: false,
      signal: state.abort.signal,
      onText: ({ text }) => {
        state.streaming = text;
        refresh();
      },
      ...(toolsOk ? { tools: tools(ctx) } : {}),
    });
    onDone(res.text);
  } catch (e) {
    state.error = errorText(e);
  } finally {
    state.busy = false;
    state.streaming = "";
    state.abort = null;
    ctx.rerender();
    ctx.rerenderSheet();
  }
}

async function requestComment(ctx: Ctx) {
  const t = today();
  const start = addDays(t, -27);
  const content = `${RULES}

### 依頼
直近の勉強の様子について、コーチとしてコメントしてください。次の構成で 300〜500 字。
### 今週の様子（事実）
### よかったこと
### 気になること
### 次の一手（具体的に）

--- データ ---
${reportFor(ctx, 28)}`;
  await ask(ctx, [{ role: "user", content }], async (text) => {
    await saveNote({ kind: "comment", createdAt: new Date().toISOString(), text, range: { start, end: t } });
  });
}

async function sendChat(ctx: Ctx, question: string) {
  const t = today();
  if (!state.chat.length) {
    state.chat.push({ role: "user", content: `${RULES}\n\n--- データ（直近56日） ---\n${reportFor(ctx, 56)}\n\n--- 質問 ---\n${question}` });
  } else state.chat.push({ role: "user", content: question });
  (state.chat[state.chat.length - 1] as Msg & { display?: string }).display = question;
  await ask(ctx, state.chat, async (text) => {
    state.chat.push({ role: "assistant", content: text });
    await saveNote({ kind: "chat", createdAt: new Date().toISOString(), question, text, range: { start: addDays(t, -55), end: t } });
  });
}

/** Tiny safe Markdown: escape first, then ###, -, ** and paragraphs. */
export function renderMarkdown(src: string): Safe {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const line of src.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) { flush(); continue; }
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    const li = /^[-*・]\s+(.*)$/.exec(l);
    if (h) { flush(); out.push(`<h4>${inline(h[1])}</h4>`); }
    else if (li) list.push(inline(li[1]));
    else { flush(); out.push(`<p>${inline(l)}</p>`); }
  }
  flush();
  return raw(out.join(""));
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Card for the Summary screen. */
export function coachCard(ctx: Ctx): Safe {
  if (state.available === false) {
    return html`<section class="card coach span-2" aria-labelledby="coach-h">
      <div class="card-header"><span class="cat">${raw(icon("sparkles"))}<span id="coach-h">Claude のコメント</span></span></div>
      <p class="card-text">claude.ai のアーティファクトとして開くと、Claude があなたの記録を読んでコメントします。</p>
    </section>`;
  }
  const latest = state.notes.find((n) => n.kind === "comment");
  const week = summarizePeriod(ctx.store.data, addDays(today(), -6), today());
  return html`<section class="card coach span-2" aria-labelledby="coach-h" aria-busy="${state.busy}">
    <div class="card-header"><span class="cat">${raw(icon("sparkles"))}<span id="coach-h">Claude のコメント</span></span>
      <span class="meta">${latest && !state.busy ? fmtWhen(latest.createdAt) : state.busy ? "読んでいます…" : ""}</span></div>
    ${state.busy && !ctx.ui.coachSheetOpen
      ? html`<div class="coach-body" data-coach-stream aria-live="polite">${renderMarkdown(state.streaming || "記録を読んでいます…")}</div>`
      : latest
        ? html`<div class="coach-body is-clamped">${renderMarkdown(latest.text)}</div>`
        : html`<p class="card-text">直近4週間の記録（${fmtDuration(week.totalSec)} / 直近7日）を Claude が読み、よかった点と次の一手をコメントします。</p>`}
    ${state.error ? html`<p class="field-error" role="alert" style="padding:8px 0 0">${state.error}</p>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button type="button" class="btn small" data-action="coach-open">${raw(icon("note"))}${latest ? "全文・質問する" : "質問する"}</button>
      <button type="button" class="btn small primary" data-action="coach-comment" ${raw(state.busy || state.available === null ? "disabled" : "")}>${raw(icon("sparkles"))}${latest ? "新しいコメント" : "コメントをもらう"}</button>
    </div>
  </section>`;
}

registerSheets({
  coach(ctx) {
    const thread = state.chat.map((m) => ({ ...m, display: (m as Msg & { display?: string }).display ?? m.content }));
    const history = state.notes.slice(0, 10);
    return {
      title: "Claude に相談",
      body: html`
        <p class="card-text" style="margin:0 4px 12px">Claude はあなたの記録（直近8週間）を読んで答えます。記録にない数値は作らず、事実と推測を分けて答えます。</p>
        <div class="chat" aria-live="polite">
          ${thread.length === 0 && !state.busy
            ? html`<div class="suggest">${["直近7日の勉強時間はどう推移した？", "科目の配分は偏ってない？", "減っている科目はある？", "来週の計画を立てて"].map(
                (q) => html`<button type="button" class="chip" data-action="coach-suggest" data-q="${q}">${q}</button>`,
              )}</div>`
            : thread.map((m) =>
                m.role === "user"
                  ? html`<div class="bubble me">${m.display}</div>`
                  : html`<div class="bubble ai">${renderMarkdown(m.content)}</div>`,
              )}
          ${state.busy && ctx.ui.coachSheetOpen ? html`<div class="bubble ai" data-coach-stream>${renderMarkdown(state.streaming || "考えています…")}</div>` : ""}
          ${state.error ? html`<p class="field-error" role="alert">${state.error}</p>` : ""}
        </div>
        <form class="composer glass" data-submit="coach-send">
          <label class="sr-only" for="coach-q">Claude への質問</label>
          <input id="coach-q" name="q" autocomplete="off" enterkeyhint="send" placeholder="記録について質問…" ${raw(state.busy ? "disabled" : "")}>
          ${state.busy
            ? html`<button type="button" class="round-button" data-action="coach-stop" aria-label="止める">${raw(icon("stop"))}</button>`
            : html`<button type="submit" class="round-button primary" aria-label="送信">${raw(icon("arrowUp"))}</button>`}
        </form>
        ${history.length ? html`<h3 class="list-header">これまでのコメント</h3>
          <div class="stack">${history.map((n) => html`<details class="card history"><summary><span>${n.kind === "comment" ? "コメント" : `質問: ${n.question ?? ""}`}</span><span class="muted">${fmtWhen(n.createdAt)}</span></summary><div class="coach-body">${renderMarkdown(n.text)}</div></details>`)}</div>` : ""}
      `,
    };
  },
});

registerActions({
  "coach-comment": (ctx) => void requestComment(ctx),
  "coach-open": (ctx) => {
    ctx.ui.coachSheetOpen = true;
    ctx.openSheet("coach");
  },
  "coach-suggest": (ctx, el) => void sendChat(ctx, el.dataset.q!),
  "coach-stop": () => state.abort?.abort(),
});

registerSubmits({
  "coach-send": (ctx, form) => {
    const q = String(new FormData(form).get("q") ?? "").trim();
    if (q) void sendChat(ctx, q);
  },
});
