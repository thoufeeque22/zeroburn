import hashlib
import json
import os
import re
import subprocess
import sys
import time
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

args = globals().get("args") or {}
ticket_id = args.get("ticket_id", "unknown")
blueprint_path = args.get("blueprint_path", "")
artifact_dir = args.get("artifact_dir", "")
base_ref = args.get("base_ref", "origin/main")
track = args.get("track", "M")
allow_cloud_only = bool(args.get("allow_cloud_only", False))
audit_round = int(args.get("audit_round", 1) or 1)
previous_ref = str(args.get("previous_ref", "") or "").strip()

OBSERVATIONS_FILE = ".agents/incidental_observations.json"
BLOCKING_SEVERITIES = ("critical", "high")
DEFERRED_SEVERITIES = ("medium", "low")
APP_DIFF_PATHSPECS = [
    "src/",
    "prisma/",
    ":(exclude)src/__tests__/**",
    ":(exclude)**/*.spec.ts",
    ":(exclude)**/*.test.ts",
    ":(exclude)**/*.spec.tsx",
    ":(exclude)**/*.test.tsx",
]


def is_blocking_finding(item: dict) -> bool:
    return str(item.get("severity", "")).strip().lower() in BLOCKING_SEVERITIES


def append_deferred_observations(findings: list, obs_path: str = OBSERVATIONS_FILE) -> tuple:
    """Append medium/low findings (deduplicated by file_line + reason) to OBSERVATIONS_FILE."""
    deferred = [
        item
        for item in findings
        if str(item.get("severity", "")).strip().lower() in DEFERRED_SEVERITIES
    ]
    if not deferred:
        return 0, 0

    existing = []
    if os.path.isfile(obs_path):
        try:
            with open(obs_path, "r", encoding="utf-8") as fh:
                loaded = json.load(fh)
                if isinstance(loaded, list):
                    existing = loaded
        except Exception:
            existing = []

    seen = set()
    for entry in existing:
        if isinstance(entry, dict):
            key_file = str(entry.get("file") or entry.get("file_line") or "").strip()
            key_reason = str(entry.get("observation") or entry.get("reason") or "").strip()
            if key_file or key_reason:
                seen.add((key_file, key_reason))

    appended = 0
    now_ts = int(time.time())
    for item in deferred:
        file_line = str(item.get("file_line", "")).strip()
        reason = str(item.get("reason", "")).strip()
        sev = str(item.get("severity", "medium")).strip().lower()
        if sev not in DEFERRED_SEVERITIES:
            sev = "medium"
        dedup_key = (file_line, reason)
        if dedup_key in seen or (not file_line and not reason):
            continue
        seen.add(dedup_key)
        digest = hashlib.sha1(f"{file_line}|{reason}".encode("utf-8")).hexdigest()[:8]
        existing.append({
            "id": f"OBS-{now_ts}-{digest}",
            "discovery_agent": str(item.get("auditor", "audit-agent")),
            "observation": reason,
            "file": file_line,
            "severity": sev,
        })
        appended += 1

    if appended > 0:
        obs_dir = os.path.dirname(obs_path)
        if obs_dir:
            os.makedirs(obs_dir, exist_ok=True)
        with open(obs_path, "w", encoding="utf-8") as fh:
            json.dump(existing, fh, indent=2)
            fh.write("\n")

    return len(deferred), appended


def get_app_diff(base: str, max_chars: int = 12000) -> str:
    """Return application code diff (excluding test files) truncated to max_chars."""
    try:
        return subprocess.check_output(
            ["git", "diff", "-U2", base, "--", *APP_DIFF_PATHSPECS],
            text=True,
            stderr=subprocess.DEVNULL,
        )[:max_chars]
    except Exception:
        return ""


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
        if "__tests__" in fpath or fpath.endswith((".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx")):
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


async def run_local_ollama_diff_audit(base: str, diff_text: str = None):
    """Option A: Offload diff review to local coder model (0 cloud tokens)."""
    if allow_cloud_only:
        return []
    if diff_text is None:
        diff_text = get_app_diff(base)
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
                sev = str(item.get("severity", "medium")).strip().lower()
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


