# AI_DATA_GUIDE — AIエージェントのための学習記録ガイド

この文書は、Muse の AI エージェント（または他の AI）が、このアプリに記録された勉強時間と学習内容を**正確に読み取り、根拠を示して分析する**ための説明書です。行動規則は `AGENT_INSTRUCTIONS.md` を参照してください。

## 1. データの取得方法（優先順）

Muse がアーティファクトのデータを読む公式な手段（API / MCP / コネクタ）は、本リポジトリ作成時点の公開情報では**確認できませんでした**。そのため、特定の連携方式に依存しない3つの経路を用意しています。使える経路を上から順に試してください。

| # | 経路 | 使い方 | 前提 |
|---|---|---|---|
| A | 読み取り API | ページ内で `window.studyTracker.<関数>()` を実行 | エージェントがページ上で JavaScript を実行できる |
| B | DOM スナップショット | `<script type="application/json" id="study-tracker-snapshot">` の中身を JSON として読む（データ変更のたびに更新） | エージェントがページの HTML / DOM を読める |
| C | 書き出しファイル | 設定 → データ → JSON / CSV / Markdown、または 設定 → AIエージェント連携 → 「AI用レポートをコピー」をユーザーが会話に貼る | 常に使える（ユーザー操作が必要） |

> Muse 側で上記以外の読み取り手段（アーティファクトの保存データを直接読む機能など）が実際に存在する場合は、それを使って `sah:v1:dataset`（または Muse の保存先）を読み、本ガイドのスキーマで解釈してください。存在を確認できない機能を「使える」と仮定しないでください。

## 2. 読み取り API（経路 A）

すべて**読み取り専用・ディープコピー**を返します。集計系は `{ data, basis }` を返し、`basis` に計算方法・範囲・根拠の記録 ID 一覧が入ります。

| 関数 | 返り値 |
|---|---|
| `describe()` | 単位・用語の要約 |
| `getStudyRecords()` | 削除済みを除く全記録 |
| `getStudyRecordsByDateRange(start, end)` | 期間内の記録（日付は `YYYY-MM-DD`、両端含む） |
| `getSubjects()` / `getTasks()` / `getStudyPlans()` / `getSettings()` | 科目 / タスク / 計画 / 設定 |
| `getStudyTimeBySubject(start?, end?)` | 科目別合計と割合 |
| `getDailyStudySummary(date?)` | 1日の合計・目標比・科目別・記録 |
| `getWeeklyStudySummary(start?, end?)` | 期間集計（既定: 今週） |
| `getMonthlyStudySummary(start?, end?)` | 期間集計（既定: 今月1日〜今日） |
| `getStudyTrends(weeks = 8)` | 週別合計と最小二乗の傾き、科目別増減（直近14日 vs 前14日）、連続日数 |
| `getPlanVsActual(start?, end?)` | 計画ごとの実績・達成率・進行中か |
| `getIntegrity()` | 件数・合計・科目別・ハッシュ |
| `exportJSON()` / `exportCSV()` / `exportMarkdown(start?, end?)` | 書き出し文字列 |
| `proposeChange(change)` | **変更の提案のみ**（後述） |

例:
```js
const w = window.studyTracker.getWeeklyStudySummary("2026-10-26", "2026-11-01");
w.data.totalSec        // 期間合計（秒）
w.data.bySubject       // [{ subjectId, name, sec, share, recordCount }]
w.basis.recordIds      // 根拠となった記録 ID
```

## 3. 用語と単位（必ず守る）

| 用語 | フィールド | 説明 |
|---|---|---|
| 勉強時間 | `durationSec` | **休憩を除いた実勉強時間**。すべての合計・平均はこれ |
| 経過時間 | `elapsedSec` | 開始〜終了の壁時計時間（休憩込み）。不明なら null。**勉強時間として使わない** |
| 休憩 | `breakSec` | 一時停止の合計 |
| 実績 | `records` | 実際に勉強した記録 |
| 計画 | `plans`, `subjects[].weeklyGoalSec`, `settings.dailyGoalSec` | 予定・目標値。実績ではない |
| 実測値 | `source: "timer"` かつ `extra.editedAfterMeasurement` が無い | タイマー計測 |
| 自己申告値 | `source: "manual"` | 手入力 |
| 移行値 | `source: "legacy"` | 移行前データ |
| 計算値 | API の集計結果・Markdown の「集計値」 | 記録から計算。測定値ではない |
| 削除済み | `deletedAt` が非 null | 集計から除外。分析に使わない |

時間はすべて**秒**です。人に示すときは「◯時間◯分」に変換してください（例: 8100 秒 → 2時間15分）。

## 4. 分析できること・できないこと

| 問い | 使うデータ | 可否 |
|---|---|---|
| 直近7日の推移 | `getStudyRecordsByDateRange` または Markdown「直近7日の日別」 | ✓ |
| 科目ごとの割合 | `getStudyTimeBySubject` | ✓ |
| 特定科目が減っていないか | `getStudyTrends().subjectChanges` | ✓（期間の取り方を明示） |
| 計画と実績の乖離 | `getPlanVsActual` | ✓（計画が登録されている期間のみ） |
| どの科目に時間を配分すべきか | 配分＋週目標＋計画 | △ 提案は可能。ただし「目標・試験日・苦手度」など記録に無い情報は**ユーザーに確認**する |
| 時間帯の傾向 | `startAt`（null の記録は除外と明記） | △ |
| 学習内容に対する時間配分の適切さ | `note`（自由記述）＋時間 | △ 記述から読み取れる範囲に限る |
| 理解度・学力・成績 | — | **✗ 記録されていない。断定しない** |
| 集中度 | — | **✗ 記録されていない** |

## 5. 解釈上の注意

- **記録のない日は 0 分**として集計されています。「勉強しなかった」のか「記録しなかった」のかは区別できません。
- 進行中の期間（今週・今月）は途中の値です。前の期間と比べる場合は**同じ日数どうし**で比較してください（API の `compareToPrevious` 相当。サマリー画面もこの方式）。
- `weeklyTrend` の傾きは**完了した週のみ**で計算しています（今週は除外）。
- `subjectName` が「不明な科目 (id)」になる記録は、科目が削除されたか移行時に対応が取れなかったものです。勝手に別の科目に割り当てないでください。
- 日付は記録の `timezone` における暦日です。日付をまたぐ記録は開始日に計上されます。

## 6. 分析結果の示し方（推奨フォーマット）

```
【事実（記録から計算）】
- 直近7日（10/28〜11/3）の勉強時間は合計13時間（1日平均1時間51分）。
  その前の7日（10/21〜10/27）は19時間25分で、6時間25分（−33%）減少。
  根拠: 記録 rec_… ほか 23件
【解釈（AIの推測）】
- 英語が直近14日で6時間35分減っており、減少分の大半を占めています。
【提案】
- …（前提: 試験日や優先度はユーザー未入力のため仮定せず、確認したい点を列挙）
```

## 7. 書き込み（提案）について

AI は記録を直接書き換えません。追加・修正・計画設定は `proposeChange()` で**提案**し、ユーザーがアプリ内で「承認」した場合だけ反映されます（反映された記録は `source: "agent"`）。

```js
window.studyTracker.proposeChange({
  kind: "setPlan", periodStart: "2026-11-09", periodEnd: "2026-11-15",
  subjectId: "sub_…", plannedSec: 5 * 3600,
  reason: "英語が2週連続で減少しているため、来週は5時間を計画として提案",
});
```
`kind` は `addRecord` / `updateRecord` / `setPlan`。`reason` は必須。提案はページを再読み込みすると消えます（保存されません）。
