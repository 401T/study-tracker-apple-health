# DESIGN_SYSTEM — トークンとコンポーネント仕様

実装ファイル:
- `src/design-system/tokens.css` — すべてのトークン（ライト値は `:root`、ダーク値は `@media (prefers-color-scheme: dark)` と `[data-theme="dark"]` の2か所に同値で定義）
- `src/design-system/glass.css` — Liquid Glass の Web 近似
- `src/design-system/base.css` — リセット・レイアウト
- `src/design-system/components.css` — コンポーネント
- `src/design-system/icons.ts` — 独自アイコン

## v2（Liquid Glass 強化版）の変更点
- 壁紙: `--blob1..4` の色の滲み（`.wallpaper`）。ガラスはこの色を拾う。
- カード・リスト: すりガラスのセル（`--color-card` 半透明 + `--cell-blur`）。屈折はさせず文字の鮮明さを保つ。
- 屈折: タブバー、FAB、ボトムアクセサリ、サイドバー、シート、ダイアログ、トースト、閉じるボタン（`[data-refract]` / `[data-glass]`、`liquid-glass.ts`）。Chromium のみ。設定で OFF 可。
- レンズ: タブバー・サイドバー・セグメンテッドコントロールの選択位置にガラスのピルが移動（`[data-lens]`）。
- ボタン・チップ: 薄いガラス。押すと触れた点から光り、わずかに膨らむ。
- スイッチ: 押している間つまみがガラスになる。
- デスクトップ（≥1024px）: 左に浮遊するガラスのサイドバー（ナビ・今日の進捗・タイマー）。

## v4（モバイル安定化）
- 背景ぼかし（backdrop-filter）は浮遊層（タブバー・FAB・アクセサリ・シート・ダイアログ・トースト・上部ボタン）だけ。カード・リスト・ボタン・チップは半透明のみ。ぼかし要素はそれぞれ GPU レイヤーになり、長い一覧で iPhone のメモリを使い切っていたため。
- 壁紙はグラデーションのみ（filter: blur なし）。スクロール端のぼかしは1層。
- 屈折フィルタは最大24個まで保持し、古いものから破棄。レンズのサイズ監視は再描画で外れた要素の分を解除。
- 記録一覧は60件ずつ表示（「さらに表示」）。
- ボタン・チップ・タブの文字は改行しない。並んだボタンは、ボタンごと次の行へ折り返す。

**ルール: コンポーネントは生の値を使わず、必ずトークンを参照する。** Muse 側でフレームワークが異なる場合も、このトークン表をそのまま CSS 変数として移植すれば見た目が再現できる。

---

## 1. Color tokens

### 背景・ラベル
| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| `--color-bg` | `#F2F2F7` | `#000000` | 画面背景（グループ化スタイル） |
| `--color-bg-elevated` | `#FFFFFF` | `#1C1C1E` | シート（elevated） |
| `--color-card` | `#FFFFFF` | `#1C1C1E` | カード・リスト |
| `--color-card-inset` | `#F2F2F7` | `#2C2C2E` | カード内の塗り |
| `--color-fill` / `-secondary` / `-tertiary` | rgba(120,120,128,.16/.12/.08) | rgba(120,120,128,.36/.32/.24) | 控えめな塗り（セグメント背景・ボタン） |
| `--color-label` | `#000` | `#FFF` | 主テキスト |
| `--color-label-secondary` | rgba(60,60,67,**.78**) | rgba(235,235,245,.68) | 補足テキスト（AA 4.5:1 以上） |
| `--color-label-tertiary` | rgba(60,60,67,.62) | rgba(235,235,245,.45) | 装飾・シェブロンのみ（本文に使わない） |
| `--color-separator` | rgba(60,60,67,.22) | rgba(84,84,88,.6) | 0.5px 区切り線 |

### 意味色
| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| `--color-accent` | `#5856D6` | `#5E5CE6` | 主要ボタンの塗り・グラフのリング |
| `--color-accent-strong` | `#3634A3` | `#A5A3FF` | アクセント色の**文字**（9.6:1 / 7.5:1） |
| `--color-accent-soft` | 12% | 20% | 選択背景・バナー |
| `--color-on-accent` | `#FFF` | `#FFF` | アクセント上の文字（5.6:1 / 5.1:1） |
| `--color-positive` | `#1E7B34` | `#30D158` | 増加（必ず ↑ と符号を併記） |
| `--color-negative` | `#D70015` | `#FF6961` | 減少・削除（必ず ↓ と符号を併記） |
| `--color-warning` | `#C93400` | `#FFB340` | 警告バナー |

### 科目パレット（カテゴリ色）
`--subject-{blue|green|orange|pink|purple|teal|yellow|red|indigo|brown|gray}`（塗り）と `--subject-*-ink`（白背景上の文字用に暗くした色）。データには色名（`"blue"` など）だけを保存し、実際の色はトークンで解決する。**色だけで科目を区別しない**（常に名前を併記）。

