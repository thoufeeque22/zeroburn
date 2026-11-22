"""0-LLM-token codebase-memory-mcp graph pre-fetching with live filesystem verification."""
import json
import os


def verify_live_file_entry(file_path: str, start_line: int = 0, end_line: int = 0) -> tuple:
    """Verify a graph-indexed path against the live working tree to prevent silent stale hits."""
    if not file_path or file_path == "route":
        return True, start_line, end_line
    norm = file_path.lstrip("./")
    if not os.path.isfile(norm):
        return False, 0, 0
    if start_line <= 0 and end_line <= 0:
        return True, 0, 0
    try:
        with open(norm, "r", encoding="utf-8", errors="ignore") as fh:
            total_lines = sum(1 for _ in fh)
        if total_lines == 0 or start_line > total_lines:
            return False, 0, 0
        clamped_end = min(end_line, total_lines) if end_line > 0 else min(start_line + 40, total_lines)
        return True, max(1, start_line), max(start_line, clamped_end)
    except Exception:
        return False, 0, 0


async def prefetch_graph_search(
    graph_project: str, call_tool_fn, log_fn, query: str, limit: int = 12
) -> str:
    """0-LLM-token pre-fetch of relevant symbols/routes from codebase-memory-mcp with live tree verification."""
    if call_tool_fn is None or not query.strip():
        return ""
    try:
        raw = await call_tool_fn(
            "call_mcp_tool",
            ServerName="codebase-memory-mcp",
            ToolName="search_graph",
            Arguments={
                "project": graph_project,
                "query": query,
                "limit": limit,
                "include_connected": True,
            },
        )
        data = json.loads(str(raw))
        lines = []
        stale_count = 0
        for r in data.get("results", [])[:limit]:
            fp = r.get("file_path") or "route"
            sl = int(r.get("start_line") or 0)
            el = int(r.get("end_line") or 0)
            qn = r.get("qualified_name", "")
            ok, v_sl, v_el = verify_live_file_entry(fp, sl, el)
            if not ok:
                stale_count += 1
                continue
            lines.append(f"- [{r.get('label')}] {r.get('name')} @ {fp}:{v_sl}-{v_el} (qn: {qn})")
        if stale_count > 0:
            lines.append(
                f"- [STALE_INDEX_MISS] {stale_count} graph entry(ies) moved/deleted on disk; fall back to targeted search if needed."
            )
        log_fn(
            f"[Graph Pre-Fetch] Injected {len(lines)} live-verified graph nodes "
            f"(dropped {stale_count} stale entries, 0 LLM tokens)."
        )
        return "\n".join(lines)
    except Exception as exc:
        log_fn(f"[Graph Pre-Fetch] Warning: search_graph skipped ({exc})")
        return ""


async def prefetch_graph_impact(
    graph_project: str, call_tool_fn, log_fn, base_branch: str = "main", depth: int = 2
) -> str:
    """0-LLM-token pre-fetch of 2-hop changed/impacted call-graph symbols with live tree verification."""
    if call_tool_fn is None:
        return ""
    try:
        raw = await call_tool_fn(
            "call_mcp_tool",
            ServerName="codebase-memory-mcp",
            ToolName="detect_changes",
            Arguments={
                "project": graph_project,
                "base_branch": base_branch,
                "depth": depth,
            },
        )
        data = json.loads(str(raw))
        symbols = data.get("impacted_symbols", [])[:30]
        lines = []
        stale_count = 0
        for s in symbols:
            fp = str(s.get("file", ""))
            if fp.startswith(".agents/"):
                continue
            ok, _, _ = verify_live_file_entry(fp)
            if not ok:
                stale_count += 1
                continue
            lines.append(f"- [{s.get('label')}] {s.get('name')} @ {fp}")
        if stale_count > 0:
            lines.append(
                f"- [STALE_INDEX_MISS] {stale_count} impacted symbol path(s) no longer exist on disk."
            )
        log_fn(
            f"[Graph Pre-Fetch] Injected {len(lines)} live-verified 2-hop impacted symbols "
            f"(dropped {stale_count} stale entries, 0 LLM tokens)."
        )
        return "\n".join(lines)
    except Exception as exc:
        log_fn(f"[Graph Pre-Fetch] Warning: detect_changes skipped ({exc})")
        return ""
