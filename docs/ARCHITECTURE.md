# ARCHITECTURE — 構成と各層の責務

## 技術スタックと選定理由

| 要素 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript（strict） | 型安全。データ層の不変条件を型で表現 |
| UI | **フレームワークなし**（安全なタグ付きテンプレート＋イベント委譲） | Muse の Build がどのフレームワークを受け付けるか**公開情報で確認できなかった**ため、React 等に依存しない形を選択。どの実行環境にも移植でき、React 等へ書き換える場合もロジック層はそのまま使える |
| ビルド | Vite 6 + vite-plugin-singlefile | 成果物を **単一の自己完結 HTML**（`dist/index.html`、外部リクエストなし、約158KB / gzip 47KB）にする。単一 HTML はホスト型アーティファクトに最も載せやすい形式 |
| テスト | Vitest | データ層・分析層の単体テスト |
| 実行時依存 | **ゼロ** | CDN・WebGL・外部 API に依存しない |

## レイヤー構成

```
src/
├── data/            ← データ層（UIを知らない）
│   ├── schema.ts        型定義（正本）
│   ├── validate.ts      正規化。未知フィールドを extra へ退避、不正値も保持
│   ├── store.ts         唯一の変更窓口（StudyStore）。保存・自動バックアップ・読み取り専用モード
│   ├── integrity.ts     フィンガープリント（件数・合計・科目別・ハッシュ）
│   ├── io.ts            JSON / CSV の入出力
│   ├── time.ts          日付・時刻（"YYYY-MM-DD" 文字列で扱う）
│   ├── ids.ts           新規 ID 生成（既存 ID は再生成しない）
│   └── synthetic.ts     合成データ生成（デモ・テスト専用）
├── analytics/       ← 分析層（純関数。I/Oなし）
│   ├── index.ts         日次/期間集計、科目配分、比較、連続日数、傾向、計画対実績
│   └── format.ts        表示用の日本語フォーマット
├── adapters/        ← 外部との境界
│   ├── storage.ts       StorageAdapter（localStorage / メモリ）。Muse 用に差し替える場所
│   ├── legacy.ts        既存データ形式 ⇄ 正準形式（宣言的マッピング、往復可能）
│   ├── agent-api.ts     AI 向け読み取り API（window.studyTracker）と DOM スナップショット
│   └── ai-report.ts     AI 向け Markdown レポート
├── design-system/   ← トークン・ガラス・コンポーネントCSS・アイコン
├── components/      ← 表示部品（html テンプレート、グラフ、リング、共通UI）
├── features/        ← 画面とシート（サマリー/記録/分析/科目/設定、記録編集、タイマー、科目、AI提案、バックアップ）
└── app/             ← シェル（ナビゲーション、描画ループ、シート管理、トースト、テーマ）
```

依存方向は一方向: `app → features → components / analytics → data`、`adapters → data`。**data と analytics は DOM に触れない**（テストは Node で実行）。

## データフロー

```
StorageAdapter.load() ─▶ normalizeDataset() ─▶ StudyStore.data
                                                   │ subscribe
UI 操作 ─▶ actions[...] ─▶ StudyStore.mutation ─▶ emit ─▶ 画面再描画 / スナップショット更新
                                │
                                └▶ persist(): 1日1回の自動バックアップ → StorageAdapter.save()
```

- 変更は必ず `StudyStore` のメソッド経由（`addRecord / updateRecord / deleteRecord / restoreRecord / addSubject / updateSubject / addTask / updateTask / setPlan / updateSettings / startSession … / importDataset / replaceDataset / restoreBackup`）。
- `updateRecord` は `id / createdAt / source / extra` を変更しない（タイマー記録の時間を手で変えた場合のみ `extra.editedAfterMeasurement = true` を付ける）。
- 保存失敗は例外で落とさず `saveError` とバナーで通知。
- 保存データが JSON として読めない場合は **読み取り専用モード**で起動し、一切書き込まない。

## UI の描画方式

- 画面は `render(ctx) → { body, trailing?, subtitle? }`（HTML 文字列）。`html` タグ付きテンプレートが全ての値をエスケープするため、ユーザー入力（学習内容など）でマークアップを注入できない。
- 操作は `data-action` 属性＋ドキュメントへのイベント委譲。フォームは `data-submit`。
- シートは別レイヤーに描画し、ストア変更時も入力中のフォームを壊さない（`live: true` の詳細シートのみ再描画）。
- グラフは描画後に実ピクセル幅で SVG を生成（文字が拡大縮小しない）。

## Muse への移植で差し替える箇所

| 差し替え点 | ファイル | 内容 |
|---|---|---|
| 保存先 | `src/adapters/storage.ts` | `StorageAdapter` を実装するクラスを1つ追加し、`app.ts` の `pickStorage()` で選ぶ |
| 既存データの読み込み | `src/adapters/legacy.ts` | 実データを調査して `LegacyMapping` を記述 |
| AI 連携 | `src/adapters/agent-api.ts` | Muse に読み取り手段があればそこへ公開。無ければ既存の3チャネル（API / DOM スナップショット / エクスポート）を使用 |

これ以外（data / analytics / design-system / features）は変更不要な設計です。

## 既知の制約

- 同時に複数タブで編集した場合、後から保存したタブの内容で上書きされる（`storage` イベントによる同期は未実装）。
- localStorage の容量（一般に約5MB）。記録1件あたり約0.5KB のため、約1万件までは余裕がある見込み（未計測）。
- `prefers-reduced-transparency` は一部ブラウザ非対応のため、アプリ内設定を併設。
