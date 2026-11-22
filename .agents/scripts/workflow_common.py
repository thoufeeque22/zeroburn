import json
import os
import re
import subprocess
import time
import urllib.request


def _load_plugin_version() -> str:
    for candidate in (
        ".agents/plugins/zeroburn/plugin.json",
        ".agents/plugins/zeroburn/plugin.json",
    ):
        if os.path.isfile(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as fh:
                    return str(json.load(fh).get("version") or "2.6.0")
            except Exception:
                pass
    return "2.6.0"


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

_CODER_PATTERNS = (
    "qwen3-coder",
    "qwen2.5-coder",
    "qwen-coder",
    "deepseek-coder",
    "codellama",
    "starcoder",
    "codestral",
    "coder",
    "qwen3",
    "qwen2.5",
    "deepseek",
    "llama3",
    "gemma4",
    "gemma3",
)
_PROSE_PATTERNS = (
    "gemma4",
    "gemma3",
    "gemma2",
    "llama3",
    "mistral",
    "qwen3",
    "qwen2.5",
    "phi4",
    "phi3",
)


def _fetch_installed_ollama_models(timeout: float = 1.0) -> list:
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="ignore"))
            return [m.get("name", "") for m in body.get("models", []) if m.get("name")]
    except Exception:
        return []


def _select_best_model(installed: list, configured: str, patterns: tuple, fallback: str) -> str:
    if configured and configured.lower() != "auto":
        if not installed or configured in installed:
            return configured
        base = configured.split(":")[0]
        for m in installed:
            if m.split(":")[0] == base:
                return m
        return configured
    for pat in patterns:
        for m in installed:
            if pat in m.lower():
                return m
    return installed[0] if installed else fallback


_INSTALLED_MODELS = _fetch_installed_ollama_models()
LOCAL_CODER_MODEL = _select_best_model(
    _INSTALLED_MODELS,
    str(PROJECT_CONFIG.get("localCoderModel") or "auto"),
    _CODER_PATTERNS,
    "qwen2.5-coder:7b",
)
LOCAL_PROSE_MODEL = _select_best_model(
    _INSTALLED_MODELS,
    str(PROJECT_CONFIG.get("localProseModel") or "auto"),
    _PROSE_PATTERNS,
    LOCAL_CODER_MODEL or "gemma4:latest",
)
_raw_req = PROJECT_CONFIG.get("requiredLocalModels")
if not _raw_req or _raw_req == ["auto"] or _raw_req == "auto":
    REQUIRED_LOCAL_MODELS = tuple(dict.fromkeys([LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL]))
else:
    REQUIRED_LOCAL_MODELS = tuple(_raw_req)

# Auto-compute codebase-memory-mcp project slug from cwd if not explicitly configured
GRAPH_PROJECT = (
    PROJECT_CONFIG.get("graphProjectId")
    or os.getcwd().lstrip("/").replace("/", "-")
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
    or (
        "auth",
        "billing",
        "stripe",
        "tier",
        "quota",
        "prisma",
        "schema",
        "rls",
        "security",
        "webhook",
    )
)

# Hybrid Option B+C: Step down to cheaper flash/flash_lite BEFORE falling back to "inherit"
# so a weekly reserve main-thread model (e.g. Gemini 4 Argon) is never drained first.
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


def _scan_api_routes(api_root: str = "src/app/api") -> list:
    if not os.path.isdir(api_root):
        return []
    routes = []
    for root, _, files in os.walk(api_root):
        for fname in files:
            if fname in ("route.ts", "route.js"):
                full = os.path.join(root, fname)
                try:
                    with open(full, "r", encoding="utf-8", errors="ignore") as fh:
                        src = fh.read()
                    methods = re.findall(
                        r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b", src
                    )
                    rel = full.replace("\\", "/")
                    ep = "/" + re.sub(r"/route\.[tj]s$", "", re.sub(r"^src/app/", "", rel))
                    routes.append(f"{'/'.join(methods) or 'HANDLER'} {ep}")
                except Exception:
                    continue
    return sorted(routes)