## 2. Typography tokens

| トークン | 値（rem @16px） | iOS 対応 |
|---|---|---|
| `--type-large-title` | 700 2.125rem/1.2 | Large Title 34/41 |
| `--type-title1` | 700 1.75rem | Title 1 28/34 |
| `--type-title2` | 700 1.375rem | Title 2 22/28 |
| `--type-title3` | 600 1.25rem | Title 3 20/25 |
| `--type-headline` | 600 1.0625rem/1.3 | Headline 17/22 |
| `--type-body` | 400 1.0625rem/1.4 | Body 17（日本語のため行間を 1.4 に） |
| `--type-callout` | 400 1rem | Callout 16 |
| `--type-subhead` | 400 .9375rem | Subhead 15 |
| `--type-footnote` | 400 .8125rem | Footnote 13 |
| `--type-caption1` | 400 .75rem | Caption 1 12 |
| `--type-caption2` | 400 .6875rem | Caption 2 11（**最小**） |
| `--type-metric-xl` / `-l` / `-m` | 700 3rem / 700 2rem / 600 1.375rem（`--font-numeric`） | 大きな数値 |

フォントスタック:
- `--font-text`: `system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif`
- `--font-numeric`: `ui-rounded, "SF Pro Rounded", system-ui, …`（数値専用）
- `--font-mono-numeric`: `ui-monospace, "SF Mono", Menlo, monospace`（ストップウォッチ）

**フォントファイルは同梱しない**（SF Pro は Apple 製品外の利用不可、Noto Sans JP は端末にあれば使用）。

数値表示ルール:
- 時間は「◯時間◯分」。数値は `metric` サイズ、単位は subhead（例: **2**時間 **15**分）
- 軸ラベルは「0 / 30分 / 1時間 / 1.5時間」
- ストップウォッチは「01:23:45」（等幅）
- 日付は「11月3日(火)」、今年以外は「2025年11月3日(月)」、今日/昨日は相対表記
- 期間は「11月2日〜8日」「10月28日〜11月3日」
- 負の値は U+2212「−」を使用
- 全数値に `font-variant-numeric: tabular-nums`

## 3. Spacing / Radius / Shadow

| トークン | 値 |
|---|---|
| `--space-1..10` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px（4pt グリッド） |
| `--gutter` | 16px（iPhone）、28px（≥900px） |
| `--content-max` | 720px（≥900px で 980px） |
| `--tap-min` | 44px（HIG 既定コントロールサイズ） |
| `--radius-xs / s / m` | 6 / 10 / 14px |
| `--radius-card` | 22px |
| `--radius-sheet` | 34px（シートは画面端から 6px 内側に浮かせ、端末の角と同心） |
| `--radius-capsule` | 999px |
| `--shadow-card` | ほぼ無し（コンテンツ層はフラット） |
| `--shadow-float` / `--shadow-sheet` | 浮遊層のみ |

## 4. Material tokens（Liquid Glass Web 近似）

| トークン | ライト | ダーク |
|---|---|---|
| `--glass-tint` | rgba(255,255,255,.62) | rgba(40,40,44,.55) |
| `--glass-tint-strong`（シート） | rgba(255,255,255,.82) | rgba(44,44,48,.8) |
| `--glass-blur` | 22px | 22px |
| `--glass-saturate` | 1.8 | 1.8 |
| `--glass-highlight`（上辺の鏡面） | rgba(255,255,255,.95) | rgba(255,255,255,.28) |
| `--glass-border` / `--glass-edge` | 内側の縁／外側の縁 | — |
| `--glass-opaque`（透明度を下げる時） | `#F9F9FB` | `#242426` |

クラス:
- `.glass` — 背景ぼかし＋彩度＋内側ハイライト＋縁＋影＋`::before` の鏡面グラデーション
- `.glass-thick` — テキストの多いシート用
- `.glass-interactive` — 押下時にポインタ位置から光り、わずかに拡大（動きを減らす設定で無効）

**適用してよい場所（これ以外は禁止）**: トップバーのボタン、タブバー、FAB（タイマー/追加）、ボトムアクセサリ（計測中タイマー）、シート、トースト。
**禁止**: カード、リスト、グラフ、本文。ガラスの上にガラスを重ねる（シート内ボタンは例外的にシートヘッダーのみ）。

アクセシビリティ時の挙動:
- `prefers-reduced-transparency: reduce` または `[data-glass="reduced"]` → 不透明 `--glass-opaque`、ぼかし無し
- `prefers-contrast: more` → 不透明＋ 1.5px のラベル色境界線
- `backdrop-filter` 非対応 → 不透明

## 5. Motion tokens

