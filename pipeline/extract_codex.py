#!/usr/bin/env python3
"""Extract structured insights from WTF transcripts via Codex CLI.

Batches N transcripts per Codex run, writes data/insights/batch_<n>.json.
Usage: python3 extract_codex.py <transcripts_dir> <out_dir> [batch_size]
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
print(f"{len(files)} transcripts, batches of {BATCH} -> {OUT}", flush=True)


def try_repair(raw):
    """Attempt to salvage truncated JSON by closing open structures."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
    s, e = raw.find("["), raw.rfind("]")
    if s == -1:
        return None
    if e > s:
        candidate = raw[s:e + 1]
        try:
            return json.loads(candidate)
        except Exception:
            pass
    # truncated: parse complete top-level objects by brace matching
    objs, depth, start, instr, esc_ = [], 0, None, False, False
    for i, ch in enumerate(raw):
        if instr:
            if esc_: esc_ = False
            elif ch == "\\": esc_ = True
            elif ch == '"': instr = False
            continue
        if ch == '"': instr = True
        elif ch == "{":
            if depth == 0: start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    objs.append(json.loads(raw[start:i + 1]))
                except Exception:
                    pass
                start = None
    return objs or None


def run_batch(batch, idx):
    names = "\n".join(f"- {p}" for p in batch)
    out_file = OUT / f"batch_{idx:02d}.json"
    want = {p.stem for p in batch}
    last = OUT / f".last_{idx:02d}.txt"
    prompt = (
        PROMPT.replace("{{FILES}}", names)
        + "\n\nIMPORTANT: Write the resulting JSON array to the file "
        + str(out_file.resolve())
        + " using your file-write tool (write_file). Do NOT print the JSON "
        + "to stdout and do NOT truncate it — every one of the "
        + str(len(batch))
        + " episodes must appear in the file. After writing, reply with just: WROTE <n> episodes."
    )
    cmd = [
        "codex", "exec",
        "--sandbox", "danger-full-access",
        "--skip-git-repo-check",
        "-C", str(HERE),
        "-o", str(last),
        prompt,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=2400, cwd=str(HERE))
        # Prefer the file Codex wrote; fall back to its last message.
        if out_file.exists():
            try:
                data = json.loads(out_file.read_text(encoding="utf-8"))
            except Exception:
                data = None
        else:
            data = None
        if data is None:
            raw = last.read_text(encoding="utf-8") if last.exists() else r.stdout
            stripped = raw.strip()
            if stripped.startswith("```"):
                stripped = stripped.split("\n", 1)[-1].rsplit("```", 1)[0]
            s, e = stripped.find("["), stripped.rfind("]")
            if s != -1 and e > s:
                try:
                    data = json.loads(stripped[s:e + 1])
                except Exception:
                    data = None
            if data is None:
                data = try_repair(raw)
                if data is not None:
                    print(f"  batch {idx}: repaired from last-message ({len(data)} eps)", flush=True)
        if not data:
            print(f"  batch {idx}: NO JSON. stderr={r.stderr[-200:]}", flush=True)
            return False
        got = {d.get("video_id") for d in data}
        missing = want - got
        if missing:
            print(f"  batch {idx}: id mismatch got={len(got)}/{len(want)} missing={len(missing)}", flush=True)
            return False
        out_file.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  batch {idx}: OK {len(data)} eps, "
              f"{sum(len(d.get('insights',[])) for d in data)} insights, "
              f"{sum(len(d.get('data_points',[])) for d in data)} datapoints, "
              f"{sum(len(d.get('quotes',[])) for d in data)} quotes", flush=True)
        return True
    except subprocess.TimeoutExpired:
        print(f"  batch {idx}: TIMEOUT", flush=True)
        return False
    except Exception as exc:
        print(f"  batch {idx}: ERR {type(exc).__name__}: {str(exc)[:150]}", flush=True)
        return False


batches = [files[i:i + BATCH] for i in range(0, len(files), BATCH)]
fails = []
for i, b in enumerate(batches, 1):
    if (OUT / f"batch_{i:02d}.json").exists():
        continue
    if not run_batch(b, i):
        fails.append(i)
    time.sleep(2)

print(f"\nDONE. failures: {fails or 'none'}", flush=True)
print(f"batches on disk: {len(list(OUT.glob('batch_*.json')))}/{len(batches)}", flush=True)
