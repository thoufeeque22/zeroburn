import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath(".agents/scripts"))
from workflow_common import (  # noqa: E402
    CORE_PRODUCTION_DIGEST,
    EXECUTION_EFFICIENCY_DIGEST,
    GRAPH_MCP_CHEATSHEET,
    HIGH_RISK_KEYWORDS,
    REPO_MAP_DIGEST,
    UI_UX_DIGEST,
    ensure_local_ollama_up,
    prefetch_graph_search,
    run_agent_with_fallback,
)


def detect_in_progress_branch_files(base_ref: str = "origin/main") -> list[str]:
    """Return modified/committed file paths if the current branch already has work in progress."""
    files = set()
    try:
        committed = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base_ref}...HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        for line in committed.splitlines():
            if line.strip():
                files.add(line.strip())
    except Exception:
        pass
    try:
        unstaged = subprocess.check_output(
            ["git", "diff", "--name-only", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        for line in unstaged.splitlines():
            if line.strip():
                files.add(line.strip())
    except Exception:
        pass
    return sorted(files)


ticket_id = args.get("ticket_id", "unknown")
summary = args.get("summary", "")
artifact_dir = args.get("artifact_dir", "")
track = args.get("track", "M")
base_ref = args.get("base_ref", "origin/main")
pricing = bool(args.get("pricing_strategy", False))
pure_backend = bool(args.get("pure_backend", False))
skip_product = bool(args.get("skip_product", False)) or pure_backend
skip_discovery = bool(args.get("skip_discovery", False))
pre_specced_files = args.get("pre_specced_files", []) or []
allow_cloud_only = bool(args.get("allow_cloud_only", False))

in_progress_files = detect_in_progress_branch_files(base_ref)
already_worked_on = bool(args.get("already_worked_on", False)) or len(in_progress_files) > 0

if already_worked_on and not bool(args.get("force_stage1", False)):
    skip_product = True
    skip_discovery = True

call_tool_fn = globals().get("call_tool")
if not (skip_product and skip_discovery):
    await ensure_local_ollama_up(log, call_tool_fn, allow_cloud_only)

graph_nodes_digest = await prefetch_graph_search(call_tool_fn, log, summary, limit=15)

product_schema = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["APPROVED", "NEEDS-INFO", "REJECTED"]},
        "questions": {"type": "array", "items": {"type": "string"}},
        "ux_copy_summary": {"type": "string"},
        "tier_matrix": {"type": "string"},
    },
    "required": ["verdict", "questions", "ux_copy_summary", "tier_matrix"],
}

discovery_schema = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["APPROVED", "NEEDS-INFO", "REJECTED"]},
        "questions": {"type": "array", "items": {"type": "string"}},
        "blast_radius_files": {"type": "array", "items": {"type": "string"}},
        "technical_specs": {"type": "string"},
        "acceptance_scenarios": {"type": "array", "items": {"type": "string"}},
        "required_testids": {"type": "array", "items": {"type": "string"}},
        "sub_issue_proposals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "vertical_slice": {"type": "string"},
                    "files": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "vertical_slice", "files"],
            },
        },
    },
    "required": [
        "verdict",
        "questions",
        "blast_radius_files",
        "technical_specs",
        "acceptance_scenarios",
        "required_testids",
        "sub_issue_proposals",
    ],
}

phase("Product || Discovery")
product_prompt = (
    f"Product Stage for ticket #{ticket_id} (Track {track}).\n"
    f"{UI_UX_DIGEST}\n"
    f"{EXECUTION_EFFICIENCY_DIGEST}\n"
    f"Task: {summary}\n"
    f"Write product_spec.md into {artifact_dir} if applicable, or use Fast-Lane APPROVED (N/A - Internal) for pure backend/infra."
)
discovery_prompt = (
    f"Discovery Stage for ticket #{ticket_id} (Track {track}).\n"
    f"{CORE_PRODUCTION_DIGEST}\n"
    f"{REPO_MAP_DIGEST}\n"
    f"{GRAPH_MCP_CHEATSHEET}\n"
    f"{EXECUTION_EFFICIENCY_DIGEST}\n"
    f"[PRE-FETCHED GRAPH NODES (0-TOKEN LOOKUP)]:\n{graph_nodes_digest or 'None matched directly; query search_graph using GRAPH_MCP_CHEATSHEET above.'}\n"
    f"Task: {summary}\n"
    f"Use the pre-fetched graph nodes and `trace_path` / `get_code_snippet` (or `read_file` with exact `StartLine`/`EndLine` ranges) instead of reading whole files.\n"
    f"Define 5-dimension blast radius, QA acceptance scenarios, explicit data-testid names, and 2-4 vertical Track L sub-issue proposals if Track == 'L'."
)

