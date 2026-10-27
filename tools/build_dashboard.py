#!/usr/bin/env python3
"""Build reports/application-dashboard.html from the tracker, without the model.

/html-report renders the dashboard by having the model re-derive every number
and re-emit the whole page, so the report is only as fresh as the last time
someone remembered to run it. This does the same render in code, following the
/html-report spec (status buckets, drafted rows excluded from stats, funnel
from current status plus outcome.md checkboxes, rejection rate over final
outcomes only, inline-SVG charts, escaped values), so it can run after every
tracker write.

  python tools/build_dashboard.py              rebuild unconditionally
  python tools/build_dashboard.py --if-stale   rebuild only if the tracker, an
                                               outcome.md, or this script is
                                               newer than the dashboard

--if-stale is what the PostToolUse hook calls: it costs a few stat() calls
when nothing changed, and never fails the tool call it follows.

The page reloads itself every 20 seconds while open (keeping filters), so a
browser tab left on it picks up each rebuild without a manual refresh.
"""

import argparse
import csv
import datetime
import glob
import html
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKER = os.path.join(ROOT, "job_search_tracker.csv")
OUTCOMES = os.path.join(ROOT, "documents", "applications", "*", "outcome.md")
DEFAULT_OUT = os.path.join(ROOT, "reports", "application-dashboard.html")

FIELDS = ["date", "company", "sector", "role", "role_type", "channel", "status",
          "contact_person", "fit_rating", "notes", "cv_file", "cover_letter_file",
          "source", "deadline"]

BUCKETS = ["Drafted", "Active", "Interview", "Offer", "Hired", "Rejected/Closed"]
COLORS = {"Drafted": "#64748b", "Active": "#3b82f6", "Interview": "#f59e0b",
          "Offer": "#8b5cf6", "Hired": "#22c55e", "Rejected/Closed": "#ef4444"}
STATUS_MAP = {"drafted": "Drafted", "applied": "Active", "interview": "Interview",
              "offer": "Offer", "hired": "Hired"}
CLOSED = {"rejected", "no_response", "no response", "offer_declined",
          "offer declined", "withdrawn"}
TRUE_REJECTIONS = {"rejected", "no_response", "no response"}
INTERVIEW_STAGES = ["phone screen", "technical interview", "case interview", "final round"]

e = html.escape


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def bucket(status):
    s = (status or "").strip().lower()
    if s in STATUS_MAP:
        return STATUS_MAP[s], None
    return "Rejected/Closed", (None if s in CLOSED else s)


def load_rows():
    with open(TRACKER, encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        next(reader, None)
        rows = []
        for raw in reader:
            if not any(c.strip() for c in raw):
                continue
            rows.append({k: (raw[i].strip() if i < len(raw) else "") for i, k in enumerate(FIELDS)})
    return rows


def load_outcomes():
    out = []
    for path in glob.glob(OUTCOMES):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"^#\s*Outcome:\s*(.+)$", text, re.M)
        ticked = {t.strip().lower() for t in re.findall(r"^\s*-\s*\[[xX]\]\s*([^(\n]+)", text, re.M)}
        out.append({"key": norm(m.group(1)) if m else "", "ticked": ticked})
    return out


def merge(rows, outcomes):
    for r in rows:
        key = norm(r["company"] + r["role"])
        r["ticked"] = next((o["ticked"] for o in outcomes if o["key"] == key), set())


def stage_reached(r):
    s = r["status"].lower()
    t = r["ticked"]
    interview = s in ("interview", "offer", "hired", "offer_declined", "offer declined") \
        or any(st in t for st in INTERVIEW_STAGES) or "offer received" in t
    offer = s in ("offer", "hired", "offer_declined", "offer declined") or "offer received" in t
    return interview, offer, s == "hired"


