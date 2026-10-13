#!/usr/bin/env python3
"""
classify_theme.py — assign a theme to every data point in data/insights.json.

Two-stage cascade:
  1. Jev (TypeSafe System One) classifies each item with a confidence score.
  2. Items below CONF_GATE are escalated to Codex, which judges them as a batch.

Usage:
  python3 classify_theme.py            # classify only items missing a theme
  python3 classify_theme.py --force    # reclassify everything

Requires TYPESAFE_API_KEY in /root/.hermes/secrets/typesafe.env and a working
`codex` CLI. Writes `theme` + `theme_source` onto every data point.
"""
import argparse
import collections
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data" / "insights.json"
CONF_GATE = 0.60
BATCH = 50
SCHEMA = Path("/tmp/theme_schema.json")

THEME_DEFS = """scale_headcount - counts of people or entities (employees, users, followers, creators, customers, drivers, companies)
money_raised_valuation - funding raised, investment amounts, valuations, cheque sizes
price_revenue_spend - prices, costs, fees, commissions, revenue, spend, margins, order values, payments
time_tenure - durations, tenures, time horizons, elapsed time, how long something took
growth_multiples - growth rates, multipliers, how many times something increased
operations_volume - operational throughput (orders per day, calls, capacity, store area, units supplied)
macro_economy - country or economy level statistics (share of global economy, employment, population sentiment, inflation, GDP)
audience_mix_share - percentage splits or shares of a whole (audience composition, revenue attribution mix, adoption rate of a practice)
market_rank_size - market or industry size, total addressable size, rank among markets"""

# Display labels and order for the site's theme tabs
THEME_ORDER = [
    ("scale_headcount", "Scale & headcount"),
    ("price_revenue_spend", "Prices, revenue & spend"),
    ("audience_mix_share", "Audience mix & shares"),
    ("time_tenure", "Time & tenure"),
    ("money_raised_valuation", "Money raised & valuations"),
    ("operations_volume", "Operations & volume"),
    ("macro_economy", "Macro & economy"),
    ("growth_multiples", "Growth & multiples"),
    ("market_rank_size", "Market rank & size"),
]
THEME_LABELS = dict(THEME_ORDER)


def jev_key():
    env = Path("/root/.hermes/secrets/typesafe.env").read_text()
    for line in env.splitlines():
        if line.startswith("TYPESAFE_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ERROR: TYPESAFE_API_KEY not found")


def jev_classify(item, key):
    state = {
        "metric": item.get("metric") or "",
        "value": str(item.get("value") or ""),
        "unit": item.get("unit") or "",
        "context": (item.get("context") or "")[:400],
    }
    body = json.dumps({
        "state": state,
        "model": "jev-latest",
        "questions": {"theme": {
            "type": "choice",
            "criteria": {
                t.split(" - ")[0]: {"what": t.split(" - ", 1)[1]}
                for t in THEME_DEFS.splitlines()
            },
            "instructions": "What kind of number is this metric describing? Pick the best single category.",
        }},
    }).encode()
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone", data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=60))
            ans = r["answers"]["theme"]
            return ans["choice"], float(ans.get("confidence", 0.0))
        except Exception:
            if attempt == 3:
                return None, 0.0
            time.sleep(2 ** attempt)
    return None, 0.0


def codex_classify(indices, items):
    payload = [{
        "i": i,
        "metric": it.get("metric") or "",
        "value": str(it.get("value") or ""),
        "unit": it.get("unit") or "",
        "context": (it.get("context") or "")[:300],
    } for i, it in zip(indices, items)]
    prompt = (
        "You are classifying data points from a podcast into exactly one theme each.\n\n"
        f"THEMES (pick exactly one per item):\n{THEME_DEFS}\n\n"
        "Classify every item below. Judge by what KIND of number the metric describes, "
        "not by the topic. For example 'growth rate sustainable for India = 6%' is a "
        "country-level economic statistic, so macro_economy, not growth_multiples.\n\n"
        f"ITEMS:\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Return classifications for every index."
    )
    out = f"/tmp/theme_batch_{indices[0]}.json"
    cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "read-only",
           "--output-schema", str(SCHEMA), "-o", out, prompt]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=900, cwd=str(HERE))
        return {c["i"]: c["theme"] for c in json.load(open(out))["classifications"]}
    except Exception as e:
        print(f"  codex batch failed: {e}", file=sys.stderr)
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    db = json.loads(DATA.read_text())
    dps = db["items"]["data_points"]
    key = jev_key()

    todo = list(range(len(dps))) if a.force else [
        i for i, x in enumerate(dps) if not x.get("theme")]
    print(f"{len(todo)} of {len(dps)} to classify")

    escalations = []
    for i in todo:
        theme, conf = jev_classify(dps[i], key)
        if theme is None:
            escalations.append(i)
            continue
        dps[i]["theme"] = theme
        dps[i]["theme_source"] = "jev" if conf >= CONF_GATE else "codex"
        if conf < CONF_GATE:
            escalations.append(i)
        if (i + 1) % 50 == 0:
            print(f"  jev {i+1}/{len(dps)}", flush=True)
            DATA.write_text(json.dumps(db, ensure_ascii=False, indent=1))

    print(f"jev done; {len(escalations)} need codex")
    for start in range(0, len(escalations), BATCH):
        chunk = escalations[start:start + BATCH]
        got = codex_classify(chunk, [dps[i] for i in chunk])
        for i in chunk:
            if i in got:
                dps[i]["theme"] = got[i]
                dps[i]["theme_source"] = "codex"
        print(f"  codex batch {start}: {len(got)}/{len(chunk)}", flush=True)

    DATA.write_text(json.dumps(db, ensure_ascii=False, indent=1))
    c = collections.Counter(x.get("theme") for x in dps)
    print("\nfinal distribution:")
    for t, _ in THEME_ORDER:
        print(f"  {c.get(t,0):4d}  {THEME_LABELS[t]}")
    missing = [i for i, x in enumerate(dps) if not x.get("theme")]
    print(f"\nunclassified: {len(missing)}")
    os.remove("/tmp/theme_schema.json") if SCHEMA.exists() else None


if __name__ == "__main__":
    main()
