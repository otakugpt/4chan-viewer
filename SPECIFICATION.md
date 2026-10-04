# 4chan Viewer Specification

最終更新日: 2026-10-04
対象バージョン: 1.0.0

## 1. アプリ概要

Electron + React + Vite + Tailwind で構築された 4chan スレッド閲覧アプリです。
`board -> thread -> post/画像` の流れで閲覧し、翻訳と画像保存を行えます。

## 2. UI仕様

### 2.1 全体レイアウト

画面は 3 カラム構成です。

1. 左カラム: `BoardList`
2. 中央カラム: `ThreadList`
3. 右カラム: `ThreadView`

上部ヘッダーには選択中の board/thread をチップ表示し、下部には保存進捗バーを表示します。

### 2.2 デザインテーマ

1. 高コントラストのダークテーマ
2. ガラス調パネル（半透明 + 境界線 + ぼかし）
3. フェード/スライドインを中心としたアニメーション
4. 本文・メタ情報・アクションの色分離

### 2.3 レスポンシブ

デスクトップを主対象としつつ、狭い幅では 3 カラムを縦スタック表示します。

## 3. 機能仕様

### 3.1 板一覧取得

- 取得先: `boards.json`
- Electron 実行時: `https://a.4cdn.org/boards.json`
- 開発時 (Vite): `/api/boards.json` をプロキシ
- 検索: board 名/タイトルのクライアント側フィルタ

### 3.2 スレッド一覧取得

- 取得先: `/{board}/catalog.json`
- 表示件数: 最大 50 件
- 表示情報:
1. サムネイル
2. 件名
3. 本文サマリ (長文は切り詰め + 最大表示行数)
4. レス数 / 画像数
5. 翻訳ボタン
6. 翻訳結果（カード内スクロール）

### 3.3 スレッド詳細表示

- 取得先: `/{board}/thread/{threadId}.json`
- 表示モード:
1. `THREAD`: 投稿順表示
2. `GALLERY`: 画像タイル表示
- 投稿表示要素:
1. 名前
2. 投稿番号
3. 本文（HTMLタグを除去したプレーンテキスト表示）
4. 画像サムネイル/元画像リンク
5. 翻訳ボタン
6. 画像の個別保存ボタン

### 3.4 過去スレ読み込み

- 取得先:
1. `/{board}/archive.json`
2. `/{board}/thread/{oldThreadId}.json`
- 動作:
1. 読み込み済みIDより古いアーカイブスレを降順で探索
2. 未読の最初の1件を追加読み込み
- 終端判定: 追加対象がない場合 `noMoreOlder = true`

### 3.5 翻訳機能

- 呼び出し: `window.electron.translate(text)` → IPC `translate-text`
- 引数: 空白のみではない文字列（最大 4000 文字、JavaScript の文字列長）
- 戻り値: Promise。成功は `{ "translatedText": "<翻訳結果>" }`、失敗は `{ "error": "<エラー概要>" }`
- 変換先言語: 日本語 (`target_lang=JA`)
- 実装前提:
1. Electron メインプロセスが `https://api-free.deepl.com/v2/translate` へ直接 HTTPS 通信（DeepL API Free）
2. `DEEPL_API_KEY` 環境変数が未設定の場合はエラー結果を返し翻訳不可
3. `.env` の自動読込は未実装のため、起動前に環境変数を設定
4. タイムアウトは 30 秒。リダイレクトを拒否し、上流の応答本文・例外詳細を画面に返さない
5. 同時翻訳はアプリ全体で 1 件。処理中の追加要求はエラーを返す
6. ブラウザ単体では利用不可。HTTP 経由ではないため翻訳に CORS 設定は不要

### 3.6 画像保存（一括 / 個別）

- 共通保存 API: `window.electron.saveImages(list)`
- 一括保存:
1. トリガー: `Save all`
2. 対象: スレッド内の全画像
- 個別保存:
1. トリガー: `Save image` / `Save`
2. 対象: 選択画像 1 件
- 保存フロー:
1. IPC でメインプロセスへ送信し、送信元と入力を検証
2. 保存先フォルダを選択（キャンセル時は保存しない）
3. メインプロセスから直接 HTTPS で順次ダウンロード（最大 3 回試行）
4. `save-progress` / `save-complete` を Renderer に通知
- 保存時の補足:
1. 許可されるダウンロードURLは `https://i.4cdn.org/{board}/{数字}.{拡張子}` のみ。board は英数字、拡張子は jpg/jpeg/png/gif/webm。認証情報・非標準ポート・クエリ・フラグメントを拒否
2. 同名ファイルは `-1`, `-2` サフィックスで重複回避
3. 失敗ファイルがある場合でも完了イベントに件数を含めて通知
4. リクエストは全体で直列化し、開始間隔は最低 1200 ms。各通信は本文受信を含め 60 秒でタイムアウト。リダイレクトは拒否
5. 排他的に新規ファイルを作成し、書き込み失敗時は作成した不完全ファイルだけを削除。既存ファイルは上書きしない
6. 1 回の要求は 1〜2000 件。指定ファイル名は数字と許可拡張子のみ。不正要求は保存処理を開始しない

