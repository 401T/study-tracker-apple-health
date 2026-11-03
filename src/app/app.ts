/**
 * App shell: navigation (glass tab bar on phones, glass sidebar on wide screens),
 * rendering loop, sheets, dialogs, toasts, theme, timer tick, storage selection.
 * Screens and sheets live in src/features and only produce HTML + actions.
 */

import "../design-system/tokens.css";
import "../design-system/base.css";
import "../design-system/glass.css";
import "../design-system/components.css";

import { StudyStore, sessionTimes } from "../data/store";
import { localStorageAdapter, memoryAdapter, type StorageAdapter } from "../adapters/storage";
import { createAgentApi, mountSnapshot } from "../adapters/agent-api";
import { capability, inClaudeArtifact, type Db, type UserCap } from "../adapters/claude-runtime";
import { ClaudeDbStorage } from "../adapters/claude-db-storage";
import { html, raw, type Safe } from "../components/html";
import { hydrateCharts, observeChartResizes, ring } from "../components/chart";
import { icon } from "../design-system/icons";
import { LiquidGlass } from "../design-system/liquid-glass";
import { fmtClock, fmtDuration, fmtPercent } from "../analytics/format";
import { subjectName, summarizeDay } from "../analytics";
import { today } from "../data/time";
import { actions, sheets, submits, type Ctx, type Tab, type UIState } from "./context";

import { renderSummary } from "../features/summary";
import { renderRecords } from "../features/records";
import { renderAnalytics } from "../features/analytics";
import { renderSubjects } from "../features/subjects";
import { renderSettings } from "../features/settings";
import { initCoach } from "../features/coach";
import "../features/record-sheets";
import "../features/timer";
import "../features/subject-sheets";
import "../features/agent-sheets";

const TABS: { id: Tab; label: string; icon: string; title: string }[] = [
  { id: "summary", label: "サマリー", icon: "summary", title: "サマリー" },
  { id: "records", label: "記録", icon: "records", title: "記録" },
  { id: "analytics", label: "分析", icon: "analytics", title: "分析" },
  { id: "subjects", label: "科目", icon: "subjects", title: "科目" },
  { id: "settings", label: "設定", icon: "settings", title: "設定" },
];

const SCREENS: Record<Tab, (ctx: Ctx) => { body: Safe; trailing?: Safe; subtitle?: string }> = {
  summary: renderSummary,
  records: renderRecords,
  analytics: renderAnalytics,
  subjects: renderSubjects,
  settings: renderSettings,
};

function localStorageOrMemory(): StorageAdapter {
  try {
    const k = "sah:v1:probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return localStorageAdapter();
  } catch {
    return memoryAdapter(); // private mode / sandbox without storage: app works, banner explains
  }
}

/** claude.ai artifact → private cloud store (syncs devices, Claude can read it); elsewhere → this browser. */
async function pickStorage(): Promise<StorageAdapter> {
  if (!inClaudeArtifact()) return localStorageOrMemory();
  const [db, user] = await Promise.all([capability<Db>("db"), capability<UserCap>("user")]);
  const uid = user ? await user.id().catch(() => null) : null;
  if (db && uid) return new ClaudeDbStorage(db, uid);
  return localStorageOrMemory();
}

