/**
 * Markdown report for AI agents. Designed to be pasted into (or read by) an LLM:
 * it states units, separates MEASURED / USER-ENTERED values from COMPUTED ones,
 * and lists every record so claims can be traced back to record ids.
 */

import type { StudyDataset } from "../data/schema";
import {
  bySubject, planVsActual, recordsInRange, streak, subjectChanges, subjectName, summarizePeriod, weeklyTrend,
} from "../analytics";
import { addDays, today } from "../data/time";
import { fmtDuration } from "../analytics/format";

const SOURCE_LABEL: Record<string, string> = {
  timer: "実測(タイマー)",
  manual: "手入力",
  import: "インポート",
  legacy: "旧データ",
  agent: "AI提案(承認済み)",
};

const min = (sec: number) => (Math.round((sec / 60) * 10) / 10).toString();
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ⏎ ");

export interface ReportOptions {
  /** Inclusive range of records to list. Defaults to the last 90 days. */
  start?: string;
  end?: string;
  asOf?: string;
}

export function toMarkdown(ds: StudyDataset, opts: ReportOptions = {}): string {
  const asOf = opts.asOf ?? today();
  const end = opts.end ?? asOf;
  const start = opts.start ?? addDays(end, -89);
  const recs = recordsInRange(ds, start, end);
  const all = ds.records.filter((r) => !r.deletedAt);
  const last7 = summarizePeriod(ds, addDays(asOf, -6), asOf, asOf);
  const prev7 = summarizePeriod(ds, addDays(asOf, -13), addDays(asOf, -7), asOf);
  const last30 = summarizePeriod(ds, addDays(asOf, -29), asOf, asOf);
  const trend = weeklyTrend(ds, 8, asOf);
  const st = streak(ds, asOf);
  const changes = subjectChanges(ds, 14, asOf);
  const plans = planVsActual(ds, addDays(asOf, -56), addDays(asOf, 28), asOf);
  const taskTitle = new Map(ds.tasks.map((t) => [t.id, t.title]));

  const L: string[] = [];
  L.push(`# 学習記録レポート（AIエージェント向け）`);
  L.push("");
  L.push(`- 生成日: ${asOf}（タイムゾーン: ${ds.meta.timezone}）`);
  L.push(`- データ形式: ${ds.schema} v${ds.schemaVersion}`);
  L.push(`- 記録総数: ${all.length} 件（削除済みを除く）／本レポートの明細範囲: ${start} 〜 ${end}（${recs.length} 件）`);
  L.push(`- 1日の目標: ${fmtDuration(ds.settings.dailyGoalSec)}（${min(ds.settings.dailyGoalSec)} 分）`);
  L.push("");
  L.push(`## 読み方`);
  L.push(`- 時間の単位はすべて **分**（小数第1位）。表示用の「◯時間◯分」も併記する。`);
  L.push(`- 「勉強時間」は休憩を除いた実勉強時間（durationSec）。タイマーの経過時間（elapsed）とは異なる。`);
  L.push(`- 出典: 実測(タイマー)=アプリのタイマーで計測、手入力=ユーザーが入力した値、旧データ=移行前の保存データ。`);
  L.push(`- 「集計値」はすべて下の明細から計算した値であり、測定値ではない。理解度・学力は記録されていない。`);
  L.push(`- 記録のない日は 0 分として集計している（記録漏れか未学習かは区別できない）。`);
  L.push("");
  L.push(`## 集計値（計算値）`);
  L.push(`| 指標 | 値 |`);
  L.push(`|---|---|`);
  L.push(`| 直近7日 合計 (${last7.start}〜${last7.end}) | ${min(last7.totalSec)} 分（${fmtDuration(last7.totalSec)}） |`);
  L.push(`| その前の7日 合計 (${prev7.start}〜${prev7.end}) | ${min(prev7.totalSec)} 分（${fmtDuration(prev7.totalSec)}） |`);
  L.push(`| 直近7日 1日平均 | ${min(last7.avgPerDaySec)} 分 |`);
  L.push(`| 直近7日 目標達成日数 | ${last7.daysGoalMet} / ${last7.days} 日 |`);
  L.push(`| 直近30日 合計 | ${min(last30.totalSec)} 分（${fmtDuration(last30.totalSec)}） |`);
  L.push(`| 直近30日 学習した日数 | ${last30.activeDays} / ${last30.days} 日 |`);
  L.push(`| 連続学習日数（現在／最長） | ${st.current} 日 ／ ${st.longest} 日 |`);
  L.push(`| 週あたりの増減傾向 | ${{ up: "増加", down: "減少", flat: "横ばい" }[trend.direction]}（${min(trend.slopeSecPerWeek)} 分/週; ${trend.method}） |`);
  L.push("");
  L.push(`### 直近7日の日別（分）`);
  L.push(`| 日付 | 勉強時間(分) |`);
  L.push(`|---|---|`);
  for (const d of last7.daily) L.push(`| ${d.date} | ${min(d.sec)} |`);
  L.push("");
  L.push(`### 直近8週の週別（分）`);
  L.push(`| 週の開始日 | 勉強時間(分) |`);
  L.push(`|---|---|`);
  for (const w of trend.weeks) L.push(`| ${w.start}${w.end >= asOf ? "（進行中）" : ""} | ${min(w.sec)} |`);
  L.push("");
  L.push(`### 科目別 配分（直近30日）`);
  L.push(`| 科目 | 分 | 割合 | 記録数 |`);
  L.push(`|---|---|---|---|`);
  for (const s of bySubject(ds, last30.start, last30.end))
    L.push(`| ${esc(s.name)} | ${min(s.sec)} | ${Math.round(s.share * 1000) / 10}% | ${s.recordCount} |`);
  L.push("");
  L.push(`### 科目別 増減（直近14日 vs その前の14日、昨日まで）`);
  L.push(`| 科目 | 直近(分) | 前期間(分) | 差(分) |`);
  L.push(`|---|---|---|---|`);
  for (const c of changes) L.push(`| ${esc(c.name)} | ${min(c.recentSec)} | ${min(c.previousSec)} | ${min(c.deltaSec)} |`);
  L.push("");
  L.push(`## 計画と実績`);
  if (!plans.length) L.push(`計画データはありません（計画との比較はできません）。`);
  else {
    L.push(`| 期間 | 対象 | 計画(分) | 実績(分) | 達成率 | 状態 |`);
    L.push(`|---|---|---|---|---|---|`);
    for (const p of plans)
      L.push(`| ${p.periodStart}〜${p.periodEnd} | ${esc(p.name)} | ${min(p.plannedSec)} | ${min(p.actualSec)} | ${p.ratio === null ? "—" : Math.round(p.ratio * 100) + "%"} | ${p.inProgress ? "進行中" : "終了"} |`);
  }
  L.push("");
  L.push(`## 科目`);
  L.push(`| subject_id | 科目名 | 週目標(分) | アーカイブ |`);
  L.push(`|---|---|---|---|`);
  for (const s of ds.subjects) L.push(`| ${s.id} | ${esc(s.name)} | ${s.weeklyGoalSec === null ? "—" : min(s.weeklyGoalSec)} | ${s.archived ? "はい" : "いいえ"} |`);
  L.push("");
  L.push(`## タスク`);
  if (!ds.tasks.length) L.push(`タスクはありません。`);
  else {
    L.push(`| task_id | タスク | 科目 | 状態 |`);
    L.push(`|---|---|---|---|`);
    for (const t of ds.tasks) L.push(`| ${t.id} | ${esc(t.title)} | ${esc(subjectName(ds, t.subjectId))} | ${t.status === "done" ? "完了" : "未完了"} |`);
  }
  L.push("");
  L.push(`## 記録明細（${start}〜${end}）`);
  L.push(`| record_id | 日付 | 開始 | 終了 | 勉強(分) | 休憩(分) | 科目 | タスク | 出典 | 学習内容 |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of recs)
    L.push(
      `| ${r.id} | ${r.date} | ${r.startAt ?? "—"} | ${r.endAt ?? "—"} | ${min(r.durationSec)} | ${min(r.breakSec)} | ${esc(subjectName(ds, r.subjectId))} | ${r.taskId ? esc(taskTitle.get(r.taskId) ?? r.taskId) : "—"} | ${SOURCE_LABEL[r.source] ?? r.source} | ${esc(r.note) || "—"} |`,
    );
  L.push("");
  return L.join("\n");
}
