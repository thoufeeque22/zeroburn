import json
import os
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

ticket_id = args.get("ticket_id", "unknown")
summary = args.get("summary", "")
artifact_dir = args.get("artifact_dir", "")
track = args.get("track", "M")
pricing = bool(args.get("pricing_strategy", False))
pure_backend = bool(args.get("pure_backend", False))
allow_cloud_only = bool(args.get("allow_cloud_only", False))

call_tool_fn = globals().get("call_tool")
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
discovery_tier = "pro" if is_high_risk else "flash"

discovery_task = {
    "role": "Discovery Architect",
    "type_name": "discovery-agent",
    "model": discovery_tier,
    "prompt": discovery_prompt,
    "schema": discovery_schema,
}

if pure_backend:
    log("[Fast-Lane] Pure backend/infra ticket: skipping product-agent spawn (0 tokens).")
    product_res = {
        "verdict": "APPROVED",
        "questions": [],
        "ux_copy_summary": "APPROVED (N/A - Internal Backend/Infra)",
        "tier_matrix": "No UI/tier surface change",
    }
    discovery_res = await run_agent_with_fallback(agent, log, discovery_task)
else:
    product_task = {
        "role": "Product Strategist",
        "type_name": "product-agent",
        "model": "pro" if pricing else "flash",
        "prompt": product_prompt,
        "schema": product_schema,
    }
    product_res, discovery_res = await parallel(
        [product_task, discovery_task],
        lambda t: run_agent_with_fallback(agent, log, t),
    )

blocked = product_res["verdict"] != "APPROVED" or discovery_res["verdict"] != "APPROVED"
output = {
    "ticket_id": ticket_id,
    "track": track,
    "discovery_model_tier": discovery_tier,
    "overall_verdict": "NEEDS-INFO" if blocked else "APPROVED",
    "product": product_res,
    "discovery": discovery_res,
}
log(f"Parallel Discovery finished: {output['overall_verdict']} (discovery_tier={discovery_tier})")
print(json.dumps(output, indent=2))
