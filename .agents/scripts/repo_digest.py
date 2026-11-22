"""Live 0-token structural repository digest and swarm advisory file leases."""
import json
import os
import re


def scan_api_routes(api_root: str = "src/app/api") -> list:
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


def build_repo_map_digest(project_config: dict) -> str:
    """0-token structural repo map with live tree verification for configured paths."""
    paths_cfg = project_config.get("paths") or {}
    schema_path = paths_cfg.get("schema") or "prisma/schema.prisma"
    lib_dir = paths_cfg.get("libDir") or "src/lib"
    actions_dir = paths_cfg.get("actionsDir") or "src/app/actions"
    singletons = paths_cfg.get("coreSingletons") or f"{lib_dir}/core/*"

    models = []
    stale_flags = []
    if os.path.isfile(schema_path):
        with open(schema_path, "r", encoding="utf-8", errors="ignore") as fh:
            models = re.findall(r"^model\s+(\w+)\s+\{", fh.read(), flags=re.MULTILINE)
    elif paths_cfg.get("schema"):
        stale_flags.append(f"`{schema_path}` [STALE - RE-INDEX]")

    lib_dirs = sorted(os.listdir(lib_dir)) if os.path.isdir(lib_dir) else []
    if paths_cfg.get("libDir") and not os.path.isdir(lib_dir):
        stale_flags.append(f"`{lib_dir}` [STALE - RE-INDEX]")

    actions = sorted(os.listdir(actions_dir)) if os.path.isdir(actions_dir) else []
    if paths_cfg.get("actionsDir") and not os.path.isdir(actions_dir):
        stale_flags.append(f"`{actions_dir}` [STALE - RE-INDEX]")

    singleton_base = singletons.split("*")[0].rstrip("/")
    if paths_cfg.get("coreSingletons") and singleton_base and not os.path.exists(singleton_base):
        stale_flags.append(f"`{singletons}` [STALE - RE-INDEX]")

    api_routes = scan_api_routes()
    stale_line = f"\n- Stale Config Paths: {', '.join(stale_flags)}" if stale_flags else ""
    return (
        "[PRE-COMPUTED REPO_MAP_DIGEST — DO NOT run ls/find to locate core domains or API routes]\n"
        f"- Prisma Models ({len(models)}): {', '.join(models)}\n"
        f"- {lib_dir}/* Domains: {', '.join(lib_dirs)}\n"
        f"- {actions_dir}/*: {', '.join(actions)}\n"
        f"- API Routes ({len(api_routes)}): {', '.join(api_routes[:30])}{' ...' if len(api_routes) > 30 else ''}\n"
        f"- Core Singletons: `{singletons}`.{stale_line}"
    )


def claim_file_leases(leases_file: str, worker_id: str, file_paths: list) -> dict:
    """Claim exclusive advisory file leases for parallel swarm/workflow workers."""
    leases = {}
    if os.path.isfile(leases_file):
        try:
            with open(leases_file, "r", encoding="utf-8") as fh:
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
    os.makedirs(os.path.dirname(leases_file), exist_ok=True)
    with open(leases_file, "w", encoding="utf-8") as fh:
        json.dump(leases, fh, indent=2)
    return leases


def release_file_leases(leases_file: str, worker_id=None) -> None:
    """Release file leases held by worker_id (or clear all leases if worker_id is None)."""
    if not os.path.isfile(leases_file):
        return
    if worker_id is None:
        os.remove(leases_file)
        return
    try:
        with open(leases_file, "r", encoding="utf-8") as fh:
            leases = json.load(fh)
        remaining = {k: v for k, v in leases.items() if v != worker_id}
        if remaining:
            with open(leases_file, "w", encoding="utf-8") as fh:
                json.dump(remaining, fh, indent=2)
        else:
            os.remove(leases_file)
    except Exception:
        pass
