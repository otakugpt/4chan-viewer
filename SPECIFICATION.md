# 4chan Viewer Specification

最終更新日: 2026-02-11
対象バージョン: 1.0.0

## 1. アプリ概要

Electron + React + Vite + Tailwind で構築された、4chan スレッド閲覧アプリです。
board -> thread -> post/画像 の流れで閲覧し、翻訳と画像保存を行えます。

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
3. 滑らかなトランジションとフェード/スライドインアニメーション
4. 可読性重視の配色（本文・メタ情報・アクションで色を分離）

### 2.3 レスポンシブ

デスクトップを主対象としつつ、狭い幅では 3 カラムを縦スタック表示します。

## 3. 機能仕様

### 3.1 板一覧取得

- 取得先: `boards.json`
- Electron 実行時: `https://a.4cdn.org/boards.json`
- 開発時 (Vite): `/api/boards.json` をプロキシ
- 検索: board 名/タイトルのクライアント側フィルタ
- 可読性: board code (`/{board}/`) と board title は常時白系テキストで表示し、背景とのコントラストを維持

### 3.2 スレッド一覧取得

- 取得先: `/{board}/catalog.json`
- 表示件数: 最大 50 件
- 表示情報:
1. サムネイル
2. 件名
3. 本文サマリ (長文は切り詰め + 最大表示行数で固定)
4. レス数 / 画像数
5. 翻訳ボタン
6. 翻訳結果はカード内でスクロール表示し、全体レイアウトを維持

### 3.3 スレッド詳細表示

- 取得先: `/{board}/thread/{threadId}.json`
- 表示モード:
1. `THREAD`: 投稿順表示
2. `GALLERY`: 画像タイル表示
- 投稿表示要素:
1. 名前
2. 投稿番号
3. 本文
4. 画像サムネイル/元画像リンク
5. 翻訳ボタン
6. 画像の個別保存ボタン

### 3.4 過去スレ読み込み

- 取得先:
1. `/{board}/archive.json`
2. `/{board}/thread/{oldThreadId}.json`
- 動作: 読み込み済みスレッド ID の次のアーカイブスレッドを追加読み込み
- 終端判定: 追加対象が無い場合 `noMoreOlder = true`

### 3.5 翻訳機能

- エンドポイント: `POST http://localhost:4040/translate`
- リクエスト: `{ "text": "<翻訳対象テキスト>" }`
- レスポンス: `{ "translatedText": "<翻訳結果>" }`
- サーバ側: Electron メインプロセス内の Express が DeepL API へ中継
- 変換先言語: 日本語 (`target_lang=JA`)

### 3.6 画像保存（一括 / 個別）

- 共通保存 API: `window.electron.saveImages(list)`
- 一括保存:
1. トリガー: `Save all`
2. 対象: スレッド内すべての画像
- 個別保存:
1. トリガー: 投稿カードまたはギャラリーカードの `Save image` / `Save`
2. 対象: 選択した画像 1 件
- 保存フロー:
1. 保存先フォルダを選択
2. IPC でメインプロセスへ送信
3. ローカルプロキシ経由で順次ダウンロード
4. `save-progress` / `save-complete` を Renderer に通知

## 4. IPC / Preload 仕様

`window.electron` で以下 API を公開します。

1. `saveImages(list)`
2. `onProgress(callback)`
3. `onSaveComplete(callback)`

進捗イベント payload:

1. `current`
2. `total`
3. `percent`
4. `filename`

イベント名:

1. 進捗: `save-progress`
2. 完了: `save-complete`

## 5. ネットワーク仕様

### 5.1 4chan API / 画像 CDN

- API ベース: `https://a.4cdn.org`
- 画像ベース: `https://i.4cdn.org`

### 5.2 ローカルプロキシ (Electron main 内 Express)

- ポート: `4040`
- ルート:
1. `GET /proxy?url=...`
2. `POST /translate`
- 負荷制御:
1. フェッチ間隔を制限
2. ダウンロードでリトライ実施

### 5.3 開発時 Vite プロキシ

- `/api` -> `https://a.4cdn.org`
- `/img` -> `https://i.4cdn.org`

## 6. 実行環境とプラットフォーム

### 6.1 実行形態

- 開発実行: `npm run dev` + `npm run electron-dev`
- ビルド: `npm run build`
- 実行: `npm start` または `npm run electron`
- 型チェック: `npm run lint` (Renderer と Electron の双方を TypeScript で検証)

### 6.2 OS 互換性

Electron のクロスプラットフォーム API のみを利用しているため、依存関係が揃えば Windows / macOS の両方で動作可能です。

注記: 配布用インストーラ設定 (electron-builder 等) は未定義のため、現状は開発実行または手動ビルド実行が前提です。

## 7. 既知の制約

1. 翻訳機能は `localhost:4040` のローカルサーバ起動が前提
2. 本文表示で `dangerouslySetInnerHTML` を利用
3. スレッド一覧は 50 件に制限
4. 4chan 側のレート制御やレスポンス仕様変更に影響される可能性あり

## 8. メンテナンス運用ルール

機能追加・挙動変更・API変更・UI変更を行う際は、同じ変更セットで本 `SPECIFICATION.md` を更新することを標準運用とします。

更新時の最低チェック項目:

1. 画面仕様に差分があるか
2. API/IPC/保存フローに差分があるか
3. 実行前提や制約が変わったか
4. 最終更新日が更新されているか
