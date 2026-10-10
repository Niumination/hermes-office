#!/usr/bin/env python3
"""Generate (or verify) a CycloneDX 1.6 SBOM for this repository.

    python3 scripts/make-sbom.py            # write sbom.cdx.json
    python3 scripts/make-sbom.py --check    # regenerate and compare (CI gate)

WHY THIS EXISTS

Every enterprise review asks for a software bill of materials before it asks
anything else, and the usual answer is a file somebody generated once, by
hand, on a laptop, months ago. That file is worse than no file: it is a
dependency list that has quietly stopped being true, carrying the authority
of a format.

So the SBOM here is built from the lockfiles on every run and `--check`
refuses to pass unless the committed copy is byte-identical to a fresh
build. The same reasoning as the sprite gate: a recorded fingerprint only
proves the file has not been edited, never that it still describes reality.

WHY IT IS DETERMINISTIC, AND WHAT THAT COSTS

A regenerate-and-compare gate is impossible if the generator writes the
current time. CycloneDX makes `metadata.timestamp` optional, so this
generator omits it, and derives `serialNumber` from a hash of the inputs
rather than a random UUID. Two consequences, both deliberate:

  - The committed SBOM answers "what is in this tree", not "when was this
    generated". The second question is better answered by git, which cannot
    be made to lie about it by re-running a script.
  - The serial number changes if and only if the dependency set changes, so
    two builds of the same commit produce the same document, on any machine.

If a release process needs a timestamped, signed SBOM, it should stamp this
document at release time. Stamping is an action with a date attached; a
generator that stamps itself is just a clock.

WHAT IT READS

Both lockfiles (`package-lock.json`, `frontend/package-lock.json`), and
nothing else. Not `node_modules` — the SBOM must be buildable on a clean
clone, or it cannot be a gate. Lockfile v3 carries `license` for every entry,
so no installed tree is needed to resolve them.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sbom.cdx.json")

# Each lockfile, and the label recorded on every component it contributes.
LOCKS = [
    ("root", "package-lock.json"),
    ("frontend", os.path.join("frontend", "package-lock.json")),
]


def _hashes(integrity: str) -> list[dict]:
    """npm records integrity as `<alg>-<base64>`; CycloneDX wants hex."""
    if not integrity or "-" not in integrity:
        return []
    alg, _, b64 = integrity.partition("-")
    names = {"sha512": "SHA-512", "sha256": "SHA-256", "sha1": "SHA-1"}
    if alg not in names:
        return []
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        return []
    return [{"alg": names[alg], "content": raw.hex()}]


def _licenses(entry: dict) -> list[dict]:
    """Lockfile v3 gives a string, sometimes an SPDX expression.

    An expression ("MIT OR Apache-2.0") is not an id and must not be smuggled
    into the `id` field, or every downstream licence scanner silently records
    a licence that does not exist.
    """
    lic = entry.get("license")
    if not lic:
        return []
    if isinstance(lic, list):  # old npm shape, kept for safety
        return [{"license": {"name": str(x)}} for x in lic]
    lic = str(lic)
    if any(tok in lic for tok in (" OR ", " AND ", " WITH ", "(")):
        return [{"expression": lic}]
    return [{"license": {"id": lic}}]


def _components() -> tuple[list[dict], list[dict]]:
    comps: dict[str, dict] = {}
    deps: list[dict] = []

    for label, rel in LOCKS:
        full = os.path.join(ROOT, rel)
        if not os.path.exists(full):
            raise SystemExit(f"FAIL: {rel} is missing; the SBOM cannot be built")
        lock = json.load(open(full, encoding="utf-8"))

        direct: list[str] = []
        for path, entry in sorted(lock.get("packages", {}).items()):
            if path == "":  # the workspace root itself, not a dependency
                continue
            name = entry.get("name") or path.split("node_modules/")[-1]
            version = entry.get("version")
            if not version:
                continue
            ref = f"pkg:npm/{name}@{version}"
            # The same package can appear in both lockfiles at the same
            # version. That is one component used twice, not two components,
            # so merge and record both workspaces.
            if ref in comps:
                seen = comps[ref]["properties"][0]
                if label not in seen["value"].split(","):
                    seen["value"] += "," + label
                continue
            comps[ref] = {
                "bom-ref": ref,
                "type": "library",
                "name": name,
                "version": version,
                "purl": ref,
                "licenses": _licenses(entry),
                "hashes": _hashes(entry.get("integrity", "")),
                "properties": [
                    {"name": "hermes:workspace", "value": label},
                    {"name": "hermes:dev",
                     "value": "true" if entry.get("dev") else "false"},
                ],
            }
            # Depth 1 under node_modules = a direct dependency of this
            # workspace. Nested paths are transitive and belong to the graph
            # only through their parent, which npm does not record in v3.
            if path.count("node_modules/") == 1:
                direct.append(ref)

        deps.append({"bom-ref": f"hermes-office/{label}",
                     "dependsOn": sorted(direct)})

    ordered = [comps[k] for k in sorted(comps)]
    for c in ordered:
        if not c["licenses"]:
            del c["licenses"]
        if not c["hashes"]:
            del c["hashes"]
    return ordered, deps


def build() -> dict:
    comps, deps = _components()
    pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))

    # Deterministic serial: a function of what is actually in the document.
    digest = hashlib.sha256(
        json.dumps(comps, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    uuid = f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"

    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid}",
        "version": 1,
        "metadata": {
            # No `timestamp` on purpose — see the module docstring.
            "component": {
                "bom-ref": "hermes-office",
                "type": "application",
                "name": "hermes-office",
                "version": pkg.get("version", "0.0.0"),
                "licenses": [{"license": {"id": pkg.get("license", "MIT")}}],
            },
            "tools": {"components": [{
                "type": "application",
                "name": "scripts/make-sbom.py",
                "publisher": "hermes-office",
            }]},
            "properties": [
                {"name": "hermes:deterministic", "value": "true"},
                {"name": "hermes:sources",
                 "value": ",".join(rel for _, rel in LOCKS)},
            ],
        },
        "components": comps,
        "dependencies": deps,
    }


def render(doc: dict) -> str:
    return json.dumps(doc, indent=2, sort_keys=False) + "\n"


def main() -> int:
    check = "--check" in sys.argv[1:]
    fresh = render(build())

    if not check:
        open(OUT, "w", encoding="utf-8").write(fresh)
        doc = json.loads(fresh)
        print(f"wrote sbom.cdx.json ({len(doc['components'])} components, "
              f"CycloneDX {doc['specVersion']})")
        return 0

    if not os.path.exists(OUT):
        print("FAIL: sbom.cdx.json is missing. Run: npm run sbom")
        return 1

    have = open(OUT, encoding="utf-8").read()
    if have == fresh:
        doc = json.loads(fresh)
        n_dev = sum(1 for c in doc["components"]
                    if any(p["name"] == "hermes:dev" and p["value"] == "true"
                           for p in c["properties"]))
        print(f"PASS: sbom.cdx.json matches a fresh build "
              f"({len(doc['components'])} components, "
              f"{len(doc['components']) - n_dev} runtime / {n_dev} dev)")
        return 0

    try:
        old = {c["purl"] for c in json.loads(have).get("components", [])}
    except Exception:
        print("FAIL: sbom.cdx.json is not readable JSON; regenerate it with "
              "`npm run sbom`")
        return 1
    new = {c["purl"] for c in json.loads(fresh)["components"]}
    added, gone = sorted(new - old), sorted(old - new)

    print("FAIL: sbom.cdx.json no longer matches the lockfiles.")
    print()
    for p in added[:12]:
        print(f"    + {p}")
    for p in gone[:12]:
        print(f"    - {p}")
    if not added and not gone:
        print("    the component set is unchanged, so the difference is in "
              "metadata — a version, a licence, or an integrity hash moved.")
    extra = len(added) + len(gone) - 24
    if extra > 0:
        print(f"    ... and {extra} more")
    print()
    print("  The dependencies moved and the bill of materials did not. Run:")
    print("      npm run sbom")
    print("  and commit the result alongside the lockfile change.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
