#!/usr/bin/env python3
"""Refresh Home Depot / Lowe's unit prices into prices.json.

Home Depot and Lowe's return HTTP 403 to simple scripts. This file:
  1. Tries a live fetch anyway (in case a cookie/browser session works later).
  2. Writes prices.json from whatever it can parse.
  3. Prints search URLs so you can paste prices into prices.csv and re-run
     with --from-csv.

Usage (from this folder):
  python update_prices.py
  python update_prices.py --from-csv prices.csv
  python update_prices.py --open   (opens HD/Lowe's search pages in the browser)
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG = HERE / "catalog.json"
PRICES = HERE / "prices.json"
CSV_PATH = HERE / "prices.csv"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
CTX = ssl._create_unverified_context()


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_prices(data: dict) -> None:
    data["updated"] = date.today().isoformat()
    text = json.dumps(data, indent=2)
    PRICES.write_text(text, encoding="utf-8")
    (HERE / "prices.js").write_text(
        "window.HJ_PRICES = " + text + ";\n", encoding="utf-8"
    )
    print("Wrote", PRICES, "and prices.js")


def fetch(url: str, timeout: int = 20) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/json,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace") if e.fp else ""
        return e.code, body
    except Exception as e:
        return 0, str(e)


def first_price(html: str) -> float | None:
    # JSON-LD
    for m in re.finditer(
        r'"price"\s*:\s*"?(?:USD)?\s*([0-9]+(?:\.[0-9]{2})?)"?', html, re.I
    ):
        val = float(m.group(1))
        if 0.2 < val < 5000:
            return val
    # visible $x.xx near "current"
    m = re.search(
        r'itemprop="price"[^>]*content="([0-9]+(?:\.[0-9]{2})?)"', html, re.I
    )
    if m:
        return float(m.group(1))
    dollars = [float(x) for x in re.findall(r"\$([0-9]+\.[0-9]{2})", html)]
    dollars = [d for d in dollars if 0.5 < d < 800]
    if dollars:
        # modal ads skew high; take a low-ish in-range value
        dollars.sort()
        return dollars[len(dollars) // 4]
    return None


def set_price(data: dict, keypath: str, store: str, value: float) -> None:
    table, item = keypath.split(":", 1)
    data.setdefault(table, {}).setdefault(item, {})
    data[table][item][store] = f"{value:.2f}"


def try_live(data: dict, catalog: dict) -> int:
    got = 0
    blocked = 0
    for item in catalog.get("items", []):
        for store, url_key in (("hd", "hd_url"), ("lw", "lw_url")):
            url = item.get(url_key)
            if not url:
                continue
            status, html = fetch(url)
            price = first_price(html) if status == 200 else None
            tag = item.get("name", url)[:60]
            if price is None:
                print(f"  {store.upper()} {status}  no price  {tag}")
                if status in (403, 401, 429):
                    blocked += 1
                continue
            print(f"  {store.upper()} ${price:.2f}  {tag}")
            for kp in item.get("keys", []):
                # skip dual-key dummy rows that mention p6 on p4 fetch
                if "p6" in kp and "4x4" in (item.get("name") or ""):
                    continue
                set_price(data, kp, store, price)
            got += 1
    print(f"Live fetch: {got} prices, {blocked} blocked")
    return got


def from_csv(data: dict, path: Path) -> int:
    n = 0
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            kp = (row.get("key") or "").strip()
            if not kp or ":" not in kp:
                continue
            for store in ("hd", "lw", "ml"):
                raw = (row.get(store) or "").strip().replace("$", "")
                if not raw:
                    continue
                try:
                    set_price(data, kp, store, float(raw))
                    n += 1
                except ValueError:
                    pass
    print(f"CSV applied {n} cells from {path}")
    return n


def write_csv_template(catalog: dict, data: dict) -> None:
    rows = []
    seen = set()
    for item in catalog.get("items", []):
        for kp in item.get("keys", []):
            if kp in seen:
                continue
            seen.add(kp)
            table, iid = kp.split(":", 1)
            cur = data.get(table, {}).get(iid, {})
            rows.append(
                {
                    "key": kp,
                    "name": item.get("name", ""),
                    "hd": cur.get("hd", ""),
                    "lw": cur.get("lw", ""),
                    "ml": cur.get("ml", ""),
                    "hd_url": item.get("hd_url", ""),
                    "lw_url": item.get("lw_url", ""),
                }
            )
    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["key", "name", "hd", "lw", "ml", "hd_url", "lw_url"]
        )
        w.writeheader()
        w.writerows(rows)
    print("CSV template", CSV_PATH)


def open_urls(catalog: dict) -> None:
    import webbrowser

    for item in catalog.get("items", []):
        for k in ("hd_url", "lw_url"):
            if item.get(k):
                webbrowser.open(item[k])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-csv", type=Path, default=None)
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--no-fetch", action="store_true")
    args = ap.parse_args()

    catalog = load_json(CATALOG, {"items": []})
    data = load_json(PRICES, {})
    if args.open:
        open_urls(catalog)
        return 0
    if args.from_csv:
        from_csv(data, args.from_csv)
        data["source"] = f"Merged from {args.from_csv.name}"
        save_prices(data)
        write_csv_template(catalog, data)
        return 0
    if not args.no_fetch:
        n = try_live(data, catalog)
        if n == 0:
            print(
                "\nHD/Lowe's blocked the script (usual). Keep prices.json as-is,\n"
                "or fill prices.csv and run:  python update_prices.py --from-csv prices.csv\n"
                "or:  python update_prices.py --open   to click through search pages.\n"
            )
            data.setdefault(
                "source",
                "Live fetch blocked (HTTP 403). Existing prices.json left in place.",
            )
    write_csv_template(catalog, data)
    save_prices(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
