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

- Node.js 22.12 以上
- npm
- DeepL API Free のキー（翻訳機能を使う場合）

## セットアップ

```bash
npm ci
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
登録後はターミナルや起動元のアプリを再起動してください。既に登録済みなら再設定は不要です。
キーをソースコードや共有ファイルに書かないでください。環境変数は暗号化された秘密保管庫ではありません。

翻訳と画像保存は Electron アプリ内で利用できます。Vite の画面を通常のブラウザで開いただけでは利用できません。

## 実行コマンド

- `npm run dev`: 開発起動（Vite + Electron TS watch + Electron app）
- `npm run lint`: 型チェック
- `npm test`: 翻訳・保存・IPC のセキュリティ回帰テスト（実際の API キーや外部通信は不要）
- `npm run build`: Renderer/Electron をビルド
- `npm run electron`: ビルド後に Electron 実行
- `npm start`: 既存ビルドを実行

初回および更新後は `npm run electron` でビルドして起動してください。
生成物の `dist/` と `dist-electron/` は Git に含めません。
開発時はポート 5173 を使用します。Electron 側のコードを変更した場合は開発プロセスを再起動してください。

## セキュリティ方針

- DeepL APIキーの直書きは禁止（環境変数のみ）
- 投稿本文はプレーンテキスト表示（HTMLを直接挿入しない）
- 翻訳・画像保存用のローカル HTTP サーバーは起動しない
- 翻訳・保存は送信元を検証した IPC 経由でメインプロセスが実行
- 保存先の通信は `https://i.4cdn.org` の所定の画像・動画パスのみ許可し、リダイレクトを拒否
- API キーはメインプロセスだけで使用し、画面やエラー応答へ渡さない

依存関係を変更した場合は `npm test`、`npm run lint`、`npm run build`、`npm audit` で確認してください。

ビルド後の `node tests/electron-smoke.cjs` は、非表示の Electron ウィンドウで起動と翻訳 IPC を検証します（通信は模擬応答、ユーザーデータは一時領域に分離）。

## 仕様

詳細仕様は [SPECIFICATION.md](./SPECIFICATION.md) を参照してください。

## License

MIT
