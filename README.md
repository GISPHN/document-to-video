# Document to Video

PDF、Word、PowerPoint、テキストなどの資料から、短い解説動画をブラウザだけで作成するWebアプリです。

利用者がPC操作に詳しくなくても使えること、利用料金を発生させないこと、入力資料を外部サーバーへアップロードしないことを重視しています。

## 主な機能

- PDF（文字情報を含むPDF）の読み取り
- DOCXの読み取り
- PPTXの文字抽出
- TXT / Markdown / CSVの読み取り
- 文章の直接貼り付け
- 1分 / 3分 / 5分の解説構成
- 一般向け / 専門職向け / 学生向け / 管理職向けの重要度調整
- ガイドライン、研究、報告書、研修資料などの文書種別の自動判定
- 元資料のページ・段落・スライド位置を保持した要点抽出
- 生成されたシーンタイトルとナレーションの手動修正
- 日本語ナレーションのブラウザ内合成
- Canvas + MediaRecorderによるWebM動画生成
- 台本TXT、字幕SRT、動画WebMの保存

## 完全無料で動かすための構成

このアプリはバックエンドサーバーを持ちません。

```text
PDF / DOCX / PPTX / Text
          ↓
      Browser
          ↓
  client side parser
          ↓
extractive summarizer
          ↓
 editable scenes
          ↓
 Piper Plus WASM TTS
          ↓
Canvas + MediaRecorder
          ↓
        WebM
```

GitHub Pages上では静的ファイルだけを配信します。PDFやWordなどの入力資料は、通常の利用では利用者のブラウザ内で読み取ります。

音声モデルについては、初回利用時に公開モデル配布元からブラウザへダウンロードされます。

## 日本語音声

ブラウザ内TTSには [piper-plus](https://github.com/ayutaz/piper-plus) を使用しています。

既定モデルは `ayousanz/piper-plus-css10-ja-6lang` です。このモデルのモデルカードではCSS10 public domain準拠とされています。アプリ本体のMIT Licenseとは別に、利用するモデル・データセット・依存ライブラリそれぞれのライセンス条件を確認してください。

## 対応ブラウザ

ChromeまたはEdgeの最新版を推奨します。

音声合成にはWebAssembly / ONNX Runtime Web、動画作成にはCanvas captureStreamとMediaRecorderを利用します。ブラウザや端末性能によっては音声合成が利用できない場合があるため、音声なし動画作成も用意しています。

## 現在の制約

- 画像だけで構成されたスキャンPDFのOCRは未対応です。
- 自動整理は生成AIによる自由作文ではなく、原資料中の文章を重要度評価して抽出する方式です。原資料にない内容を作りにくい一方、人間による自然な要約ほど滑らかにならない場合があります。
- WebMはYouTubeへ直接アップロードできますが、このアプリからYouTubeへの自動投稿は行いません。
- 動画はブラウザのMediaRecorderで実時間録画するため、3分の動画なら最終レンダリングにもおおむね3分程度必要です。
- 任意WebページURLの直接読み込みはCORS制約があるため、初版では提供していません。

## GitHub Pagesで公開する

`.github/workflows/pages.yml` がmainブランチへのpushを検出し、ViteでビルドしてGitHub Pagesへデプロイします。

初回のみ、GitHubのリポジトリ設定で Pages の Source を `GitHub Actions` に設定する必要がある場合があります。

公開URLは通常、次の形式です。

```text
https://gisphn.github.io/document-to-video/
```

## ローカル開発

Node.js 24以降を推奨します。

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build
```

## 設計上の考え方

医療、保健、公衆衛生、研究、行政資料でも利用できるよう、原資料との対応関係をできる限り保持しています。PDFの場合はページ番号、Wordの場合は段落番号、PowerPointの場合はスライド番号をシーンに残します。

自動抽出結果は最終回答ではありません。利用者が構成と台本を確認し、必要に応じて修正してから動画を作成することを前提としています。

## License

MIT License

Copyright (c) 2026 Ryo Horiike / GISPHN
