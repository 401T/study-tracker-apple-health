# MUSE_MIGRATION — 既存 Muse アーティファクトへの統合手順

## 0. 前提として分かっていること・分かっていないこと

| 項目 | 状況（2026-11-03 時点） |
|---|---|
| 既存アーティファクトのソース・データ | **本リポジトリの作成者は参照できていない**。スキーマも保存方式も未確認 |
| Muse の Build / アーティファクト仕様 | 公開情報（Meta の発表、ヘルプ、第三者レビュー）では、アーティファクトの形式（単一HTML か、フレームワークか）、データ保存方式、データ永続化の挙動、外部スクリプトの可否、既存アーティファクトのその場更新、エージェントによるアーティファクトデータの読み取り方法が**いずれも記載されていなかった** |
| Muse の外部連携 | 公式の Connector Platform（API / MCP ベースのコネクタ、読み取り/書き込み/機微な書き込みの権限区分）は存在する。ただしこれは外部サービス連携の仕組みで、アーティファクト内データへのアクセス方法としての記載は無い |
| Muse の Web 閲覧 | ブラウザを開いて操作できると公式に記載。GitHub リポジトリ（特に Private）を読めるかは**未確認** |

したがって、**以下の手順のうち「調査」は必ず Muse 側のエージェントが実データに対して行い、推測で進めないこと。**

## 1. 統合方針の選択

```
既存データの保存形式を調査
        │
        ├─ 既存形式を変えずに新UIから読み書きできる ──▶ 方針A（推奨）: アダプター方式
        │      （新UIは LegacyMapping 経由で既存データを読み、同じ形式で書き戻す）
        │
        └─ 既存形式では新機能（休憩・計画・タスク等）を保存できない ──▶ 方針B: 追加保存＋移行
               （既存データは一切変更せず残し、新しいキーに正準形式で保存。
                 移行前バックアップ・フィンガープリント照合・ロールバック手段を用意）
```

**方針A を優先**してください。既存データの保存場所・形式が変わらないため、問題が起きても旧 UI に戻せます。

## 2. 手順

### Step 1. 現状の棚卸し（書き込み禁止）
1. 既存アーティファクトのソースを開き、次を記録する:
   - 使用技術（単一 HTML / React / その他）、外部ライブラリ、CSS の書き方
   - **データ保存方式**（localStorage のキー名 / IndexedDB / Muse 提供の保存機能 / その他）
   - データの読み込み・保存を行う関数
   - 画面と機能の一覧（下の表を埋める）
2. 実データを**読み取りのみ**で取得し、構造を記録する（フィールド名、型、単位、例を数件）。
3. **フィンガープリント（変更前）**を記録する: 記録数、合計時間、科目別合計、最初と最後の日付、ID の一覧。

| 既存機能 | 新UIの対応箇所 | 備考 |
|---|---|---|
| （例）タイマー | timer シート | |
| （例）手入力 | record-edit シート | |
| （例）科目管理 | 科目タブ / subject-edit | |
| … | … | 新UIに無い既存機能は**削除せず追加実装**する |

### Step 2. バックアップ
- 実データ全体を JSON として書き出し、ユーザーの手元（ダウンロード、または Muse のファイル保存）に保存する。
- **GitHub にはアップロードしない。**

### Step 3. マッピングの作成（方針A・B共通）
`src/adapters/legacy.ts` の `LegacyMapping` を実データに合わせて記述する。例（**架空の形**です。実データに合わせて書き換えること）:

```ts
const mapping: LegacyMapping = {
  format: "muse-study-tracker (inspected 2026-11-05)",
  paths: { records: "records", subjects: "subjects", settings: "settings" },
  record: {
    id: "id", date: "date", start: "startTime", end: "endTime",
    duration: "minutes", durationUnit: "minutes",       // ← 単位は実データで必ず確認
    breakDuration: "breakMinutes", breakUnit: "minutes",
    subject: "subjectId",                               // 名前で保存されているなら subjectRefIsName: true
    task: "taskId", note: "memo",
  },
  subject: { id: "id", name: "name", color: "color" },
  settings: { dailyGoal: "dailyGoalMinutes", dailyGoalUnit: "minutes" },
};
```

- `importLegacy(raw, mapping)` は**元データを変更しない純関数**です。マッピングに無いフィールドはすべて `extra` に、元のオブジェクトは `extra.__legacy` に残ります。
- 読めない要素（オブジェクトでない記録など）は `extensions.__unreadableRecords` に位置情報付きで残り、書き戻し時に同じ位置へ戻ります。
- 単位が不明なフィールドは推測で変換しない。不明ならユーザーに確認する。
- 既存フィールドに無い意味（例: 「休憩」）を勝手に付与しない。存在しないなら `breakDuration` を指定しない。

