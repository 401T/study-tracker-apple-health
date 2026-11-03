# DATA_SCHEMA — データモデル定義（schemaVersion 1）

型定義の正本: `src/data/schema.ts`。機械可読版: `docs/schema/study-dataset.schema.json`（JSON Schema 2020-12）。
合成サンプル: `fixtures/synthetic-data/dataset.json`（架空データ）。

> **重要**: これは本リポジトリの「正準（canonical）スキーマ」です。**Muse 内の既存アーティファクトの実際のスキーマではありません。** 既存データのスキーマは本リポジトリの作成時点で参照できていません。既存データとの対応付けは `docs/MUSE_MIGRATION.md` の手順で、Muse 側が実データを調査してから行います。

## 共通規約

| 規約 | 内容 |
|---|---|
| 時間の単位 | **整数の秒**。フィールド名は `…Sec` で終わる |
| 日付 | `"YYYY-MM-DD"`（記録の `timezone` における暦日） |
| 日時 | ISO 8601 **オフセット付き**（例 `"2026-11-03T09:00:00+09:00"`） |
| ID | 文字列。既存 ID は**決して再生成しない**。数値 ID は文字列化し、`extra.__idType = "number"` で元の型を記憶 |
| 未知フィールド | 読み込み時に `extra`（要素単位）/ `extensions`（トップレベル）へ**そのまま退避**し、保存・書き出しでも保持 |
| 不正値 | 既定値で補うが、元の値は `extra.__invalid.<field>` に保持し、`issues` として報告 |
| 削除 | ソフトデリート（`deletedAt`）。集計からは除外、データは残る |

## StudyDataset（ルート）

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `schema` | `"study-tracker-apple-health"` | ✓ | 形式の識別子 |
| `schemaVersion` | `1` | ✓ | スキーマ版 |
| `meta` | DatasetMeta | ✓ | 作成・更新日時、最終書き込み端末のタイムゾーン、移行元情報 |
| `settings` | Settings | ✓ | 設定 |
| `subjects` | Subject[] | ✓ | 科目 |
| `tasks` | Task[] | ✓ | タスク |
| `records` | StudyRecord[] | ✓ | **実績**の勉強記録 |
| `plans` | StudyPlan[] | ✓ | **計画**値 |
| `activeSession` | ActiveSession \| null | ✓ | 計測中タイマー（再読込で失われないよう保存） |
| `extensions` | object | 任意 | 未知のトップレベルフィールド |

### DatasetMeta
| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `createdAt` / `updatedAt` | ISO 日時 | ✓ | データセット全体の作成・最終更新 |
| `timezone` | IANA（例 `Asia/Tokyo`） | ✓ | 最後に書き込んだ端末のタイムゾーン |
| `legacy` | `{ format, importedAt, fingerprint }` | 任意 | 既存形式から変換した場合の出典 |

## StudyRecord（勉強記録・実績）

| フィールド | 型 | 単位 | 必須 | 意味 |
|---|---|---|---|---|
| `id` | string | — | ✓ | 一意な記録 ID |
| `date` | `YYYY-MM-DD` | — | ✓ | 学習した日（開始時刻の暦日。日付をまたぐ場合も開始日） |
| `timezone` | IANA | — | ✓ | 記録時のタイムゾーン |
| `startAt` | ISO 日時 \| null | — | ✓ | 開始時刻。不明（手入力で時刻なし）なら null |
| `endAt` | ISO 日時 \| null | — | ✓ | 終了時刻。不明なら null |
| `durationSec` | integer ≥0 | 秒 | ✓ | **実勉強時間（休憩を除く）。すべての集計はこの値を使う** |
| `elapsedSec` | integer ≥0 \| null | 秒 | ✓ | **経過時間（休憩を含む壁時計時間）** = endAt − startAt。不明なら null |
| `breakSec` | integer ≥0 | 秒 | ✓ | 休憩・一時停止の合計 |
| `subjectId` | string \| null | — | ✓ | 科目 ID。null = 科目なし |
| `taskId` | string \| null | — | ✓ | タスク ID |
| `note` | string | — | ✓ | 学習内容（ユーザーが書いた自由記述） |
| `source` | `"timer"`\|`"manual"`\|`"import"`\|`"legacy"`\|`"agent"` | — | ✓ | 記録の出典（下表） |
| `createdAt` / `updatedAt` | ISO 日時 | — | ✓ | 作成・更新日時 |
| `deletedAt` | ISO 日時 \| null | — | ✓ | ソフトデリート日時 |
| `extra` | object | — | 任意 | 未知フィールド・移行元の原本（`__legacy`）など |

**不変条件**: `elapsedSec !== null` のとき `durationSec === elapsedSec - breakSec`。（正規化時に検査し、違反は issue として報告。値は書き換えない）

**`source` の意味**