def build_repo_map_digest() -> str:
    """0-token structural repo map + OpenAPI/App-Router endpoint map driven by .agents/project.config.json."""
    paths_cfg = PROJECT_CONFIG.get("paths") or {}
    schema_path = paths_cfg.get("schema") or "prisma/schema.prisma"
    lib_dir = paths_cfg.get("libDir") or "src/lib"
    actions_dir = paths_cfg.get("actionsDir") or "src/app/actions"
    singletons = paths_cfg.get("coreSingletons") or f"{lib_dir}/core/*"

    models = []
    if os.path.isfile(schema_path):
        with open(schema_path, "r", encoding="utf-8", errors="ignore") as fh:
            models = re.findall(r"^model\s+(\w+)\s+\{", fh.read(), flags=re.MULTILINE)
    lib_dirs = sorted(os.listdir(lib_dir)) if os.path.isdir(lib_dir) else []
    actions = sorted(os.listdir(actions_dir)) if os.path.isdir(actions_dir) else []
    api_routes = _scan_api_routes()
    return (
        "[PRE-COMPUTED REPO_MAP_DIGEST — DO NOT run ls/find to locate core domains or API routes]\n"
        f"- Prisma Models ({len(models)}): {', '.join(models)}\n"
        f"- {lib_dir}/* Domains: {', '.join(lib_dirs)}\n"
        f"- {actions_dir}/*: {', '.join(actions)}\n"
        f"- API Routes ({len(api_routes)}): {', '.join(api_routes[:30])}{' ...' if len(api_routes) > 30 else ''}\n"
        f"- Core Singletons: `{singletons}`."
    )


REPO_MAP_DIGEST = build_repo_map_digest()


def claim_file_leases(worker_id: str, file_paths: list) -> dict:
    """Pattern #4 (MercuryCLI/DeepCode): Claim exclusive file leases for parallel swarm/workflow workers."""
    leases = {}
    if os.path.isfile(SWARM_LEASES_FILE):
        try:
            with open(SWARM_LEASES_FILE, "r", encoding="utf-8") as fh:
                leases = json.load(fh)
        except Exception:
            leases = {}
    conflicts = []
    for fp in file_paths:
        norm = fp.strip().lstrip("./")
        owner = leases.get(norm)
        if owner and owner != worker_id:
            conflicts.append(f"{norm} (already leased by {owner})")
    if conflicts:
        raise RuntimeError(f"SWARM_FILE_LEASE_CONFLICT for {worker_id}: {', '.join(conflicts)}")
    for fp in file_paths:
        leases[fp.strip().lstrip("./")] = worker_id
    os.makedirs(os.path.dirname(SWARM_LEASES_FILE), exist_ok=True)
    with open(SWARM_LEASES_FILE, "w", encoding="utf-8") as fh:
        json.dump(leases, fh, indent=2)
    return leases


def release_file_leases(worker_id=None) -> None:
    """Release file leases held by worker_id (or clear all leases if worker_id is None)."""
    if not os.path.isfile(SWARM_LEASES_FILE):
        return
    if worker_id is None:
        os.remove(SWARM_LEASES_FILE)
        return
    try:
        with open(SWARM_LEASES_FILE, "r", encoding="utf-8") as fh:
            leases = json.load(fh)
        remaining = {k: v for k, v in leases.items() if v != worker_id}
        if remaining:
            with open(SWARM_LEASES_FILE, "w", encoding="utf-8") as fh:
                json.dump(remaining, fh, indent=2)
        else:
            os.remove(SWARM_LEASES_FILE)
    except Exception:
        pass


