#!/usr/bin/env python3
"""
value_parse.py — turn the free-text `value` field on data points into a
comparable number plus a unit family, so the Data page can sort and group.

Handles the shapes actually present in the corpus:
  "30 to 40%"              -> 35.0,        percent
  "50 to 100"              -> 75.0,        basis_points
  "2 and a half"           -> 2.5,         time_months
  "close to a billion"     -> 1e9,         money_usd
  "$20"                    -> 20.0,        money_usd
  "5,000 plus"             -> 5000.0,      count
  "450,000 to 500,000"     -> 475000.0,    count
  "70,000"                 -> 70000.0,     money_inr
  "two three billion"      -> 2.5e9,       money_usd
  "30 to 50 lakh rupees"   -> 4.0e6,       money_inr
  "about 150 000"          -> 150000.0,    count
  "half a million dollars" -> 500000.0,    money_usd
  "second largest market"  -> None,        rank (not sortable)

Returns (number|None, family). Family drives the sort grouping on the site.
"""
import re

WORD_NUMS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90, "dozen": 12,
}
SCALES = {"hundred": 1e2, "thousand": 1e3, "million": 1e6, "lakh": 1e5,
          "crore": 1e7, "billion": 1e9, "trillion": 1e12}
FILLER = ("and", "or", "to", "plus", "over", "about", "close", "under",
          "roughly", "like", "around", "nearly", "almost", "some", "of",
          "the", "per", "every", "at", "least", "more", "less", "than",
          "roughly", "approximately", "estimated")

MONEY_HINTS = ("$", "usd", "dollar", "rupee", "inr", "crore", "lakh")
INR_HINTS = ("inr", "rupee", "crore", "lakh")

RANK_WORDS = ("first", "second", "third", "fourth", "fifth", "sixth",
              "largest", "smallest", "top")


def _normalise(v):
    """Repair the corpus's messy numeric spellings before parsing."""
    v = v.lower()
    # "450,000" -> 450000 (strip thousands separators inside a digit run)
    v = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", v)
    # "150 000" -> 150000 (space-separated thousands groups)
    v = re.sub(r"(?<=\d) (?=\d{3}(?!\d))", "", v)
    # "2 and a half" -> "2.5"
    m = re.match(r"^(\d+(?:\.\d+)?)\s+and\s+a\s+half\b", v)
    if m:
        v = m.group(1) + ".5" + v[m.end():]
    # "two and a half" -> "2.5"
    m = re.match(r"^([a-z]+)\s+and\s+a\s+half\b", v)
    if m and m.group(1) in WORD_NUMS:
        v = f"{WORD_NUMS[m.group(1)] + 0.5}" + v[m.end():]
    # "an hour and a half" -> "1.5 hours"; same for minute/day/week/month
    m = re.match(r"^(?:a|an|one)\s+(hour|minute|day|week|month|year)s?\s+and\s+a\s+half\b", v)
    if m:
        v = "1.5 " + m.group(1) + "s" + v[m.end():]
    # "half a million" -> "0.5 million"; "a billion" -> "1 billion"
    v = re.sub(r"\bhalf\s+a\b", "0.5", v)
    v = re.sub(r"^(?:a|an)\b(?=\s)", "1 ", v)
    v = re.sub(r"\b(?:a|an)\s+(?=(?:hundred|thousand|million|billion|lakh|crore|trillion|dozen)\b)", "1 ", v)
    return v


def _digits(text):
    out = []
    for m in re.finditer(r"\d+(?:\.\d+)?", text):
        try:
            out.append(float(m.group(0)))
        except ValueError:
            pass
    return out


def _words(text):
    """Read a leading run of word-numbers, honouring scale words.

    "one hundred" -> 100, "two three billion" -> 2.5e9, "1 million" -> 1e6,
    "a dozen" -> 12, "eight" -> 8. A bare scale word implies 1 ("billion" -> 1e9).
    """
    total, scale, seen_num, seen_scale = 0.0, 1.0, False, False
    for w in re.findall(r"[a-z]+", text):
        if w in FILLER or w == "half":
            continue
        if w in SCALES:
            if seen_num and scale == 1.0:
                # number already accumulated; it becomes the coefficient
                total, scale, seen_num, seen_scale = 0.0, total, False, True
            else:
                scale *= SCALES[w]
                seen_scale = True
            continue
        if w not in WORD_NUMS:
            break
        n = WORD_NUMS[w]
        if scale > 1:
            total += n * scale
            scale = 1.0
        else:
            total += n
        seen_num = True
    if not seen_num and not seen_scale:
        return None
    if not seen_num and seen_scale:
        return scale
    return total * scale


def _numbers(v):
    nums = _digits(v)
    if nums:
        return nums
    w = _words(v)
    return [w] if w else []


def _scale_of(v):
    s = 1.0
    for word, mult in SCALES.items():
        if re.search(rf"\b{word}\b", v):
            s = max(s, mult)
    return s


