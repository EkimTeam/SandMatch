import json
from pathlib import Path
from typing import Dict, List

# Helper to read Vite manifest produced at frontend build
# Manifest location (relative to project root): static/frontend/manifest.json

def get_vite_assets(base_dir: Path) -> Dict[str, List[str]]:
    manifest_path = base_dir / "static" / "frontend" / "manifest.json"
    css_files: List[str] = []
    js_files: List[str] = []

    if not manifest_path.exists():
        return {"css": css_files, "js": js_files}

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {"css": css_files, "js": js_files}

    # We assume main entry at src/main.tsx
    entry = data.get("src/main.tsx") or {}
    file = entry.get("file")
    if file:
        js_files.append(f"frontend/{file}")

    for css in entry.get("css", []):
        css_files.append(f"frontend/{css}")

    # Also include any imported chunks with css/js if desired
    for imp in entry.get("imports", []) or []:
        chunk = data.get(imp) or {}
        f = chunk.get("file")
        if f:
            js_files.append(f"frontend/{f}")
        for c in chunk.get("css", []) or []:
            css_files.append(f"frontend/{c}")

    return {"css": css_files, "js": js_files}
