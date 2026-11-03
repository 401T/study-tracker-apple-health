/** Sheets: AI proposals (approval gate), AI data info, backups, integrity, deleted records. */

import { html, raw } from "../components/html";
import { icon } from "../design-system/icons";
import { fmtDuration } from "../analytics/format";
import { subjectName } from "../analytics";
import { fingerprint } from "../data/integrity";
import { applyProposal, AGENT_API_VERSION } from "../adapters/agent-api";
import type { BackupInfo } from "../adapters/storage";
import { registerActions, registerSheets } from "../app/context";
import { recordRow } from "./summary";

let backups: BackupInfo[] = [];

registerSheets({
  proposals(ctx) {
    const ds = ctx.store.data;
    const list = ctx.ui.proposals;
    return {
      title: "AIからの提案",
      body: html`
        <div class="banner">${raw(icon("shield"))}<div>AIエージェントが提案した変更です。<strong>承認するまで記録は変わりません。</strong>内容を確認してから承認してください。</div></div>
        ${list.length === 0 ? html`<p class="muted">保留中の提案はありません。</p>` : list.map((p) => {
          const c = p.change;
          let what = "";
          if (c.kind === "addRecord") what = `記録を追加: ${c.record.date} · ${subjectName(ds, c.record.subjectId)} · ${fmtDuration(c.record.durationSec)}${c.record.note ? ` · ${c.record.note}` : ""}`;
          else if (c.kind === "updateRecord") {
            const r = ds.records.find((x) => x.id === c.id);
            what = `記録を変更: ${c.id}${r ? `（${r.date} ${subjectName(ds, r.subjectId)}）` : "（存在しない記録）"} → ${Object.entries(c.patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`;
          } else what = `計画を設定: ${c.periodStart}〜${c.periodEnd} · ${c.subjectId ? subjectName(ds, c.subjectId) : "全体"} · ${fmtDuration(c.plannedSec)}`;
          return html`<div class="card" style="margin-bottom:12px">
            <p class="card-title">${what}</p>
            <p class="card-text">理由: ${c.reason}</p>
            <p class="card-footer">提案日時 ${new Date(p.proposedAt).toLocaleString("ja-JP")}</p>
            <div class="btn-row" style="margin-top:12px">
              <button type="button" class="btn small" data-action="reject-proposal" data-id="${p.id}">却下</button>
              <button type="button" class="btn small primary" data-action="approve-proposal" data-id="${p.id}">承認</button>
            </div></div>`;
        })}`,
    };
  },

  "ai-info"(ctx) {
    const fp = fingerprint(ctx.store.data);
    return {
      title: "AIが読めるデータ",
      body: html`
        <p class="card-text" style="margin:0 4px 12px">このアプリは、AIエージェントが学習記録を正確に読み取れるよう、次の3つの方法でデータを提供します。</p>
        <div class="list">
          <div class="row has-icon"><span class="row-icon" style="--cat:var(--subject-indigo)">${raw(icon("sparkles"))}</span><span class="row-main"><span class="row-title">読み取りAPI</span><span class="row-sub">window.studyTracker（v${AGENT_API_VERSION}）</span></span></div>
          <div class="row has-icon"><span class="row-icon" style="--cat:var(--subject-blue)">${raw(icon("note"))}</span><span class="row-main"><span class="row-title">ページ内スナップショット</span><span class="row-sub">#study-tracker-snapshot（JSON）</span></span></div>
          <div class="row has-icon"><span class="row-icon" style="--cat:var(--subject-green)">${raw(icon("download"))}</span><span class="row-main"><span class="row-title">書き出し</span><span class="row-sub">JSON / CSV / Markdown</span></span></div>
        </div>
        <h3 class="list-header">AIが守るルール</h3>
        <div class="list"><div class="note-block">・時間の単位は秒。勉強時間は休憩を除いた値（経過時間とは別）
・タイマーの値は「実測」、手入力は「手入力」と区別
・集計は計算値として、根拠の記録IDとともに示す
・勉強時間から理解度や学力を断定しない
・存在しないデータを作らない
・記録の変更は提案のみ。あなたの承認なしに書き換えない</div></div>
        <h3 class="list-header">現在のデータ</h3>
        <div class="list">
          <div class="row"><span class="row-main"><span class="row-title">記録</span></span><span class="row-value num">${fp.activeRecordCount}件</span></div>
          <div class="row"><span class="row-main"><span class="row-title">合計勉強時間</span></span><span class="row-value num">${fmtDuration(fp.totalDurationSec)}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">期間</span></span><span class="row-value num">${fp.firstDate ?? "—"} 〜 ${fp.lastDate ?? "—"}</span></div>
        </div>
        <div class="spacer"></div>
        <button type="button" class="btn block primary" data-action="copy-ai-report">${raw(icon("copy"))}AI用レポートをコピー</button>`,
    };
  },

  backups(ctx) {
    return {
      title: "バックアップ",
      body: html`
        <p class="card-text" style="margin:0 4px 12px">インポート・復元・サンプル読込の前と、毎日最初の保存時に自動で作成されます（最新20件を保持）。</p>
        ${backups.length === 0 ? html`<p class="muted">バックアップはまだありません。</p>` : html`<div class="list">${backups.map((b) => html`<button type="button" class="row" data-action="restore-backup" data-id="${b.id}">
          <span class="row-main"><span class="row-title">${b.label}</span><span class="row-sub">${new Date(b.createdAt).toLocaleString("ja-JP")} · ${(b.bytes / 1024).toFixed(1)} KB</span></span>
          <span class="row-value" style="color:var(--color-accent-strong)">復元</span></button>`)}</div>`}
        <p class="list-footer">復元すると、現在のデータもバックアップしてから置き換えます。端末外への保存には「JSONで書き出す」を使ってください。</p>
        <p class="list-footer">保存先: ${ctx.store.storage.name}</p>`,
    };
  },

  integrity(ctx) {
    const fp = fingerprint(ctx.store.data);
    const issues = ctx.store.issues;
    return {
      title: "整合性チェック",
      body: html`
        <p class="card-text" style="margin:0 4px 12px">移行や読み込みの前後でこの値を比較すると、記録の欠落や変化を確認できます。</p>
        <div class="list">
          <div class="row"><span class="row-main"><span class="row-title">記録数（削除済み含む）</span></span><span class="row-value num">${fp.recordCount}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">有効な記録数</span></span><span class="row-value num">${fp.activeRecordCount}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">合計（秒）</span></span><span class="row-value num">${fp.totalDurationSec}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">科目 / タスク / 計画</span></span><span class="row-value num">${fp.subjectCount} / ${fp.taskCount} / ${fp.planCount}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">期間</span></span><span class="row-value num">${fp.firstDate ?? "—"} 〜 ${fp.lastDate ?? "—"}</span></div>
          <div class="row"><span class="row-main"><span class="row-title">記録ハッシュ</span></span><span class="row-value num">${fp.recordsHash}</span></div>
        </div>
        <h3 class="list-header">科目別合計（秒）</h3>
        <div class="list">${Object.entries(fp.bySubjectSec).map(([k, v]) => html`<div class="row"><span class="row-main"><span class="row-title">${k === "(none)" ? "科目なし" : subjectName(ctx.store.data, k)}</span><span class="row-sub">${k}</span></span><span class="row-value num">${v}</span></div>`)}</div>
        <h3 class="list-header">読み込み時の注意（${issues.length}件）</h3>
        ${issues.length ? html`<div class="code">${issues.slice(0, 50).map((i) => `${i.path}: ${i.message}\n`).join("")}</div>` : html`<p class="muted" style="margin:0 16px">問題は見つかりませんでした。</p>`}
        <div class="spacer"></div>
        <button type="button" class="btn block" data-action="copy-integrity">${raw(icon("copy"))}JSONでコピー</button>`,
    };
  },

  trash(ctx) {
    const ds = ctx.store.data;
    const list = ds.records.filter((r) => r.deletedAt).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
    return {
      title: "削除した記録",
      live: true,
      body: html`<p class="card-text" style="margin:0 4px 12px">削除した記録は集計に含まれませんが、データとして保持されています。タップして元に戻せます。</p>
        ${list.length ? html`<div class="list">${list.map((r) => recordRow(ds, r, true))}</div>` : html`<p class="muted">削除した記録はありません。</p>`}`,
    };
  },
});

registerActions({
  "approve-proposal": (ctx, el) => {
    const i = ctx.ui.proposals.findIndex((p) => p.id === el.dataset.id);
    if (i < 0) return;
    const p = ctx.ui.proposals[i];
    if (!ctx.safely(() => applyProposal(ctx.store, p))) return;
    ctx.ui.proposals.splice(i, 1);
    ctx.rerenderSheet();
    ctx.rerender();
    ctx.toast("提案を反映しました");
  },
  "reject-proposal": (ctx, el) => {
    ctx.ui.proposals = ctx.ui.proposals.filter((p) => p.id !== el.dataset.id);
    ctx.rerenderSheet();
    ctx.rerender();
  },
  "open-backups": async (ctx) => {
    backups = await ctx.store.listBackups();
    ctx.openSheet("backups");
  },
  "restore-backup": async (ctx, el) => {
    if (!confirm("このバックアップを復元しますか？ 現在のデータは復元前に自動でバックアップされます。")) return;
    await ctx.store.restoreBackup(el.dataset.id!);
    backups = await ctx.store.listBackups();
    ctx.rerenderSheet();
    ctx.toast("バックアップを復元しました");
  },
  "copy-integrity": async (ctx) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(fingerprint(ctx.store.data), null, 2));
      ctx.toast("整合性情報をコピーしました");
    } catch {
      ctx.toast("コピーできませんでした");
    }
  },
});
