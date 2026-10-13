# WTF Atlas

A website that crystallizes the intelligence from all 55 episodes of Nikhil
Kamath's **WTF** podcast — organized by industry, geography and person, with
quotes, data points and ideas you can deep-dive into.

**Live:** https://light-saber.github.io/wtf-atlas/

What's inside, at a glance: **402 insights, 323 data points, 236 quotes,
181 ideas, 131 stories** — 1,273 items, every one attributed to the person
who said it and linked back to its episode.

## How to use it

- **Browse by industry** or **geography** — ranked by how many episodes touch each.
- **Data** — every specific number stated on the show (market sizes, growth
  rates, multiples, unit economics). Grouped by **theme** (what kind of number
  it is: headcount, pricing, funding, time, growth…) and inside each theme by
  unit family (percentages, USD, INR, counts, time…), largest figure first.
- **Quotes / Ideas / Stories** — the punchy lines, the theses and bets, and the
  concrete anecdotes.
- **Episodes** — pick any episode and deep-dive its numbers, stories and data
  across five tabs.
- **Search** — press `/` anywhere to search all content, jump straight to the
  episode it came from.

Every number appears **as stated on the show**, never converted or rounded.

## Repos

- **This repo (public):** the website + the curated insight data (`data/insights.json`).
- **`light-saber/nikhil-kamath-wtf-transcripts` (private):** the raw ASR
  transcripts this site is built from. Every insight traces back to a
  transcript file named `EP #<n> - <title>.txt` in that repo.

## Pipeline

```
transcripts (private repo)  →  LLM extraction  →  data/insights.json  →  static site
```

| file | role |
|---|---|
| `pipeline/extract_prompt.txt` | the extraction schema and rules given to the LLM |
| `pipeline/extract.py` | batches transcripts through Gemini CLI |
| `pipeline/extract_codex.py` | batches transcripts through Codex CLI (writes each batch to a file, salvages truncated JSON) |
| `pipeline/build_data.py` | merges `data/insights/batch_*.json` into the `data/insights.json` the site loads; normalizes tags, resolves episode numbers/series/titles |
| `pipeline/classify_theme.py` | tags every data point with a theme — Jev first, escalating sub-0.6-confidence items to Codex |
| `pipeline/value_parse.py` | turns the free-text `value` field into a comparable number + unit family |
| `value_parse.js` | browser port of the above (parity-checked by `check_parity.js`) |
| `index.html` / `styles.css` / `app.js` | the site (hash-routed, no build step, loads `data/insights.json`) |

Episode numbers come from the video title where the creator put one there,
otherwise from the publisher's RSS feeds — each recorded with its source in
`data/episode_numbers.json`.

## Notes

Transcripts are ASR-generated and contain `[music]` markers and occasional
mis-transcriptions, so treat the extracted text as searchable intelligence,
not a verbatim record. The site is a personal research tool.
