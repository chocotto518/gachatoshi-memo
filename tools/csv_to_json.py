#!/usr/bin/env python3
"""
入力シート（products-template）から書き出したCSVを、サイト用の data/products.json に変換する。

使い方:
    python3 tools/csv_to_json.py 書き出したファイル.csv

- 「メモ」の列はサイトに出さないので、products.json には入れない
- メモが「【入力例】」で始まる行は読み飛ばす
- 見た目だけの違い（改行・余分な空白・発売時期の 07月 / 10月 下旬 など）は自動でそろえる
- 内容に関わりそうなこと（JANの重複など）は直さずに「確認してほしいこと」として表示する
- images/products/ に「id と同じ名前」の写真があれば、その商品の画像にする
"""
import csv
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "products.json"
# 商品写真の置き場所。「id と同じ名前」の画像があれば自動で使う（例：images/products/bandai-4582770095487.webp）
ROOT = Path(__file__).resolve().parent.parent
IMAGE_DIR = ROOT / "images" / "products"
IMAGE_EXTS = (".webp", ".jpg", ".jpeg", ".png")

# メーカー名 → id に使う英字（新しいメーカーが増えたらここに足す）
MAKER_KEYS = {
    "ブシロードクリエイティブ": "bushiroad-creative",
    "タカラトミーアーツ": "takaratomy-arts",
    "STAND STONES": "stand-stones",
    "バンダイ": "bandai",
    "フクヤ": "fukuya",
    "ケイカンパニー": "k-company",
    "SK JAPAN": "sk-japan",
}

# 「第○週」を上旬(1)・中旬(2)・下旬(3)に置きかえる目安
WEEK_TO_PERIOD = {1: 1, 2: 2, 3: 2, 4: 3, 5: 3}
PERIOD = {"上旬": 1, "中旬": 2, "下旬": 3}

warnings = []


def clean(s):
    """前後の空白・タブを取り、セル内の改行は半角スペース1つにする"""
    s = (s or "").replace("\r", "")
    s = re.sub(r"\s*\n\s*", " ", s)
    return s.strip()


def normalize_release(label, where):
    """発売時期を「2026年7月中旬」の形にそろえ、並び替え用の値（2026-7-2）を作る"""
    s = re.sub(r"[\s　]+", "", label)
    m = re.fullmatch(r"(\d{4})年(?:(\d{1,2})月)?(上旬|中旬|下旬|第(\d)週)?", s)
    if not m:
        warnings.append(f"{where}：発売時期「{label}」の形が読めませんでした（並び順は一番下になります）")
        return label, "0-0-0"
    year, month, part, week = m.group(1), m.group(2), m.group(3), m.group(4)
    month_n = int(month) if month else 0
    if week:
        period = WEEK_TO_PERIOD.get(int(week), 0)
    else:
        period = PERIOD.get(part or "", 0)
    text = f"{year}年" + (f"{month_n}月" if month else "") + (part or "")
    return text, f"{year}-{month_n}-{period}"


def split_lineup(s):
    names = [re.sub(r"[\s　]+", "", n) for n in re.split(r"[／/]", s)]  # 名前の中の空白を取る（「宮 侑」→「宮侑」）
    return [n for n in names if n]


def main(csv_path):
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    col = {}
    for i, h in enumerate(header):
        key = h.replace("＊", "").strip()
        col[key] = i

    def get(row, name):
        i = col.get(name)
        return clean(row[i]) if i is not None and i < len(row) else ""

    items, seen_ids, seen_jan = [], {}, {}
    for n, row in enumerate(body, start=2):
        if not any(c.strip() for c in row):
            continue
        memo = get(row, "メモ（サイトには出ない）")
        if memo.startswith("【入力例】"):
            continue
        name = get(row, "商品名")
        where = f"{n}行目（{name[:20]}…）" if len(name) > 20 else f"{n}行目（{name}）"
        maker = get(row, "メーカー")
        label, sort = normalize_release(get(row, "発売時期"), where)
        price_s = re.sub(r"[^\d]", "", get(row, "価格（税込）"))
        jan = re.sub(r"\D", "", get(row, "JANコード"))
        item = {
            "id": "",
            "name": name,
            "maker": maker,
            "category": get(row, "カテゴリ"),
            "releaseLabel": label,
            "releaseSort": sort,
            "price": int(price_s) if price_s else 0,
            "jan": jan,
            "lineup": split_lineup(get(row, "ラインナップ")),
            "officialUrl": get(row, "公式URL"),
            "image": "",
        }

        for k in ("name", "maker", "category", "releaseLabel"):
            if not item[k]:
                warnings.append(f"{where}：必須の「{k}」が空です")
        if not item["price"]:
            warnings.append(f"{where}：価格が空です")
        if "牛島若利" not in item["lineup"]:
            warnings.append(f"{where}：ラインナップに「牛島若利」がありません")
        if jan and len(jan) not in (8, 13):
            warnings.append(f"{where}：JANコード「{jan}」のけた数が8・13ではありません")
        if jan in seen_jan:
            warnings.append(f"{where}：JANコード {jan} が {seen_jan[jan]} と同じです")
        if jan:
            seen_jan.setdefault(jan, where)

        # id：メーカー英字-JAN。JANがない・重なるときは メーカー英字-年月-連番
        mk = MAKER_KEYS.get(maker)
        if not mk:
            mk = "maker"
            warnings.append(f"{where}：メーカー「{maker}」の英字名が未登録です（tools/csv_to_json.py の MAKER_KEYS に追加してください）")
        base = f"{mk}-{jan}" if jan and f"{mk}-{jan}" not in seen_ids else f"{mk}-{sort.rsplit('-', 1)[0]}"
        new_id, i = base, 1
        while new_id in seen_ids:
            i += 1
            new_id = f"{base}-{i}"
        seen_ids[new_id] = where
        item["id"] = new_id
        for ext in IMAGE_EXTS:
            if (IMAGE_DIR / f"{new_id}{ext}").exists():
                item["image"] = f"images/products/{new_id}{ext}"
                break
        items.append(item)

    OUT.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(items)}件を {OUT} に書き出しました")
    if warnings:
        print("\n確認してほしいこと:")
        for w in warnings:
            print(" -", w)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("使い方: python3 tools/csv_to_json.py 書き出したファイル.csv")
    main(sys.argv[1])