### Step 4. 変換結果の検証（書き込み前）
```ts
const { dataset, problems, sourceCounts } = importLegacy(raw, mapping);
// 1) 件数: sourceCounts.records === 元の件数、dataset.records.length + 読めなかった件数 === 元の件数
// 2) 合計: fingerprint(dataset).totalDurationSec === Step1 の合計（秒換算）
// 3) 科目別合計が一致
// 4) 日付: 各記録の date / startAt / endAt が元の値と一致（タイムゾーンずれが無いか）
// 5) ID: 元の ID がすべて残っている
// 6) 往復: exportLegacy(raw, dataset, mapping) が raw と deepEqual（未編集なら完全一致）
```
1〜6 のどれかが不一致なら**統合を中止**し、マッピングを修正する。`problems` は全件ユーザーに報告する。

### Step 5. 保存アダプターの実装
- 方針A: 既存の保存先を読む/書く `StorageAdapter` を実装する。`load()` は既存データを読み `importLegacy` で正準形式に、`save()` は `exportLegacy` で既存形式へ戻して保存する。**既存の保存キー・形式を変えない。**
- 方針B: 既存キーは読み取りのみ。新しいキー（例 `sah:v1:dataset`）に正準形式で保存する。初回のみ `importLegacy` で変換し、変換前のデータはバックアップキーにも保存。旧データは削除しない。
- どちらの場合も、`app.ts` の `pickStorage()` で新アダプターを返すようにする。

```ts
// 形の例（Muse の実際の保存 API は調査して置き換えること）
class MuseLegacyStorageAdapter implements StorageAdapter {
  readonly name = "muse-legacy";
  async load() { const raw = await /* 既存の読み込み処理 */; return importLegacy(raw, mapping).dataset; }
  async save(ds: unknown) {
    const raw = await /* 既存の読み込み処理 */;
    await /* 既存の保存処理 */(exportLegacy(raw, ds as StudyDataset, mapping));
  }
  async backup(label, data) { /* 既存とは別のキーに保存 */ }
  async listBackups() { /* … */ } async readBackup(id) { /* … */ }
}
```

### Step 6. UI の再実装・適用
- Muse が単一 HTML を受け付ける場合: `npm run build` の `dist/index.html` をそのまま使えるか確認し、アダプター部分のみ差し替える。
- 単一 HTML 以外（React 等）の場合: `src/data` と `src/analytics`、`src/adapters` はそのまま移植し、`src/design-system/*.css` のトークンとクラスを流用して画面を組み直す。画面仕様は `DESIGN_SYSTEM.md` §8 と `docs/screenshots/`。
- 既存機能で新UIに無いものは削除せず、デザインシステムに合わせて追加する。

### Step 7. AI 連携
- Muse のエージェントがアーティファクトのデータを読む手段を確認する。
  - 読める場合: その手段で `StudyDataset` を読み、`AI_DATA_GUIDE.md` のとおり解釈する。
  - JS 実行・DOM 読み取りができる場合: `window.studyTracker` / `#study-tracker-snapshot` を使う。
  - どちらも不可の場合: 「AI用レポートをコピー」または Markdown/JSON 書き出しをユーザーに会話へ貼ってもらう。
- `AGENT_INSTRUCTIONS.md` を Muse のエージェントの振る舞いに反映する。

### Step 8. データ保全テスト（実データ）
統合後、**実データで**次を確認し、結果をユーザーに報告する（合成データでの成功を実データでの成功と報告しない）。

| # | 確認 | 方法 |
|---|---|---|
| 1 | 既存記録をすべて読み込める | 件数が Step1 と一致 |
| 2 | 合計勉強時間が一致 | 秒単位で一致 |
| 3 | 科目別集計が一致 | 全科目一致 |
| 4 | 日付・時刻が変化していない | 全記録で date/start/end を比較 |
| 5 | 既存 ID が維持されている | ID 集合が一致 |
| 6 | 新規記録を追加できる | 追加→再読込→残っている |
| 7 | 既存記録を編集できる | 編集→再読込→反映、他フィールド不変 |
| 8 | 保存が正しく行われる | 再読込後のフィンガープリントが期待どおり |
| 9 | JSON 書き出し→再取り込みで欠落しない | フィンガープリント一致 |
| 10 | 設定が維持されている | 目標時間・テーマなど |
| 11 | 旧UI/旧形式に戻せる（ロールバック） | バックアップから復元して件数・合計が Step1 と一致 |

アプリ内の「設定 → データの整合性チェック」で件数・合計・科目別・ハッシュを表示できます（`getIntegrity()` でも取得可）。

### Step 9. ロールバック
- 方針A: アダプターを外せば旧 UI がそのまま動く（データ形式は不変）。
- 方針B: 旧キーは無変更のため、旧 UI に戻すだけでよい。新キーのデータは JSON で書き出して保管。
- いずれも Step2 のバックアップから復元可能。

## 3. やってはいけないこと
- 既存データの削除・初期化・上書き（バックアップと検証の前）
- 既存 ID の振り直し、日付・時刻の変換による変化
- 推測で既存スキーマを定義すること
- 実データを GitHub や外部サービスへアップロードすること
- 既存の設定の初期化
