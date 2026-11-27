# gachatoshi-memo
**ガチャとし MEMO**：牛島若利くんのカプセルトイまとめ（非公式ファンサイト）

テスト公開中：https://chocotto518.github.io/gachatoshi-memo/

## 中身
- `index.html` / `css/style.css` / `js/app.js` … サイト本体（ビルド不要）
- `data/products.json` … 商品データ。入力シートのCSVから `python3 tools/csv_to_json.py 書き出したファイル.csv` で作る
- `images/title.svg` … タイトル（Figmaから書き出したもの）
- `templates/products-template.xlsx` … 商品データの入力シート
- `images/products/` … 自分で撮った商品写真。ファイル名を商品の id にすると（例：`stand-stones-4589675717414.webp`）、変換時に自動でその商品の画像になる。**公式の商品画像は入れない**

## 手元で見るには
`products.json` をブラウザで読み込むため、`index.html` をダブルクリックで開くと表示されません。
このフォルダで次のコマンドを実行し、ブラウザで http://localhost:8000 を開いてください。

```bash
python3 -m http.server 8000
```
