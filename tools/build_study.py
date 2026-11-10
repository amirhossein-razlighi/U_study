#!/usr/bin/env python3
"""Turn a private scene list into the public, anonymized study site.

Reads .private/study_source.json, copies each video to docs/media/ under an opaque name with
metadata stripped, writes docs/data/scenes.json, and keeps the opaque-ID-to-method map in
.private/codebook.json. Only docs/ is published.
"""
import argparse
import hashlib
import json
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GITHUB_FILE_LIMIT = 100 * 1024 * 1024


def fail(message):
    raise SystemExit(f"error: {message}")


def opaque(salt, *parts):
    return hashlib.sha256("\0".join([salt, *parts]).encode()).hexdigest()[:16]


def load_salt(private_dir):
    path = private_dir / "salt.txt"
    if not path.exists():
        path.write_text(secrets.token_hex(16))
    return path.read_text().strip()


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    )
    return round(float(out.stdout.strip()), 3)


def copy_clean(source, target):
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(source), "-map", "0", "-map_metadata", "-1",
         "-map_chapters", "-1", "-c", "copy", "-movflags", "+faststart", "-fflags", "+bitexact", str(target)],
        check=True,
    )
    if target.stat().st_size >= GITHUB_FILE_LIMIT:
        fail(f"{source} is over GitHub's 100 MB per-file limit")


def check_scene(scene):
    key = scene.get("key", "<missing key>")
    for field in ("key", "title", "summary", "requested", "videos"):
        if not scene.get(field):
            fail(f"scene {key}: missing {field}")
    if len(scene["videos"]) != 3:
        fail(f"scene {key}: needs exactly 3 videos, found {len(scene['videos'])}")
    for path in scene["videos"].values():
        if not Path(path).is_file():
            fail(f"scene {key}: video not found: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private", type=Path, default=ROOT / ".private")
    parser.add_argument("--docs", type=Path, default=ROOT / "docs")
    args = parser.parse_args()

    source = json.loads((args.private / "study_source.json").read_text())
    salt = load_salt(args.private)
    media_dir = args.docs / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    scenes, codebook, kept = [], {}, set()
    for scene in source["scenes"]:
        check_scene(scene)
        first_video = next(iter(scene["videos"].values()))
        duration = scene.get("duration") or probe_duration(first_video)
        for src in scene["requested"]:
            for w in src["windows"]:
                if not 0 <= w["start"] < w["end"] <= duration + 0.5:
                    fail(f"scene {scene['key']}: window {w} outside 0-{duration} s")

        scene_id = "s_" + opaque(salt, source["version"], scene["key"])
        outputs = []
        for method, path in scene["videos"].items():
            output_id = "o_" + opaque(salt, source["version"], scene["key"], method)
            name = f"{output_id}.mp4"
            copy_clean(Path(path), media_dir / name)
            kept.add(name)
            outputs.append({"id": output_id, "src": f"media/{name}"})
            codebook[output_id] = {"scene_key": scene["key"], "scene_id": scene_id, "method": method, "source": str(path)}

        # The source lists methods in a fixed order; publishing that order would reveal them.
        outputs.sort(key=lambda output: output["id"])
        public = {"id": scene_id, "title": scene["title"], "summary": scene["summary"],
                  "duration": duration, "requested": scene["requested"], "outputs": outputs}
        if scene.get("prompt"):
            public["prompt"] = scene["prompt"]
        scenes.append(public)

    for stale in media_dir.glob("o_*.mp4"):
        if stale.name not in kept:
            stale.unlink()

    manifest = {"version": source["version"], "question": source["question"], "scenes": scenes}
    (args.docs / "data").mkdir(exist_ok=True)
    (args.docs / "data" / "scenes.json").write_text(json.dumps(manifest, indent=1) + "\n")
    (args.private / "codebook.json").write_text(json.dumps(codebook, indent=1) + "\n")

    total = sum((media_dir / n).stat().st_size for n in kept) / 1024 / 1024
    print(f"{len(scenes)} scenes, {len(kept)} videos, {total:.1f} MB in {media_dir}")


if __name__ == "__main__":
    main()
