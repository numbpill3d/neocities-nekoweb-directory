#!/usr/bin/env python3
import json, os, re, sys, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
import html
import requests

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_PATH = os.path.join(ROOT_DIR, "data", "sites.json")
SUPP_PATH = os.path.join(ROOT_DIR, "data", "supplemental_sites.json")
INDEX_PATH = os.path.join(ROOT_DIR, "index.html")
ROBOTS_PATH = os.path.join(ROOT_DIR, "robots.txt")
SITEMAP_PATH = os.path.join(ROOT_DIR, "sitemap.xml")

UA = "retro-site-directory/1.0 (+https://github.com/numbpill3d/neocities-nekoweb-directory)"


def http_get(url, timeout=20):
    r = requests.get(url, headers={"user-agent": UA}, timeout=timeout)
    r.raise_for_status()
    return r


def read_supplemental() -> List[Dict[str, Any]]:
    try:
        with open(SUPP_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return []
    if not isinstance(raw, list):
        raise ValueError("supplemental_sites.json must be a list")
    out = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"site {i} must be an object")
        name = str(item.get("name") or "").strip()
        url = str(item.get("url") or "").strip().rstrip("/")
        if not url:
            raise ValueError(f"site {i} needs url")
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError(f"site {i} url must be https")
        out.append({
            "name": name,
            "url": url,
            "description": str(item.get("description") or "").strip(),
            "category": str(item.get("category") or "other").strip(),
            "tags": [str(t).strip() for t in (item.get("tags") or []) if str(t).strip()],
            "source": str(item.get("source") or "supplemental").strip(),
            "button": item.get("button"),
            "last_updated": item.get("last_updated"),
        })
    return out


def meta_from_html(url: str) -> Dict[str, Any]:
    out = {"title": None, "description": None, "image": None, "last_modified": None}
    try:
        r = http_get(url)
        out["last_modified"] = r.headers.get("last-modified")
        text = r.text
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        if m:
            out["title"] = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
        for pat in [
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
            r'<meta[^>]+content=["\'](.*?)["\'][^>]+name=["\']description["\']',
            r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']',
            r'<meta[^>]+content=["\'](.*?)["\'][^>]+property=["\']og:description["\']',
        ]:
            m = re.search(pat, text, re.I | re.S)
            if m:
                out["description"] = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()
                break
        for pat in [
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\'](.*?)["\']',
            r'<meta[^>]+content=["\'](.*?)["\'][^>]+property=["\']og:image["\']',
        ]:
            m = re.search(pat, text, re.I | re.S)
            if m:
                out["image"] = m.group(1).strip()
                break
    except Exception as exc:
        print(f"fetch failed for {url}: {exc}", file=sys.stderr)
    return out


def normalize_url(u):
    return u.strip().rstrip("/").lower()


def main() -> int:
    print("loading supplemental sites…", file=sys.stderr)
    sites = read_supplemental()
    print(f"supplemental: {len(sites)}", file=sys.stderr)

    seen = set()
    out: List[Dict[str, Any]] = []
    for s in sites:
        key = normalize_url(s["url"])
        if key in seen:
            continue
        seen.add(key)
        meta = meta_from_html(s["url"])
        name = s["name"] or meta.get("title") or urlparse(s["url"]).netloc
        desc = s["description"] or meta.get("description") or ""
        last = s["last_updated"]
        if not last:
            last = meta.get("last_modified") or datetime.now(timezone.utc).isoformat(timespec="seconds")
        out.append({
            "name": name,
            "url": s["url"],
            "description": desc,
            "category": s["category"] or "other",
            "tags": s["tags"],
            "source": s["source"],
            "button": s.get("button"),
            "last_updated": last,
        })

    # sort by name
    out.sort(key=lambda x: (x["name"] or "").lower())

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {"generated_at": generated_at, "count": len(out), "sites": out}

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # prerender
    try:
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            raw = f.read()
        start = "<!-- prerender:start -->"
        end = "<!-- prerender:end -->"
        if start in raw and end in raw:
            before, rest = raw.split(start, 1)
            _, after = rest.split(end, 1)
            parts = []
            for s in out[:80]:
                parts.append(
                    '<div class="item"><div class="top"><a class="name" href="{url}">{name}</a> <span class="badge">prerender</span></div>'
                    '<div class="desc">{desc}</div></div>'.format(
                        url=html.escape(s["url"]),
                        name=html.escape(s["name"]),
                        desc=html.escape(s["description"]),
                    )
                )
            prerender = "\n".join(parts) if parts else '<div class="fine">no data yet.</div>'
            new_raw = before + start + "\n" + prerender + "\n        " + end + after
            with open(INDEX_PATH, "w", encoding="utf-8") as f:
                f.write(new_raw)
    except FileNotFoundError:
        pass

    # robots + sitemap
    site_url = (os.environ.get("SITE_URL") or "").strip()
    if not site_url:
        owner = (os.environ.get("GITHUB_REPOSITORY_OWNER") or "").strip()
        repo_full = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
        repo = repo_full.split("/", 1)[1] if "/" in repo_full else ""
        if owner and repo:
            site_url = f"https://{owner}.github.io/{repo}/" if repo != f"{owner}.github.io" else f"https://{owner}.github.io/"
    if site_url:
        robots = "User-agent: *\nAllow: /\n\nSitemap: " + site_url.rstrip("/") + "/sitemap.xml\n"
        with open(ROBOTS_PATH, "w", encoding="utf-8") as f:
            f.write(robots)
        lastmod = generated_at.split("T", 1)[0]
        urls = [site_url, site_url.rstrip("/") + "/data/sites.json"]
        items = "\n".join(f"  <url>\n    <loc>{html.escape(u)}</loc>\n    <lastmod>{lastmod}</lastmod>\n  </url>" for u in urls)
        sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + items + "\n</urlset>\n"
        with open(SITEMAP_PATH, "w", encoding="utf-8") as f:
            f.write(sitemap)

    print(f"wrote {OUT_PATH} ({len(out)} sites)", file=sys.stderr)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
