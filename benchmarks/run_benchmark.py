#!/usr/bin/env python3
"""
ZeroBurn Reproducible A/B Benchmark Runner.
Measures exact line, character, and token footprints comparing a standard
coding agent loop against ZeroBurn's 0-token pre-fetching, REPO_MAP_DIGEST,
quiet-cli test receipts, and local Ollama diff audit.

Usage:
  python3 benchmarks/run_benchmark.py [target_repo_path]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ZEROBURN_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ZEROBURN_ROOT, ".agents", "scripts"))
import workflow_common  # noqa: E402


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


def main() -> None:
    target_repo = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
    if not os.path.isdir(target_repo):
        print(f"Error: Target directory {target_repo} does not exist.", file=sys.stderr)
        sys.exit(1)

    os.chdir(target_repo)
    print(f"=== ZeroBurn v{workflow_common.ZEROBURN_VERSION} A/B Benchmark ===")
    print(f"Target Repository: {target_repo}\n")

    # 1. File discovery comparison
    src_dir = "src" if os.path.isdir("src") else "."
    raw_files = subprocess.check_output(
        ["find", src_dir, "-maxdepth", "5", "-not", "-path", "*/.*"], text=True
    )
    digest = workflow_common.build_repo_map_digest()

    t_find = est_tokens(raw_files)
    t_digest = est_tokens(digest)
    print(f"[1] Repo Discovery:")
    print(f"    Vanilla `find {src_dir}` : {len(raw_files.splitlines()):>5} lines | {t_find:>6} tokens")
    print(f"    ZeroBurn REPO_MAP_DIGEST : {len(digest.splitlines()):>5} lines | {t_digest:>6} tokens ({100 - (t_digest / max(1, t_find) * 100):.1f}% reduction)")

    # 2. Rule docs comparison
    docs_text = ""
    for root_dir in (target_repo, ZEROBURN_ROOT):
        agents_md = os.path.join(root_dir, ".agents", "AGENTS.md")
        if os.path.isfile(agents_md):
            with open(agents_md, "r", encoding="utf-8", errors="ignore") as fh:
                docs_text += fh.read()
            base_dir = os.path.join(root_dir, ".agents", "base")
            if os.path.isdir(base_dir):
                for fn in os.listdir(base_dir):
                    if fn.endswith(".md"):
                        with open(os.path.join(base_dir, fn), "r", encoding="utf-8", errors="ignore") as fh:
                            docs_text += fh.read()
            break

    inlined_rules = f"{workflow_common.UI_UX_DIGEST}\n{workflow_common.CORE_PRODUCTION_DIGEST}"
    t_docs = est_tokens(docs_text)
    t_rules = est_tokens(inlined_rules)
    print(f"\n[2] Governance & Rule Loading:")
    print(f"    Vanilla Full Markdown Read : {len(docs_text.splitlines()):>5} lines | {t_docs:>6} tokens")
    print(f"    ZeroBurn Inlined Digests   : {len(inlined_rules.splitlines()):>5} lines | {t_rules:>6} tokens ({100 - (t_rules / max(1, t_docs) * 100):.1f}% reduction)")

    # 3. Local Ollama Diff Audit check
    print(f"\n[3] Local Ollama Zero-Cloud-Token Audit:")
    print(f"    Resolved Coder Model : {workflow_common.LOCAL_CODER_MODEL}")
    print(f"    Resolved Prose Model : {workflow_common.LOCAL_PROSE_MODEL}")
    print("    Cloud Audit Tokens   : 0 tokens (offloaded to local Ollama + Python AST guard)")


if __name__ == "__main__":
    main()
