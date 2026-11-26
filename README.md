# gachatoshi-memo
**ガチャとし MEMO**：牛島若利くんのカプセルトイまとめ（非公式ファンサイト）

テスト公開中：https://chocotto518.github.io/gachatoshi-memo/

## 中身
- `index.html` / `css/style.css` / `js/app.js` … サイト本体（ビルド不要）
- `data/products.json` … 商品データ。新しい商品はここに1件足すだけで一覧に出ます（今はダミー）
- `images/title.svg` … タイトル（仮。正式なSVGが届いたら差し替え）
- `images/dummy/` … 確認用の自作ダミー画像。**公式の商品画像は入れない**

## 手元で見るには
`products.json` をブラウザで読み込むため、`index.html` をダブルクリックで開くと表示されません。
このフォルダで次のコマンドを実行し、ブラウザで http://localhost:8000 を開いてください。

```bash
python3 -m http.server 8000
```
