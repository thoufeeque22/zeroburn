"""Shared orchestration config, digests, fallback chains, and re-exports for ZeroBurn workflows."""
import json
import os
import sys

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from graph_prefetch import (  # noqa: E402
    prefetch_graph_impact as _prefetch_graph_impact,
    prefetch_graph_search as _prefetch_graph_search,
    verify_live_file_entry as _verify_live_file_entry,
)
from ollama_gate import (  # noqa: E402
    ensure_ollama_daemon,
    fetch_installed_ollama_models,
    resolve_local_models,
)
from repo_digest import (  # noqa: E402
    build_repo_map_digest as _build_repo_map_digest,
    claim_file_leases as _claim_file_leases,
    release_file_leases as _release_file_leases,
    scan_api_routes as _scan_api_routes,
)


def _load_plugin_version() -> str:
    for candidate in (
        ".agents/plugins/zeroburn/plugin.json",
        ".agents/plugins/zeroburn/plugin.json",
    ):
        if os.path.isfile(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as fh:
                    return str(json.load(fh).get("version") or "2.11.1")
            except Exception:
                pass
    return "2.11.1"


def _load_project_config() -> dict:
    for candidate in (".agents/project.config.json", ".agents/project.config.example.json"):
        if os.path.isfile(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:
                pass
    return {}


PROJECT_CONFIG = _load_project_config()
ZEROBURN_VERSION = _load_plugin_version()
BRAND_NAME = PROJECT_CONFIG.get("brandName") or PROJECT_CONFIG.get("projectName") or "project"
STACK_SUMMARY = PROJECT_CONFIG.get("stackSummary") or "Next.js App Router + TypeScript + Prisma"
OLLAMA_URL = (PROJECT_CONFIG.get("ollamaUrl") or "http://127.0.0.1:11434").rstrip("/")
MAX_LINES_PER_FILE = int(PROJECT_CONFIG.get("maxLinesPerFile") or 200)
SWARM_LEASES_FILE = ".agents/swarm_leases.json"

_INSTALLED_MODELS = fetch_installed_ollama_models(OLLAMA_URL)
LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL, REQUIRED_LOCAL_MODELS = resolve_local_models(
    _INSTALLED_MODELS, PROJECT_CONFIG
)

GRAPH_PROJECT = (
    PROJECT_CONFIG.get("graphProjectId") or os.getcwd().lstrip("/").replace("/", "-")
)

HIGH_RISK_PREFIXES = tuple(
    PROJECT_CONFIG.get("highRiskPrefixes")
    or (
        "src/lib/auth/",
        "src/lib/billing/",
        "src/lib/ai/",
        "src/app/api/webhooks/",
        "prisma/schema.prisma",
    )
)

HIGH_RISK_KEYWORDS = tuple(
    PROJECT_CONFIG.get("highRiskKeywords")
    or ("auth", "billing", "stripe", "tier", "quota", "prisma", "schema", "rls", "security", "webhook")
)

FALLBACK_CHAINS = {
    "pro": ["pro", "flash", "flash_lite", "inherit"],
    "flash": ["flash", "flash_lite", "pro", "inherit"],
    "flash_lite": ["flash_lite", "flash", "inherit"],
    "inherit": ["inherit", "flash", "flash_lite", "pro"],
}

_digests_cfg = PROJECT_CONFIG.get("digests") or {}
_ui_lines = _digests_cfg.get("uiUx") or [
    "Zero raw Unicode emojis in UI components.",
    "Theme-aware colors only; WCAG AA >=4.5:1 contrast in Light & Dark.",
    (
        "Customer UI Copy Policy: pair domain brand terms (`<brand-terms>`) with `<TermTooltip>` + "
        "canonical setup doc links (`/docs/<guide>`); render human-readable tier names via `formatTierName()` (ban raw DB enums in UI); "
        "ban internal engineering jargon (`OAuth`/`SSRF`/`RBAC`/`Zod`/`RSC`/`403`/`500`/DB errors/config keys) in "
        "customer alerts/banners/pricing (provider setup forms keep exact labels + plain-English helper text + doc link)."
    ),
]
_core_lines = _digests_cfg.get("coreProduction") or [
    f"Strict TypeScript: Zero `any`; <= {MAX_LINES_PER_FILE} lines per file; `'use server';` on line 1.",
]

UI_UX_DIGEST = "[INLINED UI_UX.md DIGEST — DO NOT read_file .agents/base/UI_UX.md]\n" + "\n".join(
    f"- {line}" for line in _ui_lines
)

CORE_PRODUCTION_DIGEST = (
    "[INLINED CORE.md + PRODUCTION.md DIGEST — DO NOT read_file .agents/base/CORE.md or PRODUCTION.md]\n"
    + "\n".join(f"- {line}" for line in _core_lines)
)

GRAPH_MCP_CHEATSHEET = (
    f"[CODEBASE-MEMORY-MCP FAST-CALL CHEATSHEET — DO NOT call list_projects or read MCP schema JSONs]\n"
    f"- Project ID: `{GRAPH_PROJECT}`\n"
    f"- Search symbols: `call_mcp_tool(ServerName='codebase-memory-mcp', ToolName='search_graph', Arguments={{'project': '{GRAPH_PROJECT}', 'query': '<keywords>', 'limit': 15}})`\n"
    f"- Trace callers/callees: `call_mcp_tool(ServerName='codebase-memory-mcp', ToolName='trace_path', Arguments={{'project': '{GRAPH_PROJECT}', 'function_name': '<fn>', 'direction': 'both', 'depth': 2}})`\n"
    f"- Read single symbol source: `call_mcp_tool(ServerName='codebase-memory-mcp', ToolName='get_code_snippet', Arguments={{'project': '{GRAPH_PROJECT}', 'qualified_name': '<qn>'}})` (or `read_file` with exact `StartLine`/`EndLine`)."
)

EXECUTION_EFFICIENCY_DIGEST = (
    "[TOKEN & TURN EFFICIENCY RULES (TRICKS 1, 2, 5, 7 + <=4 HANDOFF CAP)]\n"
    "1. Parallel Tool Batching: Batch all independent `read_file`, `edit_file`, and `call_mcp_tool` calls into 1 parallel turn; never make sequential 1-tool turns when targets are known.\n"
    "2. Quiet CLI + Judgment Kernel: Run verification via `node .agents/scripts/quiet-cli.mjs <tsc|lint|unit|pr-check|api-map>` to emit 1-line summaries (and local Ollama Judgment Kernel failure digests).\n"
    "3. Multi-File Codemods: For mechanical renames/imports across >=4 files, run a single 1-shot Python/Node transform script instead of N `edit_file` calls.\n"
    "4. Caveman Output Compression: Reply in terse caveman-compressed bullets / strict JSON (`file:line` + action/reason only; zero pleasantries or filler prose)."
)


def build_repo_map_digest() -> str:
    return _build_repo_map_digest(PROJECT_CONFIG)


REPO_MAP_DIGEST = build_repo_map_digest()


def claim_file_leases(worker_id: str, file_paths: list) -> dict:
    return _claim_file_leases(SWARM_LEASES_FILE, worker_id, file_paths)


def release_file_leases(worker_id=None) -> None:
    _release_file_leases(SWARM_LEASES_FILE, worker_id)


async def ensure_local_ollama_up(log_fn, call_tool_fn=None, allow_cloud_only: bool = False) -> None:
    global LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL, REQUIRED_LOCAL_MODELS
    LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL, REQUIRED_LOCAL_MODELS = await ensure_ollama_daemon(
        OLLAMA_URL, PROJECT_CONFIG, log_fn, call_tool_fn, allow_cloud_only
    )


async def prefetch_graph_search(call_tool_fn, log_fn, query: str, limit: int = 12) -> str:
    return await _prefetch_graph_search(GRAPH_PROJECT, call_tool_fn, log_fn, query, limit)


async def prefetch_graph_impact(call_tool_fn, log_fn, base_branch: str = "main", depth: int = 2) -> str:
    return await _prefetch_graph_impact(GRAPH_PROJECT, call_tool_fn, log_fn, base_branch, depth)


def is_quota_or_transient_error(err_msg: str) -> bool:
    markers = ("RESOURCE_EXHAUSTED", "429", "quota", "rate limit", "ended without calling finish", "unavailable")
    lower = err_msg.lower()
    return any(m.lower() in lower for m in markers)


async def run_agent_with_fallback(agent_fn, log_fn, task: dict):
    chain = FALLBACK_CHAINS.get(task["model"], [task["model"], "flash", "inherit"])
    last_err = None
    for tier in chain:
        try:
            return await agent_fn(
                prompt=task["prompt"],
                schema=task["schema"],
                role=f"{task['role']} ({tier})",
                type_name=task.get("type_name", "audit-agent"),
                workspace=task.get("workspace", "inherit"),
                model=tier,
            )
        except Exception as exc:
            last_err = exc
            if not is_quota_or_transient_error(str(exc)):
                raise
            log_fn(f"[Fallback] {task['role']} failed on model='{tier}' ({exc}); trying next fallback tier...")
    raise last_err