def hbar_svg(title, items, color_of):
    if not items:
        return f'<div class="chart-card"><h3>{e(title)}</h3><p class="muted">No sent applications yet.</p></div>'
    top = max(v for _, v in items) or 1
    h = 30 * len(items) + 20
    parts = []
    for i, (label, v) in enumerate(items):
        y = 13 + 30 * i
        w = 200.0 * v / top
        parts.append(
            f'<text x="162" y="{y + 12}" text-anchor="end"><title>{e(label)}</title>{e(label[:26])}</text>'
            f'<rect x="170" y="{y}" width="{w:.1f}" height="18" rx="3" fill="{color_of(label)}"><title>{e(label)}: {v}</title></rect>'
            f'<text x="{176 + w:.1f}" y="{y + 13}" class="val">{v}</text>')
    aria = e(f"{title}: " + ", ".join(f"{v} {k}" for k, v in items))
    return (f'<div class="chart-card"><h3>{e(title)}</h3><svg viewBox="0 0 420 {h}" role="img" '
            f'aria-label="{aria}">{"".join(parts)}</svg>')


def doughnut_svg(counts, total, unknown):
    slices = [(b, counts[b]) for b in BUCKETS if counts[b]]
    cx, cy, ro, ri = 90, 90, 80, 50
    parts = []
    if len(slices) == 1:
        b = slices[0][0]
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{(ro + ri) / 2}" fill="none" stroke="{COLORS[b]}" '
                     f'stroke-width="{ro - ri}"><title>{b}: {total}</title></circle>')
    else:
        a0 = -math.pi / 2
        for b, v in slices:
            a1 = a0 + 2 * math.pi * v / total
            large = 1 if a1 - a0 > math.pi else 0
            p = lambda r, a: f"{cx + r * math.cos(a):.2f},{cy + r * math.sin(a):.2f}"
            parts.append(f'<path d="M{p(ro, a0)} A{ro},{ro} 0 {large} 1 {p(ro, a1)} L{p(ri, a1)} '
                         f'A{ri},{ri} 0 {large} 0 {p(ri, a0)} Z" fill="{COLORS[b]}" stroke="#fff" '
                         f'stroke-width="2"><title>{b}: {v}</title></path>')
            a0 = a1
    parts.append(f'<text x="{cx}" y="{cy - 2}" text-anchor="middle" class="big">{total}</text>'
                 f'<text x="{cx}" y="{cy + 16}" text-anchor="middle" class="muted">total</text>')
    for i, (b, v) in enumerate(slices):
        y = 30 + 24 * i
        parts.append(f'<rect x="200" y="{y}" width="12" height="12" rx="2" fill="{COLORS[b]}"/>'
                     f'<text x="218" y="{y + 10}">{b} — {v}</text>')
    aria = "Status breakdown: " + ", ".join(f"{v} {b}" for b, v in slices)
    note = ""
    if unknown:
        note = '<div class="rate">Unrecognised status counted as Rejected/Closed: ' + \
               ", ".join(e(u) for u in sorted(unknown)) + "</div>"
    return (f'<div class="chart-card"><h3>Status breakdown (all rows, incl. drafted)</h3>'
            f'<svg viewBox="0 0 360 180" role="img" aria-label="{e(aria)}">{"".join(parts)}</svg>{note}</div>')