def parse_value(value, unit=""):
    """Return (float|None, family)."""
    if value is None:
        return None, "other"
    v = _normalise(str(value).strip())
    u = (unit or "").strip().lower()
    if not v:
        return None, "other"

    # ranks / ordinals carry no comparable magnitude
    if any(re.search(rf"\b{w}\b", v) for w in RANK_WORDS) and not _numbers(v):
        return None, "rank"

    nums = _numbers(v)
    if not nums:
        return None, "other"

    # "30 to 40", "3 or 4" -> midpoint; a single number stays as is
    n = sum(nums) / len(nums) if len(nums) > 1 else nums[0]

    # a scale word multiplies the number it follows: "90 million", "1 billion"
    scale = _scale_of(v)
    if scale > 1:
        n *= scale
    elif re.search(r"\bdozen\b", v):
        n *= 12

    # ---- family: trust the explicit unit first ----
    if "%" in u or u in ("percent", "%"):
        return n, "percent"
    if "basis point" in u:
        return n, "basis_points"
    if any(h in u for h in MONEY_HINTS):
        return n, "money_inr" if any(h in u for h in INR_HINTS) else "money_usd"
    if re.search(r"year", u):
        return n, "time_years"
    if re.search(r"month", u):
        return n, "time_months"
    if re.search(r"week|day|hour|minute", u):
        return n, "time_short"
    if u == "x":
        return n, "multiple"

    # unit is empty or generic — fall back to the value string
    if "%" in v:
        return n, "percent"
    if "basis point" in v:
        return n, "basis_points"
    if any(h in v for h in MONEY_HINTS):
        return n, "money_inr" if any(h in v for h in INR_HINTS) else "money_usd"
    if re.search(r"\btimes\b", v):
        return n, "multiple"
    if re.search(r"\byears?\b", v):
        return n, "time_years"
    if re.search(r"\bmonths?\b", v):
        return n, "time_months"
    if re.search(r"\bweeks?\b|\bdays?\b|\bhours?\b", v):
        return n, "time_short"
    return n, "count"


FAMILY_LABELS = {
    "percent": "Percentages",
    "money_usd": "Money (USD)",
    "money_inr": "Money (INR)",
    "count": "Counts & headcount",
    "time_years": "Time (years)",
    "time_months": "Time (months)",
    "time_short": "Time (days & weeks)",
    "basis_points": "Basis points",
    "multiple": "Multiples",
    "rank": "Ranks",
    "other": "Unparsed",
}
FAMILY_ORDER = ["percent", "money_usd", "money_inr", "multiple",
                "count", "time_years", "time_months", "time_short",
                "basis_points", "rank", "other"]

if __name__ == "__main__":
    tests = [
        ("30 to 40%", "%"), ("50 to 100", "basis points"),
        ("2 and a half", "months"), ("3", "weeks"),
        ("close to a billion", "$ per year"), ("$20", "$ per month"),
        ("5,000 plus", "people"), ("two three billion dollars", "$"),
        ("second largest market", "rank"), ("90 million", "people"),
        ("a dozen kids every couple of months", "people"),
        ("about 150 000", "people"), ("$450 billion", "$"),
        ("30 to 50 lakh rupees", "rupees"), ("3 or 4", "months"),
        ("two and a half million dollars", ""), ("1.4 million", "drivers"),
        ("under 20 million", "people"), ("450,000 to 500,000", "units"),
        ("100 million or 80 million", "people"),
        ("over $11 million", "$"), ("9 billion 10 billion", "US dollars"),
        ("like a thousand", "parts"), ("70,000", "rupees"),
        ("280 rupes 290 rupees", ""), ("a billion downloads", ""),
        ("half a million dollars", "USD"), ("over a hundred", "OEMs"),
        ("about an hour and a half", "hours"), ("billions", "robots"),
        ("at least eight companies", "companies"),
        ("about a million", "businesses"), ("a million", "US dollars"),
        ("less than one percent", "% of GDP"), ("close to a billion and a half dollars", "$"),
    ]
    for v, u in tests:
        n, f = parse_value(v, u)
        print(f"{v!r:38} {u!r:16} -> {n!r:>18}  {f}")

    print("\n--- distribution over the real corpus ---")
    import collections
    import json
    db = json.load(open("../data/insights.json"))
    c, unparsed = collections.Counter(), []
    for x in db["items"]["data_points"]:
        n, f = parse_value(x.get("value"), x.get("unit"))
        c[f] += 1
        if n is None:
            unparsed.append((x.get("value"), x.get("unit")))
    for f in FAMILY_ORDER:
        print(f"  {c.get(f,0):4d}  {FAMILY_LABELS[f]}")
    print(f"  ----\n  {sum(c.values()):4d}  total")
    print(f"\nunparsed ({len(unparsed)}):")
    for v, u in unparsed:
        print(f"  {v!r} / {u!r}")
