/** 設定 (Settings): appearance, goals, AI data, export/import, backups, integrity. */

import { html, raw } from "../components/html";
import { rowButton, segmented } from "../components/ui";
import { icon } from "../design-system/icons";
import { fmtDuration } from "../analytics/format";
import { registerActions, type Ctx } from "../app/context";
import { toCSV, toJSON, recordsFromCSV } from "../data/io";
import { toMarkdown } from "../adapters/ai-report";
import { SCHEMA_VERSION } from "../data/schema";
import { today } from "../data/time";
import { capability, type DownloadsCap } from "../adapters/claude-runtime";
import { emptyDataset } from "../data/validate";

export const APP_VERSION = "1.0.0";

function iconBox(name: string, color: string) {
  return html`<span class="row-icon" style="--cat: var(--subject-${color})">${raw(icon(name))}</span>`;
}

export function renderSettings(ctx: Ctx) {
  const s = ctx.store.data.settings;
  const deleted = ctx.store.data.records.filter((r) => r.deletedAt).length;
  const body = html`
    <h2 class="list-header">表示</h2>
    <div class="list">
      <div class="field"><span class="label" id="theme-l">テーマ</span><div style="flex:1;max-width:260px;margin-left:auto">${segmented("テーマ", [
        { value: "system", label: "自動" }, { value: "light", label: "ライト" }, { value: "dark", label: "ダーク" },
      ], s.theme, "set-theme")}</div></div>
      <div class="field"><span class="label">ガラス効果</span><div style="flex:1;max-width:260px;margin-left:auto">${segmented("ガラス効果", [
        { value: "standard", label: "標準" }, { value: "reduced", label: "不透明" },
      ], s.glass, "set-glass")}</div></div>
    </div>
    <div class="spacer"></div>
    <div class="list">
      <div class="field"><span class="label" id="refr-l">Liquid Glass の屈折</span>
        <button type="button" role="switch" class="switch" aria-checked="${s.refraction !== false}" aria-labelledby="refr-l" data-action="toggle-refraction" style="margin-left:auto"><span class="knob"></span></button></div>
    </div>
    <p class="list-footer">「不透明」はガラスの透過をやめ、読みやすさを優先します。端末の「透明度を下げる」にも従います。屈折は Chrome 系ブラウザで表示されます（Safari ではぼかしのみ）。</p>

    <h2 class="list-header">目標</h2>
    <div class="list">
      <div class="field"><span class="label" id="goal-l">1日の目標</span>
        <span class="stepper" style="margin-left:auto" role="group" aria-labelledby="goal-l">
          <button type="button" class="round-button" data-action="goal-step" data-step="-900" aria-label="15分減らす">${raw(icon("minus"))}</button>
          <output class="num" aria-live="polite">${s.dailyGoalSec ? fmtDuration(s.dailyGoalSec) : "なし"}</output>
          <button type="button" class="round-button" data-action="goal-step" data-step="900" aria-label="15分増やす">${raw(icon("plus"))}</button>
        </span></div>
      <div class="field"><span class="label">週の始まり</span><div style="flex:1;max-width:200px;margin-left:auto">${segmented("週の始まり", [
        { value: "1", label: "月曜" }, { value: "0", label: "日曜" },
      ], String(s.weekStartsOn), "set-weekstart")}</div></div>
    </div>
    <p class="list-footer">科目ごとの週の目標は「科目」から設定できます。</p>

    <h2 class="list-header">AIエージェント連携</h2>
    <div class="list">
      ${rowButton({ action: "copy-ai-report", leading: iconBox("sparkles", "indigo"), title: "AI用レポートをコピー", sub: "直近90日の記録と集計（Markdown）", chevron: false })}
      ${rowButton({ action: "open-ai-info", leading: iconBox("info", "blue"), title: "AIが読めるデータについて" })}
      ${ctx.ui.proposals.length ? rowButton({ action: "open-proposals", leading: iconBox("edit", "orange"), title: "AIからの変更提案", value: `${ctx.ui.proposals.length}件` }) : ""}
    </div>
    <p class="list-footer">AIは記録を読み取って分析できます。AIによる記録の追加・変更は、ここで承認するまで反映されません。</p>

    <h2 class="list-header">データ</h2>
    <div class="list">
      ${rowButton({ action: "export", data: { format: "json" }, leading: iconBox("download", "green"), title: "JSONで書き出す", sub: "すべてのデータ（完全なバックアップ）", chevron: false })}
      ${rowButton({ action: "export", data: { format: "csv" }, leading: iconBox("download", "teal"), title: "CSVで書き出す", sub: "記録の一覧（表計算ソフト用）", chevron: false })}
      ${rowButton({ action: "export", data: { format: "md" }, leading: iconBox("download", "purple"), title: "Markdownで書き出す", sub: "AIや人が読むためのレポート", chevron: false })}
      <label class="row has-icon" style="cursor:pointer">${iconBox("upload", "blue")}<span class="row-main"><span class="row-title">ファイルから読み込む</span><span class="row-sub">JSON / CSV · 既存の記録は削除されません</span></span>
        <input type="file" accept=".json,.csv,application/json,text/csv" class="sr-only" data-change="import-file"></label>
    </div>
    <div class="spacer"></div>
    <div class="list">
      ${rowButton({ action: "open-backups", leading: iconBox("backup", "brown"), title: "バックアップと復元" })}
      ${rowButton({ action: "open-integrity", leading: iconBox("shield", "green"), title: "データの整合性チェック" })}
      ${rowButton({ action: "open-trash", leading: iconBox("trash", "gray"), title: "削除した記録", value: `${deleted}件` })}
      ${ctx.store.data.extensions?.synthetic ? rowButton({ action: "clear-demo", leading: iconBox("trash", "red"), title: "サンプルデータを消す", sub: "架空のサンプルを消して空の状態に戻します", chevron: false }) : ""}
    </div>

    <h2 class="list-header">このアプリについて</h2>
    <div class="list">
      <div class="row"><span class="row-main"><span class="row-title">バージョン</span></span><span class="row-value num">${APP_VERSION}</span></div>
      <div class="row"><span class="row-main"><span class="row-title">データ形式</span></span><span class="row-value num">v${SCHEMA_VERSION}</span></div>
      <div class="row"><span class="row-main"><span class="row-title">保存先</span></span><span class="row-value">${ctx.store.storage.name === "localStorage" ? "この端末（ブラウザ）" : ctx.store.storage.name === "memory" ? "一時メモリ（保存されません）" : ctx.store.storage.name}</span></div>
    </div>
  `;
  return { body };
}

