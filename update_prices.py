#!/usr/bin/env python3
"""Refresh Home Depot / Lowe's unit prices into prices.json.

Why you get 403 from home *and* a DigitalOcean droplet
-------------------------------------------------------
Home Depot and Lowe's sit behind Akamai Bot Manager. They look at the TLS
handshake (JA3/JA4), not just User-Agent. Python urllib, requests, and stock
curl all look like bots, so Akamai returns 403 before any HTML. A droplet
IP is also a known datacenter range, which they often refuse even from
Chrome. That is normal in 2026, not a bug in this script.

What actually works
-------------------
  pip install curl_cffi
  python update_prices.py              # impersonates Chrome TLS

  pip install playwright
  python -m playwright install chromium
  python update_prices.py --browser    # real Chromium (best at home)

  python update_prices.py --from-csv prices.csv
  python update_prices.py --open
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG = HERE / "catalog.json"
PRICES = HERE / "prices.json"
CSV_PATH = HERE / "prices.csv"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
CTX = ssl._create_unverified_context()


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_prices(data: dict, bump_date: bool = True) -> None:
    if bump_date:
        data["updated"] = date.today().isoformat()
    text = json.dumps(data, indent=2)
    PRICES.write_text(text, encoding="utf-8")
    (HERE / "prices.js").write_text(
        "window.HJ_PRICES = " + text + ";\n", encoding="utf-8"
    )
    print("Wrote", PRICES, "and prices.js")


def first_price(html: str) -> float | None:
    if not html:
        return None
    if "Access Denied" in html and "Akamai" in html:
        return None
    if "<title>Error Page</title>" in html:
        return None
    for m in re.finditer(
        r'"price"\s*:\s*"?(?:USD)?\s*([0-9]+(?:\.[0-9]{2})?)"?', html, re.I
    ):
        val = float(m.group(1))
        if 0.2 < val < 5000:
            return val
    m = re.search(
        r'itemprop="price"[^>]*content="([0-9]+(?:\.[0-9]{2})?)"', html, re.I
    )
    if m:
        return float(m.group(1))
    m = re.search(r'"currentPrice"\s*:\s*([0-9]+(?:\.[0-9]{2})?)', html)
    if m:
        return float(m.group(1))
    dollars = [float(x) for x in re.findall(r"\$([0-9]+\.[0-9]{2})", html)]
    dollars = [d for d in dollars if 0.5 < d < 800]
    if dollars:
        dollars.sort()
        return dollars[len(dollars) // 4]
    return None


def fetch_urllib(url: str) -> tuple[int, str, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25, context=CTX) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), ""
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace") if e.fp else ""
        server = e.headers.get("Server", "") if e.headers else ""
        return e.code, body, server
    except Exception as e:
        return 0, str(e), ""


def fetch_cffi(url: str) -> tuple[int, str, str]:
    from curl_cffi import requests as creq

    r = creq.get(
        url,
        impersonate="chrome",
        timeout=30,
        headers={"Accept-Language": "en-US,en;q=0.9"},
    )
    server = r.headers.get("Server", "")
    return r.status_code, r.text, server


def fetch_playwright_session(urls: list[str]) -> dict[str, tuple[int, str]]:
    from playwright.sync_api import sync_playwright

    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            locale="en-US",
            timezone_id="America/Chicago",
            viewport={"width": 1366, "height": 768},
            user_agent=UA,
        )
        page = ctx.new_page()
        page.goto("https://www.homedepot.com/", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        for url in urls:
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(1800)
                status = resp.status if resp else 0
                out[url] = (status, page.content())
            except Exception as e:
                out[url] = (0, str(e))
            time.sleep(0.8)
        browser.close()
    return out


def set_price(data: dict, keypath: str, store: str, value: float) -> None:
    table, item = keypath.split(":", 1)
    data.setdefault(table, {}).setdefault(item, {})
    data[table][item][store] = f"{value:.2f}"


def explain_block(server: str) -> None:
    print(
        "\nBlocked on purpose by the store, not by this script.\n"
        "  Server header: {}\n"
        "  Home Depot / Lowe's use Akamai Bot Manager. They fingerprint TLS.\n"
        "  Python urllib, requests, and plain curl fail from home fiber AND\n"
        "  from a DigitalOcean droplet. Droplet IPs are datacenter ranges.\n"
        "\n"
        "  At home, try a real browser:\n"
        "    pip install playwright\n"
        "    python -m playwright install chromium\n"
        "    python update_prices.py --browser\n"
        "  Or lighter TLS impersonation (sometimes enough on residential IP):\n"
        "    pip install curl_cffi\n"
        "    python update_prices.py\n"
        "  Or paste prices:\n"
        "    python update_prices.py --from-csv prices.csv\n".format(
            server or "(none)"
        )
    )


def try_live(data: dict, catalog: dict, mode: str) -> int:
    items = catalog.get("items", [])
    urls = []
    jobs = []
    for item in items:
        for store, url_key in (("hd", "hd_url"), ("lw", "lw_url")):
            url = item.get(url_key)
            if url:
                jobs.append((item, store, url))
                urls.append(url)

    pw_pages = {}
    if mode == "browser":
        print("Opening Chromium (this takes a minute)…")
        try:
            pw_pages = fetch_playwright_session(urls)
        except ImportError:
            print("Playwright not installed. pip install playwright && python -m playwright install chromium")
            return 0

    got = 0
    blocked = 0
    last_server = ""
    cffi_ok = None
    if mode != "browser":
        try:
            import curl_cffi  # noqa: F401

            cffi_ok = True
            print("Using curl_cffi Chrome TLS impersonation")
        except ImportError:
            cffi_ok = False
            print("curl_cffi not installed — urllib will almost certainly 403. pip install curl_cffi")

    for item, store, url in jobs:
        tag = item.get("name", url)[:60]
        if mode == "browser":
            status, html = pw_pages.get(url, (0, ""))
            server = ""
        elif cffi_ok:
            try:
                status, html, server = fetch_cffi(url)
            except Exception as e:
                status, html, server = 0, str(e), ""
        else:
            status, html, server = fetch_urllib(url)
        if server:
            last_server = server
        price = first_price(html) if status == 200 else None
        if price is None:
            print(f"  {store.upper()} {status}  no price  {tag}" + (f"  [{server}]" if server else ""))
            if status in (403, 401, 429):
                blocked += 1
            continue
        print(f"  {store.upper()} ${price:.2f}  {tag}")
        for kp in item.get("keys", []):
            if "p6" in kp and "4x4" in (item.get("name") or ""):
                continue
            set_price(data, kp, store, price)
        got += 1
        time.sleep(0.35)
    print(f"Live fetch: {got} prices, {blocked} blocked")
    if got == 0 and blocked:
        explain_block(last_server)
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
    ap.add_argument("--browser", action="store_true", help="Use Chromium (Playwright)")
    args = ap.parse_args()

    catalog = load_json(CATALOG, {"items": []})
    data = load_json(PRICES, {})
    if args.open:
        open_urls(catalog)
        return 0
    if args.from_csv:
        from_csv(data, args.from_csv)
        data["source"] = f"Merged from {args.from_csv.name}"
        save_prices(data, bump_date=True)
        write_csv_template(catalog, data)
        return 0
    if not args.no_fetch:
        n = try_live(data, catalog, "browser" if args.browser else "http")
        if n:
            data["source"] = (
                "Live fetch "
                + date.today().isoformat()
                + (" (Playwright)" if args.browser else " (curl_cffi/urllib)")
            )
            save_prices(data, bump_date=True)
        else:
            print("Left prices.json unchanged (no live prices).")
    write_csv_template(catalog, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
