# WTF Atlas

A website that crystallizes the insights from all 55 episodes of Nikhil Kamath's
"WTF" podcast — organized by industry, geography, guest, and episode, with
quotes, data points, and ideas you can deep-dive into.

## Repos

- **This repo (public):** the website + the curated insight data (`data/insights.json`).
- **`light-saber/nikhil-kamath-wtf-transcripts` (private):** the raw ASR transcripts
  this site is built from. Every insight traces back to a transcript file named
  `EP #<n> - <title>.txt` in that repo.

## Pipeline

```
transcripts (private repo)  →  gemini-cli extraction  →  data/insights.json  →  static site
```

- `extract_prompt.txt` — the extraction schema and rules given to Gemini.
- `extract.py` — batches transcripts through Gemini CLI, writes `data/insights/batch_*.json`.
- `build_data.py` — merges batches into the single `data/insights.json` the site loads.

Every claim on the site is attributed to a speaker and linked to its episode.
Numbers appear as stated in the transcript, never converted.