export function download(filename: string, text: string, type: string): boolean {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

registerActions({
  "set-theme": (ctx, el) => void ctx.safely(() => ctx.store.updateSettings({ theme: el.dataset.value as "system" })),
  "set-glass": (ctx, el) => void ctx.safely(() => ctx.store.updateSettings({ glass: el.dataset.value as "standard" })),
  "set-weekstart": (ctx, el) => void ctx.safely(() => ctx.store.updateSettings({ weekStartsOn: Number(el.dataset.value) as 0 | 1 })),
  "toggle-refraction": (ctx) => void ctx.safely(() => ctx.store.updateSettings({ refraction: ctx.store.data.settings.refraction === false })),
  "goal-step": (ctx, el) => {
    const next = Math.min(16 * 3600, Math.max(0, ctx.store.data.settings.dailyGoalSec + Number(el.dataset.step)));
    ctx.safely(() => ctx.store.updateSettings({ dailyGoalSec: next }));
  },
  export: async (ctx, el) => {
    const ds = ctx.store.data;
    const stamp = today();
    const f = el.dataset.format;
    const [name, text, type] =
      f === "json" ? [`study-tracker-export-${stamp}.json`, toJSON(ds), "application/json"]
      : f === "csv" ? [`study-tracker-export-${stamp}.csv`, toCSV(ds), "text/csv;charset=utf-8"]
      : [`study-tracker-export-${stamp}.md`, toMarkdown(ds), "text/markdown;charset=utf-8"];
    const dl = await capability<DownloadsCap>("downloads");
    if (dl) {
      try {
        await dl.save({ filename: name, data: new Blob([text], { type }) });
        return;
      } catch {
        /* declined or unavailable: fall through to clipboard */
      }
      if (await copyText(text)) ctx.toast("保存できなかったため、クリップボードにコピーしました");
      return;
    }
    if (download(name, text, type)) ctx.toast(`${name} を書き出しました`, { label: "コピー", run: async () => ctx.toast((await copyText(text)) ? "クリップボードにコピーしました" : "コピーできませんでした") });
    else if (await copyText(text)) ctx.toast("ダウンロードできないため、クリップボードにコピーしました");
    else ctx.toast("書き出しに失敗しました");
  },
  "copy-ai-report": async (ctx) => {
    ctx.toast((await copyText(toMarkdown(ctx.store.data))) ? "AI用レポートをコピーしました。AIとの会話に貼り付けてください" : "コピーできませんでした。Markdownの書き出しを使ってください");
  },
  "import-file": async (ctx, el) => {
    const input = el as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text();
    let payload: unknown;
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const { records, issues } = recordsFromCSV(text);
        if (issues.length && !(await ctx.confirm({ title: `CSVに${issues.length}件の問題があります`, message: `例: ${issues[0].message}。読み込める記録だけを追加しますか？`, ok: "追加する" }))) return;
        payload = { records };
      } else payload = JSON.parse(text);
    } catch (e) {
      ctx.toast(`読み込めませんでした: ${(e as Error).message}`);
      return;
    }
    if (!(await ctx.confirm({ title: `${file.name} を読み込みますか？`, message: "今のデータを自動でバックアップしてから追加します。既存の記録は削除されません。", ok: "読み込む" }))) return;
    try {
      const r = await ctx.store.importDataset(payload);
      ctx.toast(`追加 ${r.added}件 · 更新 ${r.updated}件 · 変更なし ${r.skipped}件${r.issues.length ? ` · 注意 ${r.issues.length}件` : ""}`);
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  },
  "clear-demo": async (ctx) => {
    if (!ctx.store.data.extensions?.synthetic) return;
    if (!(await ctx.confirm({ title: "サンプルデータを消しますか？", message: "サンプルを読み込んだ後に追加した記録も消えます。消す前の状態はバックアップに残ります。", ok: "消す", destructive: true }))) return;
    await ctx.store.replaceDataset(emptyDataset(), "サンプル削除前のバックアップ");
    ctx.toast("サンプルデータを消しました");
  },
  "open-integrity": (ctx) => ctx.openSheet("integrity"),
  "open-trash": (ctx) => ctx.openSheet("trash"),
  "open-ai-info": (ctx) => ctx.openSheet("ai-info"),
});