| トークン | 値 | 用途 |
|---|---|---|
| `--ease-standard` | cubic-bezier(.2,0,0,1) | 一般的な遷移 |
| `--ease-spring` | cubic-bezier(.32,1.25,.5,1) | 押下・トースト（軽いオーバーシュート） |
| `--dur-fast / base / slow` | 140 / 240 / 380ms | — |

`prefers-reduced-motion: reduce` で全アニメーションを 1ms に短縮。アニメーションは状態変化の説明（シートの出入り、タブバーの縮小、選択の強調）にのみ使用。

## 6. Icon tokens

`--icon-s/m/l` = 16/20/24px、`--icon-stroke` = 1.9。24×24 グリッド、丸い線端。アイコンはすべて `aria-hidden`、意味は必ずテキストかラベルで伝える。
アイコン一覧: summary, records, analytics, subjects, settings, timer, play, pause, stop, plus, minus, chevronRight/Left/Down, check, close, search, trash, edit, flame, target, calendar, clock, arrowUp/Down/Right, info, download, upload, sparkles, note, trend, backup, copy, task, circle, shield, paint, list, warning。

## 7. Chart tokens

| トークン | ライト | ダーク | 意味 |
|---|---|---|---|
| `--chart-bar` | `#5856D6` | `#7D7AFF` | バー・線（グラフィック 3:1 以上） |
| `--chart-bar-muted` | 35% | 40% | 進行中の期間 |
| `--chart-grid` | rgba(60,60,67,.14) | rgba(235,235,245,.14) | 横グリッド |
| `--chart-goal` | `#C93400`（破線） | `#FF9F0A` | 目標線 |
| `--chart-average` | = label-secondary（実線） | 同左 | 平均線 |
| `--chart-selection` | accent 10% | 16% | キーボードフォーカス |

## 8. コンポーネント仕様

| コンポーネント | 実装 | 仕様 |
|---|---|---|
| Top bar | `.topbar` | 透明。スクロール 28px 超でスクロールエッジ効果（ぼかし＋フェード）とコンパクトタイトルを表示。右側にガラスのボタン |
| Large title | `.large-title` | 34px Bold、下にサブタイトル（日付など） |
| Tab bar | `.tabbar.glass` | 下部に浮遊するカプセル、5タブ（サマリー/記録/分析/科目/設定）、選択中はアクセント文字＋薄い塗り、`aria-current="page"`。下スクロールで高さ 62→50px・ラベル非表示 |
| FAB | `.fab.glass` | 62px 円。待機中「＋」、計測中はアクセント塗り＋タイマーアイコン |
| Bottom accessory | `.accessory.glass` | 計測中のみ。科目色ドット、科目名、状態、経過時間（等幅）、一時停止/再開ボタン |
| Card | `.card` | 不透明、角丸 22px、余白 16px。ヘッダ（`card-header`: アイコン＋カテゴリ名（色付き）＋右側メタ＋シェブロン） |
| Metric | `metric()` | 大きな数値＋小さな単位、`aria-label` に「2時間15分」 |
| Grouped list | `.list` / `.row` | 最小 44px、区切り線はアイコン分インセット、右に値とシェブロン |
| Segmented control | `segmented()` | `role=radiogroup`、選択は浮き上がった白（ダークは #636366） |
| Chips | `.chip` | フィルタ。`aria-pressed`、科目色ドット＋名前 |
| Button | `.btn`（primary / destructive / small / block） | 高さ 50px（small 36px）、カプセル |
| Sheet | `.sheet.glass.glass-thick` | `role=dialog` `aria-modal`、グラバー、ヘッダ（左: 閉じる/キャンセル、中央: タイトル、右: 保存）、背面は `inert`、Esc で閉じる、フォーカストラップ、閉じた後に元の要素へフォーカス復帰 |
| Form field | `.field` | ラベル左・値右（iOS 設定アプリ型）。テキストエリアは `stacked` |
| Toast | `.toast.glass` | 上部、`aria-live=polite`、任意のアクション（元に戻す等） |
| Ring | `ring()` | 目標達成率。100% 超は2周目を濃い色で描画 |
| Bar / Line chart | `chart()` | DESIGN_RESEARCH §6 参照 |
| Share bar | `shareBar()` | 100% 積み上げ、2px 区切り、`role=img` と要約ラベル |
| Progress | `progress()` | `role=progressbar`、100% 以上で positive 色 |
| Empty state | `empty()` | アイコン＋見出し＋説明＋行動ボタン |
| Banner | `.banner` | 読み取り専用モード、保存不可、AI 提案の通知 |

## 9. レスポンシブ

- 〜899px: 1カラム、マージン 16px、iPhone 幅（390px）で設計。
- 900px〜: 2カラムのカードグリッド（`.span-2` は全幅）、最大幅 980px。
- シートは 700px 以上で画面中央のモーダルに。
- セーフエリア: `viewport-fit=cover` と `env(safe-area-inset-*)` でノッチ・ホームインジケータを回避。