def build(out_path):
    rows = load_rows()
    merge(rows, load_outcomes())
    today = datetime.date.today().isoformat()

    counts = {b: 0 for b in BUCKETS}
    unknown = set()
    for r in rows:
        r["bucket"], unk = bucket(r["status"])
        counts[r["bucket"]] += 1
        if unk:
            unknown.add(unk)
    sent = [r for r in rows if r["bucket"] != "Drafted"]

    def tally(key):
        d = {}
        for r in sent:
            k = r[key] or "(none)"
            d[k] = d.get(k, 0) + 1
        return sorted(d.items(), key=lambda kv: (-kv[1], kv[0].lower()))

    reached = [stage_reached(r) for r in sent]
    n_int = sum(1 for i, _, _ in reached if i)
    n_off = sum(1 for _, o, _ in reached if o)
    n_hir = sum(1 for _, _, h in reached if h)
    finals = [r for r in sent if r["status"].lower() in CLOSED | {"hired"}]
    rejections = sum(1 for r in finals if r["status"].lower() in TRUE_REJECTIONS)
    pct = f"{round(100 * n_int / len(sent))}%" if sent else "n/a"
    rej = f"{round(100 * rejections / len(finals))}%" if finals else "n/a"

    cards = [("Sent", len(sent), "#0f172a")] + [(b, counts[b], COLORS[b]) for b in BUCKETS]
    cards_html = "".join(f'<div class="card" style="--c:{c}"><div class="num">{n}</div>'
                         f'<div class="lbl">{e(lbl)}</div></div>' for lbl, n, c in cards)

    funnel = [("Applied", len(sent)), ("Interview", n_int), ("Offer", n_off), ("Hired", n_hir)]
    fcol = {"Applied": COLORS["Active"], "Interview": COLORS["Interview"],
            "Offer": COLORS["Offer"], "Hired": COLORS["Hired"]}
    funnel_html = hbar_svg("Application funnel", funnel if sent else [], fcol.get)
    if sent:
        funnel_html += f'<div class="rate">{pct} progressed past resume screen · Rejection rate: {rej} (of applications with a final outcome)</div></div>'
    elif not funnel_html.endswith("</div>"):
        funnel_html += "</div>"

    def closed(s):
        return s if s.endswith("</div>") else s + "</div>"

    charts = (doughnut_svg(counts, len(rows), unknown)
              + closed(hbar_svg("By sector (sent)", tally("sector"), lambda _: COLORS["Active"]))
              + closed(hbar_svg("By channel (sent)", tally("channel"), lambda _: "#0ea5e9"))
              + funnel_html)

    show_deadline = any(r["deadline"] for r in rows)
    rows_sorted = sorted(rows, key=lambda r: r["company"].lower())
    rows_sorted.sort(key=lambda r: r["date"], reverse=True)

    def cell(v):
        return e(v) if v else "—"

    body = []
    for r in rows_sorted:
        notes = r["notes"]
        notes_html = (f'<span title="{e(notes)}">{e(notes[:80])}…</span>' if len(notes) > 80
                      else cell(notes))
        src = r["source"]
        src_html = (f'<a href="{e(src)}" target="_blank" rel="noopener noreferrer">link ↗</a>'
                    if src.lower().startswith("http") else cell(src))
        search = e(" ".join([r["company"], r["role"], r["sector"]]).lower())
        body.append(
            f'<tr data-status="{r["bucket"]}" data-sector="{e(r["sector"])}" data-search="{search}">'
            f'<td>{cell(r["date"])}</td>' + (f'<td>{cell(r["deadline"])}</td>' if show_deadline else "")
            + f'<td>{cell(r["company"])}</td><td>{cell(r["role"])}</td><td>{cell(r["sector"])}</td>'
            f'<td>{cell(r["channel"])}</td><td><span class="pill" style="--c:{COLORS[r["bucket"]]}">{r["bucket"]}</span></td>'
            f'<td class="fit">{cell(r["fit_rating"])}</td><td>{notes_html}</td><td>{src_html}</td></tr>')

    status_opts = "".join(f"<option>{b}</option>" for b in BUCKETS if counts[b])
    sectors = sorted({r["sector"] for r in rows}, key=str.lower)
    sector_opts = "".join(f'<option value="{e(s)}">{e(s) if s else "(none)"}</option>' for s in sectors)
    head = "<th>Date</th>" + ("<th>Deadline</th>" if show_deadline else "") + \
        "<th>Company</th><th>Role</th><th>Sector</th><th>Channel</th><th>Status</th><th>Fit</th><th>Notes</th><th>Source</th>"

    page = TEMPLATE.format(today=today, cards=cards_html, charts=charts, status_opts=status_opts,
                           sector_opts=sector_opts, head=head, body="".join(body))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    os.replace(tmp, out_path)
    return len(rows), len(sent)