def _fetch_ollama_tags(timeout: float = 1.5) -> str:
    req = urllib.request.Request(f"{OLLAMA_URL}/api/tags", method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _try_spawn_ollama_daemon(log_fn) -> None:
    log_fn(f"[Local-Ollama] {OLLAMA_URL} is down — auto-starting `ollama serve`...")
    for cmd in (["ollama", "serve"], ["open", "-g", "-a", "Ollama"]):
        try:
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return
        except FileNotFoundError:
            continue
        except Exception as exc:
            log_fn(f"[Local-Ollama] Spawn attempt {cmd[0]} failed: {exc}")


async def ensure_local_ollama_up(log_fn, call_tool_fn=None, allow_cloud_only: bool = False) -> None:
    """Ensure local Ollama is running; auto-start `ollama serve` if down, and hard-stop only if startup fails."""
    if allow_cloud_only:
        log_fn("[Local-Ollama Gate] Bypassed via allow_cloud_only=True")
        return

    raw_models = ""
    try:
        raw_models = _fetch_ollama_tags()
    except Exception:
        _try_spawn_ollama_daemon(log_fn)
        for _ in range(20):
            time.sleep(0.5)
            try:
                raw_models = _fetch_ollama_tags()
                if raw_models:
                    log_fn("[Local-Ollama] Auto-started `ollama serve` successfully.")
                    break
            except Exception:
                continue

    if not raw_models and call_tool_fn is not None:
        try:
            raw_models = str(
                await call_tool_fn(
                    "call_mcp_tool",
                    ServerName="local-ollama-bridge",
                    ToolName="ollama_list",
                    Arguments={"format": "json"},
                )
            )
        except Exception as exc:
            raise RuntimeError(
                f"HARD-STOP [LOCAL_OLLAMA_DOWN]: Tried auto-starting `ollama serve`, but "
                f"Local Ollama ({OLLAMA_URL}) is still unreachable. Please verify Ollama is installed "
                "or pass allow_cloud_only=True to override."
            ) from exc

    if not raw_models:
        raise RuntimeError(
            f"HARD-STOP [LOCAL_OLLAMA_DOWN]: Auto-start of `ollama serve` timed out after 10s "
            f"and {OLLAMA_URL} is still unreachable."
        )

    global LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL, REQUIRED_LOCAL_MODELS
    try:
        parsed_tags = json.loads(raw_models)
        live_models = [m.get("name", "") for m in parsed_tags.get("models", []) if m.get("name")]
    except Exception:
        live_models = _fetch_installed_ollama_models()

    if live_models:
        LOCAL_CODER_MODEL = _select_best_model(
            live_models,
            str(PROJECT_CONFIG.get("localCoderModel") or "auto"),
            _CODER_PATTERNS,
            "qwen2.5-coder:7b",
        )
        LOCAL_PROSE_MODEL = _select_best_model(
            live_models,
            str(PROJECT_CONFIG.get("localProseModel") or "auto"),
            _PROSE_PATTERNS,
            LOCAL_CODER_MODEL,
        )
        if not _raw_req or _raw_req == ["auto"] or _raw_req == "auto":
            REQUIRED_LOCAL_MODELS = tuple(dict.fromkeys([LOCAL_CODER_MODEL, LOCAL_PROSE_MODEL]))

    missing = [m for m in REQUIRED_LOCAL_MODELS if m.split(":")[0] not in raw_models]
    if missing:
        raise RuntimeError(
            f"HARD-STOP [LOCAL_OLLAMA_MODELS_MISSING]: Missing required local Ollama models: {missing}. "
            f"Run `node .agents/scripts/init.mjs --pull` or `ollama pull {' && ollama pull '.join(missing)}` first."
        )
    log_fn(
        f"[Local-Ollama Gate] UP (coder={LOCAL_CODER_MODEL}, prose={LOCAL_PROSE_MODEL})."
    )


async def prefetch_graph_search(call_tool_fn, log_fn, query: str, limit: int = 12) -> str:
    """0-LLM-token pre-fetch of relevant symbols/routes from codebase-memory-mcp."""
    if call_tool_fn is None or not query.strip():
        return ""
    try:
        raw = await call_tool_fn(
            "call_mcp_tool",
            ServerName="codebase-memory-mcp",
            ToolName="search_graph",
            Arguments={
                "project": GRAPH_PROJECT,
                "query": query,
                "limit": limit,
                "include_connected": True,
            },
        )
        data = json.loads(str(raw))
        lines = []
        for r in data.get("results", [])[:limit]:
            fp = r.get("file_path") or "route"
            sl = r.get("start_line", 0)
            el = r.get("end_line", 0)
            qn = r.get("qualified_name", "")
            lines.append(f"- [{r.get('label')}] {r.get('name')} @ {fp}:{sl}-{el} (qn: {qn})")
        log_fn(f"[Graph Pre-Fetch] Injected {len(lines)} matching graph nodes (0 LLM tokens).")
        return "\n".join(lines)
    except Exception as exc:
        log_fn(f"[Graph Pre-Fetch] Warning: search_graph skipped ({exc})")
        return ""


async def prefetch_graph_impact(call_tool_fn, log_fn, base_branch: str = "main", depth: int = 2) -> str:
    """0-LLM-token pre-fetch of 2-hop changed/impacted call-graph symbols from codebase-memory-mcp."""
    if call_tool_fn is None:
        return ""
    try:
        raw = await call_tool_fn(
            "call_mcp_tool",
            ServerName="codebase-memory-mcp",
            ToolName="detect_changes",
            Arguments={
                "project": GRAPH_PROJECT,
                "base_branch": base_branch,
                "depth": depth,
            },
        )
        data = json.loads(str(raw))
        symbols = data.get("impacted_symbols", [])[:30]
        lines = [
            f"- [{s.get('label')}] {s.get('name')} @ {s.get('file')}"
            for s in symbols
            if not str(s.get("file", "")).startswith(".agents/")
        ]
        log_fn(f"[Graph Pre-Fetch] Injected {len(lines)} 2-hop impacted symbols (0 LLM tokens).")
        return "\n".join(lines)
    except Exception as exc:
        log_fn(f"[Graph Pre-Fetch] Warning: detect_changes skipped ({exc})")
        return ""


def is_quota_or_transient_error(err_msg: str) -> bool:
    markers = (
        "RESOURCE_EXHAUSTED",
        "429",
        "quota",
        "rate limit",
        "ended without calling finish",
        "unavailable",
    )
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
            log_fn(
                f"[Fallback] {task['role']} failed on model='{tier}' ({exc}); trying next fallback tier..."
            )
    raise last_err
