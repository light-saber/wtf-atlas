#!/usr/bin/env python3
"""Extract structured insights from WTF transcripts via Gemini CLI.

Batches N transcripts per Gemini call, writes data/insights/<batch>.json.
Usage: python3 extract.py <transcripts_dir> <out_dir> [batch_size]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROMPT = (HERE / "extract_prompt.txt").read_text(encoding="utf-8")

TRANSCRIPTS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
BATCH = int(sys.argv[3]) if len(sys.argv) > 3 else 5
OUT.mkdir(parents=True, exist_ok=True)

files = sorted(TRANSCRIPTS.glob("*.txt"))
files = [f for f in files if not f.name.startswith("_")]
print(f"{len(files)} transcripts, batches of {BATCH} -> {OUT}")

done = {p.stem for p in OUT.glob("batch_*.json")}
print(f"already done: {len(done)} batches")


def run_batch(batch, idx):
    names = "\n".join(f"- {p}" for p in batch)
    prompt = PROMPT.replace("{{FILES}}", names)
    out_file = OUT / f"batch_{idx:02d}.json"
    try:
        r = subprocess.run(
            ["gemini", "-p", prompt, "--output-format", "json"],
            capture_output=True, text=True, timeout=1800, cwd=str(HERE),
        )
        raw = r.stdout
        # gemini --output-format json wraps in {"response": "..."}
        if raw.strip().startswith("{"):
            try:
                wrapper = json.loads(raw)
                raw = wrapper.get("response") or wrapper.get("text") or raw
            except Exception:
                pass
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw
            raw = raw.rsplit("```", 1)[0]
        s, e = raw.find("["), raw.rfind("]")
        if s == -1 or e == -1:
            print(f"  batch {idx}: NO JSON (stderr: {r.stderr[:200]})")
            return False
        data = json.loads(raw[s:e + 1])
        # verify ids match the batch
        got = {d.get("video_id") for d in data}
        want = {p.stem for p in batch}
        if got != want:
            print(f"  batch {idx}: id mismatch got={len(got)} want={len(want)} "
                  f"missing={want - got}")
            return False
        out_file.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  batch {idx}: OK {len(data)} episodes "
              f"({sum(len(d.get('insights',[])) for d in data)} insights)")
        return True
    except subprocess.TimeoutExpired:
        print(f"  batch {idx}: TIMEOUT")
        return False
    except Exception as exc:
        print(f"  batch {idx}: ERR {type(exc).__name__}: {str(exc)[:150]}")
        return False


batches = [files[i:i + BATCH] for i in range(0, len(files), BATCH)]
fails = []
for i, b in enumerate(batches, 1):
    key = f"batch_{i:02d}"
    if key in done:
        continue
    if run_batch(b, i):
        pass
    else:
        fails.append(i)
    time.sleep(3)

print(f"\nDONE. failures: {fails or 'none'}")
print(f"batches on disk: {len(list(OUT.glob('batch_*.json')))}")
