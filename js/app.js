/* =========================================================
   ガチャとし MEMO
   - 商品データは data/products.json の1か所だけで管理する
   - 一覧（#/）と詳細（#/item/<id>）を1ページで切り替える
   ========================================================= */
(() => {
  "use strict";

  const DATA_URL = "data/products.json";

  // チップの並び順。データにない項目は出さず、ここにない項目は後ろに足す
  const CATEGORY_ORDER = ["キーホルダー", "マスコット", "フィギュア", "缶バッジ", "ぬいぐるみ", "その他"];

  // 商品名の文字サイズ（px）：基本・下限・小さくする幅
  const TITLE_SIZE = { base: 14, min: 12, step: 0.5, lineHeight: 1.45, maxLines: 2 };

  // リングノート：穴の間隔と、ノートの端からの最低余白
  const BINDING = { pitch: 61, hole: 29, ring: 16, minSide: 24 };

  // メルカリの検索語（仮）：商品名＋牛島
  const mercariUrl = (item) =>
    "https://jp.mercari.com/search?keyword=" + encodeURIComponent(`${item.name} 牛島`);

  const STORAGE_KEY = "gachatoshi:filter";

  const $ = (id) => document.getElementById(id);
  const els = {
    notebook: $("notebook"),
    binding: $("binding"),
    listView: $("view-list"),
    detailView: $("view-detail"),
    chips: $("chips"),
    count: $("count"),
    cardList: $("card-list"),
    toast: $("toast"),
  };

  const state = {
    items: [],
    categories: [],
    selected: new Set(), // 空＝「すべて」
    listScrollY: 0,
    openedFromList: false,
  };

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /* ---------- 小さな道具 ---------- */

  // DOMを組み立てる（文字はtextContentで入れるので、データにタグが入っても安全）
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return el;
  }

  const formatPrice = (price) => `¥${Number(price).toLocaleString("ja-JP")}`;

  // "2026-11-3" → 20261103（大きいほど新しい）
  function sortKey(releaseSort) {
    const [y, m, p] = String(releaseSort || "").split("-").map((n) => parseInt(n, 10) || 0);
    return y * 10000 + m * 100 + p;
  }

  // アイコン（Figmaから書き出したもの。check.svg だけ自作）
  const ICON = {
    back: "images/icons/back.svg",
    copy: "images/icons/copy.svg",
    check: "images/icons/check.svg",
    external: "images/icons/external.svg",
    externalWhite: "images/icons/external-white.svg",
  };
  const icon = (src) => h("img", { src, alt: "", width: 20, height: 20 });

  /* ---------- データ ---------- */

  // 手作業の入力ミスに気づけるよう、足りない項目をコンソールに出す
  function validate(items) {
    const required = ["id", "name", "maker", "category", "releaseLabel", "releaseSort", "price", "lineup"];
    const seen = new Set();
    items.forEach((item, i) => {
      const missing = required.filter((k) => item[k] == null || item[k] === "");
      if (missing.length) console.warn(`[products.json] ${i}件目（${item.id || "id不明"}）に必須項目がありません:`, missing.join(", "));
      if (seen.has(item.id)) console.warn(`[products.json] id が重なっています: ${item.id}`);
      seen.add(item.id);
      if (item.releaseSort && !/^\d{4}-\d{1,2}-[0-3]$/.test(item.releaseSort)) {
        console.warn(`[products.json] releaseSort の形が違います（例: 2026-11-3）: ${item.id} → ${item.releaseSort}`);
      }
    });
  }

  function buildCategories(items) {
    const inData = new Set(items.map((i) => i.category).filter(Boolean));
    const known = CATEGORY_ORDER.filter((c) => c !== "その他" && inData.has(c));
    const extra = [...inData].filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...extra, ...(inData.has("その他") ? ["その他"] : [])];
  }

  /* ---------- リングノートの穴とリング ---------- */

  // 穴の上端（ノートの上端から）と、穴をくり抜く帯の高さ（CSSの 64px と合わせる）
  const HOLE_TOP = 18;
  const MASK_HEIGHT = 64;

  let lastBindingWidth = 0;
  function layoutBinding() {
    const width = els.notebook.clientWidth;
    if (width === lastBindingWidth) return;
    lastBindingWidth = width;

    const { pitch, hole, ring, minSide } = BINDING;
    const count = Math.max(1, Math.floor((width - minSide * 2 - hole) / pitch) + 1);
    const span = (count - 1) * pitch + hole;
    const start = (width - span) / 2; // 左右の余白を均等に
    const centers = Array.from({ length: count }, (_, i) => start + hole / 2 + i * pitch);

    // 穴：帯の形（長方形から円をくり抜いたもの）をSVGで作り、ノートのマスクにする
    const r = hole / 2;
    const cy = HOLE_TOP + r;
    const circles = centers
      .map((cx) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${hole} 0a${r} ${r} 0 1 0 ${-hole} 0Z`)
      .join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${MASK_HEIGHT}">` +
      `<path fill-rule="evenodd" d="M0 0H${width}V${MASK_HEIGHT}H0Z${circles}"/></svg>`;
    els.notebook.style.setProperty("--holes-mask", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);

    // 穴のふちの影と、リング（穴の中心にそろえる）。リングを後に置いて上に重ねる
    els.binding.replaceChildren(
      ...centers.map((center) => h("span", { class: "binding__hole-edge", style: `left:${center - hole / 2}px` })),
      ...centers.map((center) => h("span", { class: "binding__ring", style: `left:${center - ring / 2}px` }))
    );
  }

  /* ---------- 一覧 ---------- */

  function renderChips() {
    const all = state.selected.size === 0;
    const chip = (label, pressed, onclick) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(pressed), onclick, text: label });

    els.chips.replaceChildren(
      chip("すべて", all, () => {
        state.selected.clear();
        onFilterChange();
      }),
      ...state.categories.map((c) =>
        chip(c, state.selected.has(c), () => {
          // 2度目のタップで解除。複数選べる
          state.selected.has(c) ? state.selected.delete(c) : state.selected.add(c);
          onFilterChange();
        })
      )
    );
  }

  function onFilterChange() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...state.selected]));
    } catch (_) {
      /* 保存できなくても動く */
    }
    renderChips();
    renderList();
  }

  function visibleItems() {
    if (state.selected.size === 0) return state.items;
    return state.items.filter((i) => state.selected.has(i.category));
  }

  function thumb(item, className) {
    if (!item.image) return h("div", { class: `${className} ${className}--empty`, role: "img", "aria-label": "画像なし" });
    const box = h("div", { class: className });
    const img = h("img", { src: item.image, alt: "", loading: "lazy", decoding: "async" });
    // 画像が読み込めなかったときもプレースホルダーにする
    img.addEventListener("error", () => {
      img.remove();
      box.classList.add(`${className}--empty`);
    });
    box.append(img);
    return box;
  }

  // 一覧カードでは、先頭の「ハイキュー!!」（‼・全角！！も）と後ろの空白を省く。
  // 途中にある「ハイキュー!!」はそのまま。詳細ページとコピーは正式名のまま
  function cardTitle(name) {
    const short = name.replace(/^ハイキュー(?:!!|‼|！！)[\s　]*/, "");
    return short || name;
  }

  function renderCard(item) {
    return h(
      "li",
      {},
      h(
        "button",
        {
          type: "button",
          class: "card",
          onclick: () => openDetail(item.id),
        },
        h("span", { class: "card__ornament", "aria-hidden": "true" }),
        h(
          "span",
          { class: "card__body" },
          thumb(item, "thumb"),
          h(
            "span",
            { class: "card__info" },
            h("span", { class: "badge-maker", text: item.maker }),
            h("span", { class: "card__title", text: cardTitle(item.name) }),
            h(
              "span",
              { class: "card__meta" },
              formatPrice(item.price),
              h("span", { class: "card__meta-sep", "aria-hidden": "true", text: "|" }),
              item.releaseLabel
            )
          )
        )
      )
    );
  }

  function renderList() {
    const items = visibleItems();
    els.count.textContent = `${items.length}件`;
    els.cardList.replaceChildren(...items.map(renderCard));
    fitTitles(true);
  }

  /* ---------- 商品名を2行に収める ---------- */

  function fitTitle(el) {
    const { base, min, step, lineHeight, maxLines } = TITLE_SIZE;
    el.classList.remove("is-clamped");
    for (let size = base; size >= min; size -= step) {
      el.style.fontSize = `${size}px`;
      if (el.scrollHeight <= Math.ceil(size * lineHeight * maxLines) + 1) return;
    }
    // 下限でも入らない → 2行目の最後を「…」に
    el.style.fontSize = `${min}px`;
    el.classList.add("is-clamped");
  }

  let lastFitWidth = 0;
  function fitTitles(force = false) {
    if (els.listView.hidden) return; // 非表示の間は測れない
    const width = els.cardList.clientWidth;
    if (!force && width === lastFitWidth) return;
    lastFitWidth = width;
    els.cardList.querySelectorAll(".card__title").forEach(fitTitle);
  }

  /* ---------- 詳細 ---------- */

  function copyRow(label, value) {
    const iconImg = icon(ICON.copy);
    const iconBtn = h("button", { type: "button", class: "copy-cell__icon", "aria-label": `${label}をコピー` }, iconImg);
    const row = h(
      "tr",
      { class: "copy-row" },
      h("th", { scope: "row", text: label }),
      h("td", {}, h("div", { class: "copy-cell" }, h("span", { class: "copy-cell__text", text: value }), iconBtn))
    );

    row.addEventListener("click", async () => {
      // 長押しで文字を選んでいるときは、コピーしない（選んだ部分をそのまま使えるように）
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && row.contains(sel.anchorNode)) return;

      const ok = await copyText(value);
      showToast(ok ? "コピーしました" : "コピーできませんでした");
      if (ok) {
        iconImg.src = ICON.check;
        clearTimeout(iconBtn._t);
        iconBtn._t = setTimeout(() => (iconImg.src = ICON.copy), 1200);
      }
    });
    return row;
  }

  function plainRow(label, value) {
    return h("tr", {}, h("th", { scope: "row", text: label }), h("td", {}, value));
  }

  function renderDetail(item) {
    const back = h("button", { type: "button", class: "back", onclick: goBack }, icon(ICON.back), h("span", { text: "もどる" }));

    if (!item) {
      els.detailView.replaceChildren(back, h("p", { text: "商品が見つかりませんでした。" }));
      return;
    }

    const jan = item.jan
      ? copyRow("JANコード", item.jan)
      : plainRow("JANコード", h("span", { class: "empty-value", text: "なし" }));

    const lineup = Array.isArray(item.lineup) ? item.lineup : [];

    const actions = h(
      "div",
      { class: "actions" },
      h(
        "a",
        { class: "btn btn--primary", href: mercariUrl(item), target: "_blank", rel: "noopener noreferrer" },
        h("span", { text: "メルカリで探す" }),
        icon(ICON.externalWhite)
      ),
      item.officialUrl &&
        h(
          "a",
          { class: "btn btn--secondary", href: item.officialUrl, target: "_blank", rel: "noopener noreferrer" },
          h("span", { text: "公式サイトを見る" }),
          icon(ICON.external)
        )
    );

    els.detailView.replaceChildren(
      back,
      thumb(item, "detail-image"),
      h(
        "table",
        { class: "info-table" },
        h(
          "tbody",
          {},
          copyRow("商品名", item.name),
          plainRow("メーカー", item.maker),
          plainRow("カテゴリ", item.category),
          plainRow("発売日", item.releaseLabel),
          plainRow("価格", `${formatPrice(item.price)}（税込）`),
          jan,
          plainRow("ラインナップ", `全${lineup.length}種：${lineup.join("／")}`)
        )
      ),
      actions
    );
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // 古いブラウザや http での表示用
      const ta = h("textarea", { readonly: true, style: "position:fixed;top:0;left:0;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-shown"), 1600);
  }

  /* ---------- 画面の切り替え ---------- */

  function openDetail(id) {
    state.listScrollY = window.scrollY;
    state.openedFromList = true;
    location.hash = `#/item/${encodeURIComponent(id)}`;
  }

  // 「もどる」：前の画面（一覧）に戻る。URLを直接開いた人は一覧へ移動
  function goBack() {
    if (state.openedFromList) history.back();
    else location.hash = "#/";
  }

  function route() {
    const match = location.hash.match(/^#\/item\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const item = state.items.find((i) => i.id === id);
      renderDetail(item);
      els.listView.hidden = true;
      els.detailView.hidden = false;
      document.title = item ? `${item.name}｜ガチャとし MEMO` : "ガチャとし MEMO";
      window.scrollTo(0, 0);
    } else {
      els.detailView.hidden = true;
      els.listView.hidden = false;
      document.title = "ガチャとし MEMO";
      fitTitles();
      // 絞り込みはそのまま。スクロール位置を戻す
      window.scrollTo(0, state.listScrollY);
      state.openedFromList = false;
    }
  }

  /* ---------- はじめに ---------- */

  async function init() {
    layoutBinding();
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        layoutBinding();
        fitTitles();
      }).observe(els.notebook);
    } else {
      window.addEventListener("resize", () => {
        layoutBinding();
        fitTitles();
      });
    }

    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const items = await res.json();
      validate(items);
      state.items = items.slice().sort((a, b) => sortKey(b.releaseSort) - sortKey(a.releaseSort));
    } catch (err) {
      console.error(err);
      els.count.textContent = "";
      els.cardList.replaceChildren(h("li", { text: "商品データを読み込めませんでした。" }));
      return;
    }

    state.categories = buildCategories(state.items);
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      saved.filter((c) => state.categories.includes(c)).forEach((c) => state.selected.add(c));
    } catch (_) {
      /* 読めなければ「すべて」 */
    }

    renderChips();
    renderList();
    route();
    window.addEventListener("hashchange", route);

    // Webフォントが届くと文字幅が変わるので、もう一度収め直す
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitTitles(true));
  }

  init();
})();