| 値 | 意味 | AI の扱い |
|---|---|---|
| `timer` | アプリのタイマーで計測 | 実測値（ただし `extra.editedAfterMeasurement === true` なら後から手で修正済み） |
| `manual` | ユーザーが手入力 | 自己申告値 |
| `import` | ファイルから読み込み | 出典不明の値 |
| `legacy` | 既存形式から移行 | 移行元の値 |
| `agent` | AI の提案をユーザーが承認して追加 | ユーザー承認済みの提案値 |

### タイマーの経過時間と実勉強時間の区別（重要）
```
開始 09:00 ─────── 休憩 09:30〜09:40 ─────── 終了 10:00
elapsedSec = 3600（1時間：休憩込み）
breakSec   =  600（10分）
durationSec= 3000（50分：これが「勉強時間」）
```

## Subject（科目）
| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `id` | string | ✓ | 科目 ID |
| `name` | string | ✓ | 科目名 |
| `color` | `blue`…`brown` | ✓ | 表示色名（実色はデザイントークン） |
| `weeklyGoalSec` | integer \| null | ✓ | 週の目標時間（秒）。**計画値** |
| `archived` | boolean | ✓ | アーカイブ（記録は残る） |
| `order` | number | ✓ | 並び順 |
| `createdAt` / `updatedAt` | ISO 日時 | ✓ | — |
| `extra` | object | 任意 | — |

## Task（タスク）
| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `id` | string | ✓ | — |
| `subjectId` | string \| null | ✓ | 所属科目 |
| `title` | string | ✓ | タスク名 |
| `status` | `"open"` \| `"done"` | ✓ | — |
| `dueDate` | `YYYY-MM-DD` \| null | ✓ | 期限 |
| `note` | string | ✓ | — |
| `createdAt` / `updatedAt` | ISO 日時 | ✓ | — |

## StudyPlan（計画）
| フィールド | 型 | 単位 | 必須 | 意味 |
|---|---|---|---|---|
| `id` | string | — | ✓ | — |
| `periodStart` / `periodEnd` | `YYYY-MM-DD` | — | ✓ | 計画期間（両端含む） |
| `subjectId` | string \| null | — | ✓ | null = 全科目合計の計画 |
| `plannedSec` | integer ≥0 | 秒 | ✓ | 計画時間 |
| `note` | string | — | ✓ | — |

**計画値（plans, weeklyGoalSec, dailyGoalSec）と実績値（records）は別エンティティ**。実績側に計画値を書かない。

## Settings
| フィールド | 型 | 既定 | 意味 |
|---|---|---|---|
| `theme` | `system`\|`light`\|`dark` | `system` | 外観 |
| `glass` | `standard`\|`reduced` | `standard` | ガラス効果（reduced = 不透明） |
| `refraction` | boolean | `true` | Liquid Glass の屈折（v1 の追加項目。無い場合は true として読む） |
| `dailyGoalSec` | integer | 10800（3時間） | 1日の目標（計画値） |
| `weekStartsOn` | `0`\|`1` | `1`（月曜） | 週の始まり |

## ActiveSession（計測中タイマー）
| フィールド | 型 | 意味 |
|---|---|---|
| `startedAt` | ISO 日時 | 開始 |
| `subjectId` / `taskId` | string \| null | — |
| `note` | string | — |
| `breaks` | `{ start, end \| null }[]` | 一時停止区間。`end: null` = 一時停止中 |

## 保存方式（現在の実装）

| キー（localStorage） | 内容 |
|---|---|
| `sah:v1:dataset` | StudyDataset 全体（JSON） |
| `sah:v1:backup:<ISO>#<rand>` | `{ label, createdAt, data }`（最新20件を保持。プルーニングは**このプレフィックスのみ**） |

アプリは自分のキー以外を**読まない・消さない**。保存方式は `StorageAdapter` インターフェースで差し替え可能（`src/adapters/storage.ts`）。

## 書き出し形式

| 形式 | 内容 | 欠落 |
|---|---|---|
| JSON | StudyDataset 全体 | なし（往復テスト済み） |
| CSV | 記録1行1件。列: `id,date,start_at,end_at,duration_sec,duration_min,elapsed_sec,break_sec,subject_id,subject_name,task_id,task_title,note,source,timezone,created_at,updated_at,deleted_at,extra_json`。UTF-8 BOM、RFC 4180 | 記録については欠落なし（`extra_json` 列で保持、往復テスト済み）。科目・タスク・計画・設定は含まない |
| Markdown | AI 向けレポート（集計値＋明細） | 人間/AI 読み取り用。再取り込みは非対応 |

## インポートの規則
- JSON / CSV を**マージ**。既存記録は削除しない。
- 同じ `id` は `updatedAt` が新しい方を採用。新しい `id` は追加。
- 取り込み前に自動バックアップ。
