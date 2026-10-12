#!/usr/bin/env python3
"""Merge data/insights/batch_*.json into the single data/insights.json the site loads.

Joins each episode against episode_numbers.json + nikhil_ids.txt (from the
private transcript repo) so every insight carries its episode number, series,
guest, and title. Usage: python3 build_data.py
"""
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"

# episode numbers / series / clean titles (keyed by real YouTube video id)
NUM = json.loads((DATA / "episode_numbers.json").read_text(encoding="utf-8")) \
    if (DATA / "episode_numbers.json").exists() else {}

# filename slug (used as video_id inside batch files) -> real YouTube video id
SLUG2VID = json.loads((DATA / "transcript_to_videoid.json").read_text(encoding="utf-8")) \
    if (DATA / "transcript_to_videoid.json").exists() else {}

PRIVATE_REPO = "https://github.com/light-saber/nikhil-kamath-wtf-transcripts"

TITLES = {}
for real_id, meta in NUM.items():
    if meta.get("title"):
        TITLES[real_id] = meta["title"]

# normalize tag variants so the taxonomy stays clean
TAG_ALIASES = {
    "e-commerce": "ecommerce",
    "ecommerce": "ecommerce",
    "consumer-electronics": "consumer-tech",
    "venture-capital": "vc",
    "social-media": "media",
    "public-service": "government",
    "craft-beverages": "alcohol",
    "food": "food-and-beverage",
    "coffee": "food-and-beverage",
    "nutrition": "food-and-beverage",
    "hospitality": "travel",
    "tourism": "travel",
    "aviation": "travel",
    "fitness": "healthcare",
    "longevity": "healthcare",
}


def norm_tag(t):
    if not t:
        return None
    t = str(t).strip().lower()
    t = TAG_ALIASES.get(t, t)
    return t or None


def main():
    batches = sorted(DATA.glob("insights/batch_*.json"))
    if not batches:
        print("no batches found")
        return 1

    episodes = {}
    for b in batches:
        for ep in json.loads(b.read_text(encoding="utf-8")):
            slug = ep.get("video_id")
            if not slug:
                continue
            vid = SLUG2VID.get(slug, slug)
            meta = NUM.get(vid, {})
            ep_out = {
                "video_id": vid,
                "episode": meta.get("num"),
                "series": meta.get("series"),
                "title": meta.get("clean") or TITLES.get(vid, ""),
                "raw_title": meta.get("title") or TITLES.get(vid, ""),
                "guests": ep.get("guests", []),
                "industries": ep.get("industries", []),
                "geographies": ep.get("geographies", []),
                "youtube": f"https://www.youtube.com/watch?v={vid}",
                "insights": [], "data_points": [], "quotes": [], "ideas": [],
                "stories": [],
            }
            for kind in ("insights", "data_points", "quotes", "ideas", "stories"):
                for item in ep.get(kind, []):
                    item = dict(item)
                    item["video_id"] = vid
                    item["episode"] = meta.get("num")
                    item["series"] = meta.get("series")
                    item["episode_title"] = ep_out["title"]
                    if item.get("industry"):
                        item["industry"] = norm_tag(item["industry"])
                    if item.get("geography"):
                        item["geography"] = norm_tag(item["geography"])
                    ep_out[kind].append(item)
            ep_out["industries"] = [t for t in (norm_tag(x) for x in ep.get("industries", [])) if t]
            ep_out["geographies"] = [t for t in (norm_tag(x) for x in ep.get("geographies", [])) if t]
            episodes[vid] = ep_out

    if not episodes:
        print("no episodes parsed")
        return 1

    # tag every item with its episode title for cross-episode views
    all_items = {"insights": [], "data_points": [], "quotes": [], "ideas": [],
                 "stories": []}
    for ep in episodes.values():
        for kind in all_items:
            all_items[kind].extend(ep[kind])

    industries = defaultdict(lambda: {"count": 0, "episodes": set(),
                                      "insights": 0, "data_points": 0})
    geographies = defaultdict(lambda: {"count": 0, "episodes": set(),
                                       "insights": 0, "data_points": 0})
    for ep in episodes.values():
        for tag in ep["industries"]:
            industries[tag]["episodes"].add(ep["video_id"])
        for tag in ep["geographies"]:
            geographies[tag]["episodes"].add(ep["video_id"])
    for it in all_items["insights"]:
        if it.get("industry"):
            industries[it["industry"]]["insights"] += 1
        if it.get("geography"):
            geographies[it["geography"]]["insights"] += 1
    for it in all_items["data_points"]:
        if it.get("industry"):
            industries[it["industry"]]["data_points"] += 1
        if it.get("geography"):
            geographies[it["geography"]]["data_points"] += 1

    def tag_block(d):
        return {k: {"episode_count": len(v["episodes"]), "insights": v["insights"],
                    "data_points": v["data_points"], "episodes": sorted(v["episodes"])}
                for k, v in sorted(d.items(), key=lambda kv: -len(kv[1]["episodes"]))}

    # The Data page filters data points by industry; a data point is "in" an
    # industry if the item itself is tagged OR its episode covers that industry.
    ep_industries = {vid: set(ep["industries"]) for vid, ep in episodes.items()}
    for it in all_items["data_points"]:
        for ind in ep_industries.get(it["video_id"], set()):
            industries[ind]["data_points"] = industries[ind].get("data_points", 0) + 1

    out = {
        "meta": {
            "source": f"{PRIVATE_REPO} (private: raw ASR transcripts)",
            "episodes": len(episodes),
            "generated": __import__("datetime").date.today().isoformat(),
            "counts": {k: len(v) for k, v in all_items.items()},
            "series": sorted({e["series"] for e in episodes.values() if e["series"]}),
        },
        "episodes": list(episodes.values()),
        "items": all_items,
        "industries": tag_block(industries),
        "geographies": tag_block(geographies),
    }
    (DATA / "insights.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"episodes: {len(episodes)}")
    for k, v in out["meta"]["counts"].items():
        print(f"  {k}: {v}")
    print(f"industries: {len(out['industries'])} | geographies: {len(out['geographies'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