async def _run_audit_workflow():
    if audit_round > 2:
        escalation_msg = "Hard cap of 2 audit rounds reached — escalate to human review"
        escalation_summary = {
            "ticket_id": ticket_id,
            "audit_round": audit_round,
            "verdict": "FAIL",
            "escalate_to_human": True,
            "reason": escalation_msg,
            "tests_required": False,
            "blocking_findings_count": 0,
            "deferred_findings_count": 0,
            "deferred_observations_appended": 0,
            "findings": [],
            "reports": [],
        }
        log(f"Hybrid Audit blocked: {escalation_msg} (ticket_id={ticket_id}, audit_round={audit_round})")
        print(json.dumps(escalation_summary, indent=2))
        return

    is_round_two = audit_round == 2
    delta_ref = previous_ref or "HEAD~1"
    eval_ref = delta_ref if is_round_two else base_ref

    call_tool_fn = globals().get("call_tool")
    await ensure_local_ollama_up(log, call_tool_fn, allow_cloud_only)

    phase(f"Stage 1: Zero-Token Static + Graph Impact + Local Ollama Audit (Round {audit_round}/2)")
    changed_files, static_findings = run_deterministic_static_audit(eval_ref, blueprint_path)
    diff_text = get_app_diff(eval_ref)
    graph_impact_digest = (
        ""
        if is_round_two
        else await prefetch_graph_impact(call_tool_fn, log, base_branch="main", depth=2)
    )
    local_findings = await run_local_ollama_diff_audit(eval_ref, diff_text=diff_text)
    log(
        f"Zero-Token Static findings: {len(static_findings)}, "
        f"Local Ollama findings: {len(local_findings)} (round={audit_round}, ref={eval_ref})"
    )

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

    if is_round_two:
        round_instruction = (
            f"[ROUND 2 OF 2 — REMEDIATION DELTA ONLY]: Evaluate ONLY the remediation delta against `{delta_ref}` "
            f"(`git diff {delta_ref}` — NEVER inspect the full diff against `{base_ref}` or re-audit unchanged files). "
            f"Verify ONLY the remediation delta and that prior Critical/High fixes are resolved without introducing new Critical/High issues.\n"
            f"Remediation delta diff excerpt (`{delta_ref}`):\n```diff\n{diff_text[:6000] or '(no non-test app diff; verify remediation delta against delta_ref)'}\n```\n"
        )
    else:
        round_instruction = (
            f"[ROUND 1 OF 2]: Inspect git diff against `{base_ref}` and blueprint at `{blueprint_path}`. "
            f"Use `get_code_snippet` or `read_file` with exact `StartLine`/`EndLine` instead of reading full files.\n"
        )

    severity_policy = (
        "SEVERITY POLICY: Only `critical` and `high` security or data-integrity vulnerabilities may fail the audit (`verdict: 'FAIL'`). "
        "Report `medium` or `low` findings (modularity >100 lines, minor blast-radius drift, style/lint nits) with `severity: 'medium' | 'low'` — "
        "they are automatically logged to `.agents/incidental_observations.json` and deferred, and MUST NOT fail `verdict` or block PR closure.\n"
    )

    phase(f"Stage 2: Consolidated Cloud Audit ({cloud_tier}, Round {audit_round}/2)")
    consolidated_auditor = {
        "role": "Consolidated Security, Blast Radius & UX Auditor",
        "type_name": "audit-agent",
        "model": cloud_tier,
        "schema": audit_schema,
        "prompt": (
            f"Ticket #{ticket_id} (Track {track}, Audit Round {audit_round}/2). READ-ONLY on src/ (never modify application files).\n"
            f"{CORE_PRODUCTION_DIGEST}\n"
            f"{UI_UX_DIGEST}\n"
            f"{REPO_MAP_DIGEST}\n"
            f"{GRAPH_MCP_CHEATSHEET}\n"
            f"{EXECUTION_EFFICIENCY_DIGEST}\n"
            f"{round_instruction}"
            f"{severity_policy}"
            f"Changed files ({len(changed_files)}): {', '.join(changed_files[:25])}\n"
            f"[PRE-FETCHED 2-HOP CALL-GRAPH IMPACT (0-TOKEN LOOKUP)]:\n{graph_impact_digest or 'No non-agent symbols impacted.'}\n"
            f"Pre-computed static + local Ollama findings: {json.dumps(static_findings + local_findings)}\n"
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
    for item in cloud_res.get("findings", []):
        all_findings.append({"auditor": consolidated_auditor["role"], **item})

    blocking_findings = [item for item in all_findings if is_blocking_finding(item)]
    deferred_count, appended_count = append_deferred_observations(all_findings)
    overall_pass = len(blocking_findings) == 0
    tests_required = bool(cloud_res.get("tests_required", False)) and not overall_pass

    summary = {
        "ticket_id": ticket_id,
        "audit_round": audit_round,
        "evaluated_ref": eval_ref,
        "cloud_model_tier": cloud_tier,
        "verdict": "PASS" if overall_pass else "FAIL",
        "tests_required": tests_required,
        "blocking_findings_count": len(blocking_findings),
        "deferred_findings_count": deferred_count,
        "deferred_observations_appended": appended_count,
        "findings": all_findings,
        "reports": [
            {"auditor": "Static Zero-Token Guard", "findings": static_findings},
            {"auditor": f"Local Ollama ({LOCAL_CODER_MODEL})", "findings": local_findings},
            {"auditor": consolidated_auditor["role"], **cloud_res},
        ],
    }
    log(
        f"Hybrid Audit completed: {summary['verdict']} "
        f"(round={audit_round}, ref={eval_ref}, cloud_tier={cloud_tier}, "
        f"blocking={len(blocking_findings)}, deferred={deferred_count}, appended={appended_count})"
    )
    print(json.dumps(summary, indent=2))


await _run_audit_workflow()
