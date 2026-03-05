# 4chan Viewer

Electron + React + Vite で動く、4chan スレッド閲覧アプリです。  
board -> thread -> post/gallery の流れで閲覧し、翻訳と画像保存に対応しています。

## 主な機能

- 板一覧の取得・検索
- カタログからスレッド一覧表示（先頭50件）
- スレッド表示（THREAD / GALLERY 切り替え）
- 画像の個別保存 / 一括保存
- 投稿テキストの日本語翻訳（DeepL）
- 過去スレの追加読み込み

## 必要環境

- Node.js 20+
- npm
- DeepL API Key（翻訳機能を使う場合）

## セットアップ

```bash
npm install
```

`.env` は自動読み込みしない実装です。実行前に環境変数 `DEEPL_API_KEY` を設定してください。

### Windows (PowerShell)

```powershell
$env:DEEPL_API_KEY="your_deepl_api_key"
npm run dev
```

### macOS / Linux (bash/zsh)

```bash
export DEEPL_API_KEY="your_deepl_api_key"
npm run dev
```

永続化したい場合は、OSのユーザー環境変数に `DEEPL_API_KEY` を登録してください。

## 実行コマンド

- `npm run dev`: 開発起動（Vite + Electron TS watch + Electron app）
- `npm run lint`: 型チェック
- `npm run build`: Renderer/Electron をビルド
- `npm run electron`: ビルド後に Electron 実行
- `npm start`: 既存ビルドを実行

## セキュリティ方針

- DeepL APIキーの直書きは禁止（環境変数のみ）
- 投稿本文はプレーンテキスト表示（HTMLを直接挿入しない）
- ダウンロードプロキシは `https://i.4cdn.org` のみ許可

## 仕様

詳細仕様は [SPECIFICATION.md](./SPECIFICATION.md) を参照してください。

## License

MIT