def is_stale(out_path):
    if not os.path.exists(out_path):
        return True
    built = os.path.getmtime(out_path)
    sources = [TRACKER, os.path.abspath(__file__)] + glob.glob(OUTCOMES)
    return any(os.path.getmtime(p) > built for p in sources if os.path.exists(p))


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Search Dashboard</title>
<style>
:root{{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--alt:#f8fafc}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
.wrap{{max-width:1240px;margin:0 auto;padding:24px 16px}}
header{{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:20px}}
h1{{margin:0;font-size:24px}} h2{{font-size:18px;margin:0}} h3{{margin:0 0 10px;font-size:15px}}
.muted{{color:var(--muted)}} .small{{font-size:12px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}}
.card{{background:var(--card);border-radius:8px;box-shadow:0 1px 3px rgba(15,23,42,.08);border-left:5px solid var(--c);padding:14px 16px}}
.num{{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}} .lbl{{color:var(--muted)}}
.charts{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}}
@media (max-width:900px){{.charts{{grid-template-columns:1fr}}}}
.chart-card{{background:var(--card);border-radius:8px;box-shadow:0 1px 3px rgba(15,23,42,.08);padding:16px}}
.chart-card svg{{width:100%;max-height:260px;font-size:12px;fill:var(--ink)}}
svg .big{{font-size:28px;font-weight:700}} svg .muted{{fill:var(--muted)}} svg .val{{font-weight:600;font-variant-numeric:tabular-nums}}
.rate{{margin-top:6px;color:var(--muted);font-size:13px}}
.panel{{background:var(--card);border-radius:8px;box-shadow:0 1px 3px rgba(15,23,42,.08);padding:16px}}
.toolbar{{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}}
.toolbar h2{{margin-right:auto}}
select,input{{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:#fff}}
.tbl{{overflow-x:auto}}
table{{width:100%;border-collapse:collapse;min-width:900px}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);background:var(--alt)}}
tbody tr:nth-child(even of :not([hidden])){{background:var(--alt)}}
td:first-child{{white-space:nowrap;font-variant-numeric:tabular-nums}} .fit{{font-variant-numeric:tabular-nums}}
.pill{{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;background:var(--c);white-space:nowrap}}
a{{color:#2563eb}}
footer{{text-align:center;color:var(--muted);font-size:12px;margin-top:20px}}
</style></head><body><div class="wrap">
<header><h1>🔍 Job Search Dashboard</h1><span class="muted">Generated: {today} · auto-refreshes</span></header>
<section class="cards">{cards}</section>
<section class="charts">
{charts}
</section>
<section class="panel">
<div class="toolbar"><h2>Applications</h2>
<select id="fStatus" aria-label="Filter by status"><option value="">All statuses</option>{status_opts}</select>
<select id="fSector" aria-label="Filter by sector"><option value="">All sectors</option>{sector_opts}</select>
<input id="fText" type="search" placeholder="🔍 Search company, role, sector" aria-label="Search"></div>
<div class="tbl"><table><thead><tr>{head}</tr></thead>
<tbody>{body}</tbody></table></div>
<p class="muted small" id="count"></p>
</section>
<footer>Generated by Claude Code · ai-job-search · {today}</footer>
</div>
<script>
(function(){{
  var s=document.getElementById('fStatus'),c=document.getElementById('fSector'),t=document.getElementById('fText'),
      rows=[].slice.call(document.querySelectorAll('tbody tr')),n=document.getElementById('count'),K='dash-filters';
  try{{var saved=JSON.parse(sessionStorage.getItem(K)||'null');if(saved){{s.value=saved[0];c.value=saved[1];t.value=saved[2];window.scrollTo(0,saved[3]||0);}}}}catch(_){{}}
  function go(){{
    var q=t.value.trim().toLowerCase(),shown=0;
    rows.forEach(function(r){{
      var ok=(!s.value||r.dataset.status===s.value)&&(!c.value||r.dataset.sector===c.value)&&(!q||r.dataset.search.indexOf(q)>-1);
      r.hidden=!ok; if(ok)shown++;
    }});
    n.textContent=shown+' of '+rows.length+' rows';
  }}
  [s,c].forEach(function(el){{el.addEventListener('change',go)}}); t.addEventListener('input',go); go();
  setInterval(function(){{
    if(document.activeElement===t||document.hidden)return;
    try{{sessionStorage.setItem(K,JSON.stringify([s.value,c.value,t.value,window.scrollY]));}}catch(_){{}}
    location.reload();
  }},20000);
}})();
</script></body></html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out", nargs="?", default=DEFAULT_OUT)
    ap.add_argument("--if-stale", action="store_true")
    a = ap.parse_args()
    if not os.path.exists(TRACKER):
        return 0
    if a.if_stale and not is_stale(a.out):
        return 0
    total, sent = build(a.out)
    print(f"dashboard rebuilt: {total} rows ({sent} sent) -> {os.path.relpath(a.out, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
