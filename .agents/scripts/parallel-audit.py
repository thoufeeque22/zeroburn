import json
import os
import re
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.abspath(".agents/scripts"))
from workflow_common import (  # noqa: E402
    BRAND_NAME,
    CORE_PRODUCTION_DIGEST,
    EXECUTION_EFFICIENCY_DIGEST,
    GRAPH_MCP_CHEATSHEET,
    HIGH_RISK_PREFIXES,
    LOCAL_CODER_MODEL,
    MAX_LINES_PER_FILE,
    OLLAMA_URL,
    REPO_MAP_DIGEST,
    STACK_SUMMARY,
    UI_UX_DIGEST,
    ensure_local_ollama_up,
    prefetch_graph_impact,
    run_agent_with_fallback,
)

ticket_id = args.get("ticket_id", "unknown")
blueprint_path = args.get("blueprint_path", "")
artifact_dir = args.get("artifact_dir", "")
base_ref = args.get("base_ref", "origin/main")
track = args.get("track", "M")
allow_cloud_only = bool(args.get("allow_cloud_only", False))


def run_deterministic_static_audit(base: str, bp_path: str = ""):
    """Option A + Pattern #3 (sofagent): 0-token Python static check for blast-radius drift, modularity, 'use server' line 1, and added `any`."""
    findings = []
    try:
        changed_raw = subprocess.check_output(
            ["git", "diff", "--name-only", base], text=True, stderr=subprocess.DEVNULL
        )
    except Exception:
        changed_raw = subprocess.check_output(
            ["git", "diff", "--name-only", "HEAD~1"], text=True, stderr=subprocess.DEVNULL
        )
    changed_files = [f.strip() for f in changed_raw.splitlines() if f.strip()]

    blueprint_text = ""
    if bp_path and os.path.isfile(bp_path):
        with open(bp_path, "r", encoding="utf-8", errors="ignore") as bfh:
            blueprint_text = bfh.read()

    for fpath in changed_files:
        if not os.path.isfile(fpath) or not fpath.startswith("src/"):
            continue
        if "__tests__" in fpath or fpath.endswith(".test.ts") or fpath.endswith(".spec.ts"):
            continue
        if blueprint_text and fpath not in blueprint_text and os.path.basename(fpath) not in blueprint_text:
            findings.append({
                "auditor": "Static Zero-Token Guard (Blast Radius)",
                "file_line": f"{fpath}:1",
                "severity": "medium",
                "reason": f"Out-of-scope file drift: `{fpath}` was modified but not declared in `{bp_path}`.",
            })
        if not (fpath.endswith(".ts") or fpath.endswith(".tsx")):
            continue
        with open(fpath, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
        if len(lines) > MAX_LINES_PER_FILE:
            findings.append({
                "auditor": "Static Zero-Token Guard",
                "file_line": f"{fpath}:1",
                "severity": "medium",
                "reason": f"File has {len(lines)} lines (exceeds {MAX_LINES_PER_FILE}-line modularity guideline).",
            })
        for idx, line in enumerate(lines):
            if ("'use server'" in line or '"use server"' in line) and idx > 0:
                findings.append({
                    "auditor": "Static Zero-Token Guard",
                    "file_line": f"{fpath}:{idx + 1}",
                    "severity": "high",
                    "reason": "'use server' directive must be on line 1.",
                })
            if re.search(r":\s*any\b|\bas\s+any\b", line) and "eslint-disable" not in line:
                findings.append({
                    "auditor": "Static Zero-Token Guard",
                    "file_line": f"{fpath}:{idx + 1}",
                    "severity": "high",
                    "reason": "Explicit `any` detected; use strict TypeScript types.",
                })
    return changed_files, findings


async def run_local_ollama_diff_audit(base: str):
    """Option A: Offload diff review to local coder model (0 cloud tokens)."""
    if allow_cloud_only:
        return []
    try:
        diff_text = subprocess.check_output(
            ["git", "diff", "-U2", base, "--", "src/", "prisma/"],
            text=True,
            stderr=subprocess.DEVNULL,
        )[:12000]
    except Exception:
        diff_text = ""
    if not diff_text.strip():
        return []

    prompt = (
        f"Review this git diff for {BRAND_NAME} ({STACK_SUMMARY}). "
        "Return ONLY a JSON object with schema: "
        '{"findings": [{"file_line": "path:line", "severity": "low|medium|high|critical", "reason": "..."}]}. '
        "Flag ONLY concrete bugs: missing server-side tier/auth checks, secrets leaked to client, "
        "missing P2002 handling on webhooks, or unhandled errors. Return empty findings array if clean.\n\n"
        f"DIFF:\n{diff_text}"
    )
    raw_reply = ""
    try:
        payload = json.dumps({
            "model": LOCAL_CODER_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=45.0) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="ignore"))
            raw_reply = body.get("message", {}).get("content", "")
    except Exception:
        call_tool_fn = globals().get("call_tool")
        if call_tool_fn is None:
            return []
        try:
            mcp_res = await call_tool_fn(
                "call_mcp_tool",
                ServerName="local-ollama-bridge",
                ToolName="ollama_chat",
                Arguments={
                    "model": LOCAL_CODER_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "format": "json",
                },
            )
            raw_reply = str(mcp_res)
        except Exception as exc:
            log(f"[Local-Ollama Audit] Warning: local diff review failed ({exc})")
            return []

    try:
        match = re.search(r"\{.*\}", raw_reply, re.DOTALL)
        parsed = json.loads(match.group(0) if match else raw_reply)
        valid = []
        for item in parsed.get("findings", []):
            if isinstance(item, dict) and item.get("file_line") and item.get("reason"):
                sev = item.get("severity", "medium")
                if sev not in ("low", "medium", "high", "critical"):
                    sev = "medium"
                valid.append({
                    "auditor": f"Local Ollama ({LOCAL_CODER_MODEL})",
                    "file_line": str(item["file_line"]),
                    "severity": sev,
                    "reason": str(item["reason"]),
                })
        return valid
    except Exception:
        return []