export async function boot(root: HTMLElement) {
  root.innerHTML = `<div class="wallpaper" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
    <div class="boot" role="status"><div class="boot-card glass" data-glass>${icon("timer")}<span>記録を読み込んでいます…</span></div></div>`;
  LiquidGlass.init();
  LiquidGlass.scan(root);

  const storage = await pickStorage();
  const store = new StudyStore(storage);
  await store.init();

  const ui: UIState = {
    tab: (sessionStorageGet("sah:tab") as Tab) || "summary",
    records: { q: "", subject: "all", range: "all" },
    analytics: { kind: "week", anchor: today() },
    subjectsShowArchived: false,
    proposals: [],
  };
  if (!TABS.some((t) => t.id === ui.tab)) ui.tab = "summary";

  root.innerHTML = `
    <div class="wallpaper" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
    <div class="app">
      <div class="edge-top" id="edge-top" aria-hidden="true"><i></i><i></i><i></i></div>
      <aside class="sidebar glass" data-glass aria-label="ナビゲーション">
        <div class="brand"><span class="brand-mark">${icon("timer")}</span><span>学習記録</span></div>
        <nav class="nav" id="side-nav" data-lens="side" aria-label="メイン"></nav>
        <div class="side-today" id="side-today"></div>
      </aside>
      <header class="topbar" id="topbar"><div class="topbar-inner">
        <div class="topbar-leading" id="topbar-leading"></div>
        <div class="topbar-title" id="topbar-title" aria-hidden="true"></div>
        <div class="topbar-trailing" id="topbar-trailing"></div>
      </div></header>
      <main class="screen" id="screen" tabindex="-1"></main>
      <div class="bottom-dock" id="dock">
        <div id="accessory-slot" class="dock-row"></div>
        <div class="dock-row">
          <nav class="tabbar glass" data-refract data-chroma="off" data-blur="26px" aria-label="メイン"><div class="tabs" id="tabs" data-lens="tabs"></div></nav>
          <button type="button" class="fab glass" data-refract data-chroma="off" data-blur="26px" id="fab" data-action="open-timer"></button>
        </div>
      </div>
      <div class="sheet-layer" id="sheet-layer" hidden></div>
      <div class="dialog-layer" id="dialog-layer" hidden></div>
      <div class="toast-layer" id="toast-layer" aria-live="polite"></div>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;
  const screen = $("screen");
  let sheetStack: { name: string; params: Record<string, string> }[] = [];
  let lastFocus: HTMLElement | null = null;

  const ctx: Ctx = {
    store,
    ui,
    agent: createAgentApi(store, (p) => {
      ui.proposals.push(p);
      ctx.toast("AIエージェントから変更の提案があります", { label: "確認", run: () => ctx.openSheet("proposals") });
      renderScreen();
    }),
    rerender: () => renderScreen(),
    openSheet(name, params = {}) {
      if (!sheetStack.length) lastFocus = document.activeElement as HTMLElement;
      sheetStack.push({ name, params });
      renderSheet(true);
    },
    replaceSheet(name, params = {}) {
      sheetStack[sheetStack.length - 1] = { name, params };
      renderSheet(true);
    },
    closeSheet() {
      const closed = sheetStack.pop();
      if (closed?.name === "coach") ui.coachSheetOpen = false;
      if (sheetStack.length) renderSheet(true);
      else hideSheet();
    },
    rerenderSheet: () => renderSheet(false),
    toast,
    safely(fn) {
      try {
        fn();
        return true;
      } catch (e) {
        toast((e as Error).message);
        return false;
      }
    },
    confirm: showDialog,
  };

  // ---------- Theme ----------
  function applyAppearance() {
    const s = store.data.settings;
    const el = document.documentElement;
    if (s.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", s.theme);
    if (el.dataset.glass !== s.glass) {
      el.setAttribute("data-glass", s.glass);
      LiquidGlass.refresh();
    }
    LiquidGlass.setEnabled(s.refraction !== false);
    const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#05060a" : "#eef1f8");
  }

  // ---------- Navigation ----------
  function renderNav() {
    const btn = (t: (typeof TABS)[number], cls: string) =>
      `<button type="button" class="${cls}" data-action="tab" data-tab="${t.id}"${t.id === ui.tab ? ' aria-current="page"' : ""}>${icon(t.icon)}<span class="tab-label">${t.label}</span></button>`;
    $("tabs").innerHTML = TABS.map((t) => btn(t, "tab")).join("");
    $("side-nav").innerHTML = TABS.map((t) => btn(t, "nav-item")).join("");
  }

  function renderDock() {
    const s = store.data.activeSession;
    const fab = $("fab");
    fab.classList.toggle("is-running", !!s);
    fab.innerHTML = icon(s ? "timer" : "plus");
    fab.setAttribute("aria-label", s ? "タイマーを開く（計測中）" : "記録を追加またはタイマーを開始");
    const day = summarizeDay(store.data);
    const accessory = s
      ? (() => {
          const color = store.data.subjects.find((x) => x.id === s.subjectId)?.color ?? "gray";
          const t = sessionTimes(s);
          return html`<div class="accessory glass" data-refract data-chroma="off" data-blur="26px">
            <button type="button" class="accessory-open" data-action="open-timer" aria-label="タイマーを開く: ${subjectName(store.data, s.subjectId)}、${t.paused ? "一時停止中" : "計測中"}">
              <span class="accessory-dot" style="background: var(--subject-${color})"></span>
              <span class="accessory-text"><span class="accessory-title">${subjectName(store.data, s.subjectId)}</span>
              <span class="accessory-sub">${t.paused ? "一時停止中" : "計測中"}</span></span>
              <span class="accessory-time" data-live="timer-clock" aria-hidden="true">${fmtClock(t.studySec)}</span>
            </button>
            <button type="button" class="round-button primary" data-action="${t.paused ? "timer-resume" : "timer-pause"}" aria-label="${t.paused ? "再開" : "一時停止"}">${raw(icon(t.paused ? "play" : "pause"))}</button>
          </div>`.value;
        })()
      : "";
    $("accessory-slot").innerHTML = accessory;
    const pct = day.goalRatio === null ? "—" : fmtPercent(day.goalRatio);
    $("side-today").innerHTML = html`
      <div class="side-ring">${ring(day.goalRatio, html`<span class="pct num">${pct}</span>`, `今日の目標達成率 ${pct}`)}
        <div><span class="metric-label">今日</span><div class="side-total num">${fmtDuration(day.totalSec)}</div><span class="card-text" style="font:var(--type-footnote)">目標 ${fmtDuration(day.goalSec)}</span></div></div>
      ${raw(accessory)}
      <button type="button" class="btn block primary glass-interactive" data-action="open-timer">${raw(icon(s ? "timer" : "play"))}${s ? "計測中のタイマー" : "タイマーを開始"}</button>
      <button type="button" class="btn block" data-action="new-record">${raw(icon("edit"))}手入力で記録</button>`.value;
  }

  // ---------- Screen ----------
  function renderScreen() {
    applyAppearance();
    const meta = TABS.find((t) => t.id === ui.tab)!;
    const view = SCREENS[ui.tab](ctx);
    const banners: Safe[] = [];
    if (store.loadError) banners.push(html`<div class="banner warning" role="alert">${raw(icon("warning"))}<div>${store.loadError}</div></div>`);
    if (storage.name === "memory")
      banners.push(html`<div class="banner warning" role="status">${raw(icon("warning"))}<div>この環境ではデータを保存できないため、記録は再読み込みで消えます。設定 → データ からJSONを書き出してください。</div></div>`);
    if (store.saveError) banners.push(html`<div class="banner warning" role="alert">${raw(icon("warning"))}<div>保存に失敗しました: ${store.saveError.message}</div></div>`);
    if (ui.proposals.length)
      banners.push(html`<button type="button" class="banner" data-action="open-proposals" style="width:100%;border:0;text-align:left">${raw(icon("sparkles"))}<div><strong>AIエージェントの提案 ${ui.proposals.length}件</strong><br>承認するまでデータは変更されません。タップして確認</div></button>`);

    const scroll = window.scrollY;
    screen.innerHTML = html`${banners}<h1 class="large-title">${meta.title}</h1>${view.subtitle ? html`<p class="large-subtitle">${view.subtitle}</p>` : ""}${view.body}`.value;
    $("topbar-title").textContent = meta.title;
    $("topbar-trailing").innerHTML = view.trailing?.value ?? "";
    renderNav();
    renderDock();
    hydrateCharts(screen);
    LiquidGlass.scan(document);
    window.scrollTo(0, scroll);
    document.title = `${meta.title} — 学習記録`;
  }

  // ---------- Sheets ----------
  function renderSheet(fresh: boolean) {
    const top = sheetStack[sheetStack.length - 1];
    if (!top) return;
    const renderer = sheets[top.name];
    if (!renderer) return;
    const v = renderer(ctx, top.params);
    const layer = $("sheet-layer");
    const prevScroll = layer.querySelector(".sheet-body")?.scrollTop ?? 0;
    layer.hidden = false;
    layer.classList.remove("is-closing");
    layer.innerHTML = html`<div class="sheet-scrim" data-action="sheet-close"></div>
      <div class="sheet glass glass-thick" data-glass role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-sheet="${top.name}">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <div class="sheet-header">
          <div class="leading">${v.leading ?? html`<button type="button" class="bar-button icon-only glass glass-interactive" data-refract data-action="sheet-close" aria-label="閉じる">${raw(icon("close"))}</button>`}</div>
          <h2 id="sheet-title">${v.title}</h2>
          <div class="trailing">${v.trailing ?? ""}</div>
        </div>
        <div class="sheet-body">${v.body}</div>
      </div>`.value;
    hydrateCharts(layer);
    LiquidGlass.scan(layer);
    document.body.style.overflow = "hidden";
    for (const el of [screen, $("dock"), document.querySelector<HTMLElement>(".sidebar")!]) {
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    const body = layer.querySelector(".sheet-body")!;
    if (fresh) {
      const first = layer.querySelector<HTMLElement>("[autofocus]") ?? layer.querySelector<HTMLElement>(".sheet-header h2");
      if (first) {
        if (!first.hasAttribute("tabindex") && first.tagName === "H2") first.setAttribute("tabindex", "-1");
        first.focus({ preventScroll: true });
      }
    } else body.scrollTop = prevScroll;
  }

  function hideSheet() {
    const layer = $("sheet-layer");
    const finish = () => {
      layer.hidden = true;
      layer.innerHTML = "";
      layer.classList.remove("is-closing");
      document.body.style.overflow = "";
      for (const el of [screen, $("dock"), document.querySelector<HTMLElement>(".sidebar")!]) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("inert");
      }
      lastFocus?.focus?.({ preventScroll: true });
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    layer.classList.add("is-closing");
    layer.querySelector(".sheet")?.classList.add("is-closing");
    setTimeout(finish, 200);
  }

  // ---------- Confirmation dialog (alert style) ----------
  function showDialog(opts: { title: string; message?: string; ok: string; destructive?: boolean }): Promise<boolean> {
    const layer = $("dialog-layer");
    const prev = document.activeElement as HTMLElement | null;
    return new Promise((resolve) => {
      layer.hidden = false;
      layer.innerHTML = html`<div class="dialog-scrim"></div>
        <div class="dialog glass glass-thick" data-glass role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-m">
          <h2 id="dlg-t">${opts.title}</h2>${opts.message ? html`<p id="dlg-m">${opts.message}</p>` : ""}
          <div class="btn-row"><button type="button" class="btn" data-dlg="0">キャンセル</button>
          <button type="button" class="btn ${opts.destructive ? "destructive-fill" : "primary"}" data-dlg="1">${opts.ok}</button></div>
        </div>`.value;
      LiquidGlass.scan(layer);
      const done = (v: boolean) => {
        layer.hidden = true;
        layer.innerHTML = "";
        document.removeEventListener("keydown", onKey, true);
        prev?.focus?.({ preventScroll: true });
        resolve(v);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          done(false);
        }
      };
      document.addEventListener("keydown", onKey, true);
      layer.querySelectorAll<HTMLButtonElement>("[data-dlg]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        done(b.dataset.dlg === "1");
      }));
      layer.querySelector<HTMLButtonElement>('[data-dlg="0"]')!.focus();
    });
  }

  // ---------- Toast ----------
  let toastTimer: number | undefined;
  function toast(message: string, action?: { label: string; run: () => void }) {
    const layer = $("toast-layer");
    layer.innerHTML = html`<div class="toast glass" data-refract role="status"><span>${message}</span>${action ? html`<button type="button" class="text-button" id="toast-action">${action.label}</button>` : ""}</div>`.value;
    LiquidGlass.scan(layer);
    if (action) $("toast-action").addEventListener("click", () => {
      layer.innerHTML = "";
      action.run();
    });
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (layer.innerHTML = ""), action ? 6000 : 3200);
  }

  // ---------- Events ----------
  document.addEventListener("click", async (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || (el as HTMLButtonElement).disabled) return;
    const name = el.dataset.action!;
    const h = actions[name] ?? builtins[name];
    if (!h) return;
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await h(ctx, el, ev);
    } catch (e) {
      toast((e as Error).message);
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (!$("dialog-layer").hidden) return;
    if (ev.key === "Escape" && sheetStack.length) {
      ev.preventDefault();
      ctx.closeSheet();
    }
    if (ev.key === "Tab" && sheetStack.length) {
      const f = [...$("sheet-layer").querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener("submit", async (ev) => {
    const form = ev.target as HTMLFormElement;
    const h = submits[form.dataset.submit ?? ""];
    if (!h) return;
    ev.preventDefault();
    try {
      await h(ctx, form);
    } catch (e) {
      toast((e as Error).message);
    }
  });
  document.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    const name = el.dataset.input;
    if (name && actions[name]) void actions[name](ctx, el, ev);
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target as HTMLInputElement;
    const name = el.dataset.change;
    if (name && actions[name]) void actions[name](ctx, el, ev);
  });

  // Scroll: graded edge blur; tab bar minimizes on scroll down.
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const scrolled = y > 28;
    $("topbar").classList.toggle("is-scrolled", scrolled);
    $("edge-top").classList.toggle("is-on", y > 4);
    const dock = $("dock");
    if (y > lastY + 6 && y > 120) dock.classList.add("is-minimized");
    else if (y < lastY - 6 || y < 60) dock.classList.remove("is-minimized");
    lastY = y;
  }, { passive: true });

  const builtins: Record<string, (ctx: Ctx, el: HTMLElement) => void> = {
    tab(c, el) {
      const t = el.dataset.tab as Tab;
      if (c.ui.tab === t) {
        window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return;
      }
      c.ui.tab = t;
      sessionStorageSet("sah:tab", t);
      window.scrollTo(0, 0);
      renderScreen();
    },
    "sheet-close": (c) => c.closeSheet(),
    "open-proposals": (c) => c.openSheet("proposals"),
  };

  // ---------- Live updates ----------
  store.subscribe(() => {
    renderScreen();
    const top = sheetStack[sheetStack.length - 1];
    if (top && sheets[top.name] && sheets[top.name](ctx, top.params).live) renderSheet(false);
  });
  store.onSaveError(() => renderScreen());
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => renderScreen());

  setInterval(() => {
    const s = store.data.activeSession;
    if (!s) return;
    const t = sessionTimes(s);
    document.querySelectorAll<HTMLElement>('[data-live="timer-clock"]').forEach((el) => (el.textContent = fmtClock(t.studySec)));
    document.querySelectorAll<HTMLElement>('[data-live="timer-elapsed"]').forEach((el) => (el.textContent = fmtClock(t.elapsedSec)));
    document.querySelectorAll<HTMLElement>('[data-live="timer-break"]').forEach((el) => (el.textContent = fmtClock(t.breakSec)));
  }, 1000);

  observeChartResizes(screen);
  mountSnapshot(store);
  (window as unknown as { studyTracker: unknown }).studyTracker = ctx.agent;
  renderScreen();
  void initCoach(ctx);
  return ctx;
}

function sessionStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