is_high_risk = track == "L" or pricing or any(k in summary.lower() for k in HIGH_RISK_KEYWORDS)
discovery_tier = "0-token-bypass" if skip_discovery else ("pro" if is_high_risk else "flash")

discovery_task = {
    "role": "Discovery Architect",
    "type_name": "discovery-agent",
    "model": "pro" if is_high_risk else "flash",
    "prompt": discovery_prompt,
    "schema": discovery_schema,
}

product_task = {
    "role": "Product Strategist",
    "type_name": "product-agent",
    "model": "pro" if pricing else "flash",
    "prompt": product_prompt,
    "schema": product_schema,
}

fast_lane_product_res = {
    "verdict": "APPROVED",
    "questions": [],
    "ux_copy_summary": (
        "APPROVED (Fast-Lane 0-Token Bypass: In-Progress Branch)"
        if already_worked_on
        else (
            "APPROVED (N/A - Internal Backend/Infra)"
            if pure_backend
            else "APPROVED (Fast-Lane 0-Token Bypass: Pre-Specced UX / Bugfix / Refactor)"
        )
    ),
    "tier_matrix": "Existing or pre-specced tier contract applies",
}

merged_blast_files = sorted(set(pre_specced_files) | set(in_progress_files))
fast_lane_discovery_res = {
    "verdict": "APPROVED",
    "questions": [],
    "blast_radius_files": merged_blast_files,
    "technical_specs": (
        f"0-Token Fast-Lane Discovery Bypass ({'in-progress branch resume' if already_worked_on else 'pre-specced ticket / Track L child sub-issue'}).\n"
        f"Pre-fetched Graph Nodes:\n{graph_nodes_digest or 'N/A'}"
    ),
    "acceptance_scenarios": ["Verify ticket acceptance criteria and regression tests pass."],
    "required_testids": [],
    "sub_issue_proposals": [],
}

if skip_product and skip_discovery:
    log(
        f"[Fast-Lane] Skipping both product-agent and discovery-agent (0 cloud tokens). "
        f"already_worked_on={already_worked_on}, pre_specced_files={len(merged_blast_files)}"
    )
    product_res = fast_lane_product_res
    discovery_res = fast_lane_discovery_res
elif skip_product and not skip_discovery:
    log("[Fast-Lane] Skipping product-agent spawn (0 tokens); running discovery-agent only.")
    product_res = fast_lane_product_res
    discovery_res = await run_agent_with_fallback(agent, log, discovery_task)
elif not skip_product and skip_discovery:
    log("[Fast-Lane] Skipping discovery-agent spawn (0 tokens); running product-agent only.")
    product_res = await run_agent_with_fallback(agent, log, product_task)
    discovery_res = fast_lane_discovery_res
else:
    product_res, discovery_res = await parallel(
        [product_task, discovery_task],
        lambda t: run_agent_with_fallback(agent, log, t),
    )

blocked = product_res["verdict"] != "APPROVED" or discovery_res["verdict"] != "APPROVED"
output = {
    "ticket_id": ticket_id,
    "track": track,
    "already_worked_on": already_worked_on,
    "skipped_product": skip_product,
    "skipped_discovery": skip_discovery,
    "discovery_model_tier": discovery_tier,
    "overall_verdict": "NEEDS-INFO" if blocked else "APPROVED",
    "product": product_res,
    "discovery": discovery_res,
}
log(
    f"Parallel Discovery finished: {output['overall_verdict']} "
    f"(discovery_tier={discovery_tier}, skip_product={skip_product}, skip_discovery={skip_discovery})"
)
print(json.dumps(output, indent=2))