call_tool_fn = globals().get("call_tool")
await ensure_local_ollama_up(log, call_tool_fn, allow_cloud_only)

phase("Stage 1: Zero-Token Static + Graph Impact + Local Ollama Audit")
changed_files, static_findings = run_deterministic_static_audit(base_ref, blueprint_path)
graph_impact_digest = await prefetch_graph_impact(call_tool_fn, log, base_branch="main", depth=2)
local_findings = await run_local_ollama_diff_audit(base_ref)
log(f"Zero-Token Static findings: {len(static_findings)}, Local Ollama findings: {len(local_findings)}")

audit_schema = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["PASS", "FAIL"]},
        "tests_required": {"type": "boolean"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file_line": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "reason": {"type": "string"},
                },
                "required": ["file_line", "severity", "reason"],
            },
        },
    },
    "required": ["verdict", "tests_required", "findings"],
}

touches_high_risk = track == "L" or any(f.startswith(HIGH_RISK_PREFIXES) for f in changed_files)
cloud_tier = "pro" if touches_high_risk else "flash"

phase(f"Stage 2: Consolidated Cloud Audit ({cloud_tier})")
consolidated_auditor = {
    "role": "Consolidated Security, Blast Radius & UX Auditor",
    "type_name": "audit-agent",
    "model": cloud_tier,
    "schema": audit_schema,
    "prompt": (
        f"Ticket #{ticket_id} (Track {track}). READ-ONLY on src/ (never modify application files).\n"
        f"{CORE_PRODUCTION_DIGEST}\n"
        f"{UI_UX_DIGEST}\n"
        f"{REPO_MAP_DIGEST}\n"
        f"{GRAPH_MCP_CHEATSHEET}\n"
        f"{EXECUTION_EFFICIENCY_DIGEST}\n"
        f"Changed files ({len(changed_files)}): {', '.join(changed_files[:25])}\n"
        f"[PRE-FETCHED 2-HOP CALL-GRAPH IMPACT (0-TOKEN LOOKUP)]:\n{graph_impact_digest or 'No non-agent symbols impacted.'}\n"
        f"Pre-computed static + local Ollama findings: {json.dumps(static_findings + local_findings)}\n"
        f"Inspect git diff against {base_ref} and blueprint at {blueprint_path}. Use `get_code_snippet` or `read_file` with exact `StartLine`/`EndLine` instead of reading full files.\n"
        f"Verify:\n"
        f"1. Security & Production: 7-Point AI Security, server-side getUserTier gating, "
        f"ProcessedWebhook P2002, rate-limit-registry.ts, RLS/GDPR cascades, zero SSR secrets leaks.\n"
        f"2. Blast Radius & Data Integrity: diff matches {blueprint_path}, real Prisma persistence on NODE_ENV==='production'.\n"
        f"3. UX, A11y & Docs Parity: design-system compliance, zero emojis, E2E Reload + Dual-Persona + Light/Dark checkA11y + 375px, "
        f"and {artifact_dir}/visual_testing_evidence.md completeness."
    ),
}

cloud_res = await run_agent_with_fallback(agent, log, consolidated_auditor)

all_findings = list(static_findings) + list(local_findings)
for item in cloud_res["findings"]:
    all_findings.append({"auditor": consolidated_auditor["role"], **item})

blocking_static = any(f["severity"] in ("high", "critical") for f in static_findings)
overall_pass = cloud_res["verdict"] == "PASS" and not blocking_static

summary = {
    "ticket_id": ticket_id,
    "cloud_model_tier": cloud_tier,
    "verdict": "PASS" if overall_pass else "FAIL",
    "tests_required": bool(cloud_res["tests_required"]),
    "findings": all_findings,
    "reports": [
        {"auditor": "Static Zero-Token Guard", "findings": static_findings},
        {"auditor": f"Local Ollama ({LOCAL_CODER_MODEL})", "findings": local_findings},
        {"auditor": consolidated_auditor["role"], **cloud_res},
    ],
}
log(f"Hybrid Audit completed: {summary['verdict']} (cloud_tier={cloud_tier}, total_findings={len(all_findings)})")
print(json.dumps(summary, indent=2))