## 4. IPC / Preload 仕様

`window.electron` で以下 API を公開します。

1. `saveImages(list)`
2. `onProgress(callback)`
3. `onSaveComplete(callback)`
4. `translate(text)`

通知コールバックの引数はデータのみ。Electron のイベントオブジェクトは公開しません。
購読 API は解除関数を返します。翻訳・保存の IPC は登録済みウィンドウのメインフレームからのみ受け付け、読み込んだ URL と一致することを検証します（ハッシュの差は許可）。

### 4.1 `save-progress` payload

1. `current`
2. `total`
3. `percent`
4. `filename`

### 4.2 `save-complete` payload

1. `total`
2. `saved`
3. `failed`
4. `failedFiles`

## 5. ネットワーク仕様

### 5.1 4chan API / 画像 CDN

- API ベース: `https://a.4cdn.org`
- 画像ベース: `https://i.4cdn.org`

### 5.2 メインプロセスの通信

- 翻訳・保存用 HTTP サーバーは起動しない。旧ポート 4040 と `/proxy`・`/translate` は廃止
- Node.js 組み込み `fetch` で DeepL / 画像 CDN に直接接続
- キーは DeepL の Authorization ヘッダーだけに設定し、Renderer に渡さない

### 5.3 開発時 Vite プロキシ

- `/api` -> `https://a.4cdn.org`
- `/img` -> `https://i.4cdn.org`
- 開発サーバーは `localhost:5173` に固定。ポート使用中は別ポートへ切り替えず起動失敗とする

## 6. セキュリティ仕様

1. `BrowserWindow` は `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
2. `window.open` 相当はアプリ内遷移を禁止し、外部ブラウザで開く
3. 投稿本文は HTML を除去したテキストとして描画し、直接HTML挿入しない
4. DeepL APIキーのハードコード禁止（環境変数のみ）
5. アプリ画面のナビゲーション・リダイレクトを禁止し、IPC の送信元を検証
6. 開発 URL の読み込みと DevTools 自動起動は明示的な開発モードのみ
7. 環境変数は OS の秘密保管庫ではなく、同一ユーザー権限の悪意あるプロセスからキーを保護するものではない

## 7. 実行環境とプラットフォーム

### 7.1 実行形態

- 必要環境: Node.js 22.12 以上。依存関係は `npm ci` で導入
- 開発実行: `npm run dev`（Electron 側の初回コンパイル後に起動）
- 開発補助:
1. `npm run dev:renderer` (Vite)
2. `npm run dev:electron` (Electron TS watch)
3. `npm run dev:app` (Electron 起動)
- ビルド: `npm run build`
- 実行: `npm start` または `npm run electron`
- 型チェック: `npm run lint`
- 回帰テスト: `npm test`（外部通信なし。翻訳、URL 検証、保存失敗、IPC 境界を検証）
- 依存関係チェック: `npm audit`
- `npm start` はビルド済みファイルが必要。初回・更新後は `npm run electron` を使用
- Electron 側の変更は watch でコンパイルされるが、反映にはプロセス再起動が必要

### 7.2 OS 互換性

Electron のクロスプラットフォーム API に依存するため、依存関係が揃えば Windows / macOS で動作可能です。

注記: 配布用インストーラ設定 (electron-builder 等) は未定義です。

## 8. 既知の制約

1. 翻訳機能は `DEEPL_API_KEY` の設定が必須
2. 4chan 側のレート制御やレスポンス仕様変更に影響される可能性あり
3. スレッド一覧は catalog 先頭 50 件に制限

## 9. メンテナンス運用ルール

機能追加・挙動変更・API変更・UI変更を行う際は、同じ変更セットで本 `SPECIFICATION.md` を更新すること。

更新時の最低チェック項目:

1. 画面仕様に差分があるか
2. API/IPC/保存フローに差分があるか
3. 実行前提やセキュリティ要件が変わったか
4. 最終更新日が更新されているか
