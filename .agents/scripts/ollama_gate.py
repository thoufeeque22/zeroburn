"""Local Ollama auto-start, dynamic model resolution, and fail-closed health gate."""
import json
import subprocess
import time
import urllib.request

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


def fetch_installed_ollama_models(ollama_url: str, timeout: float = 1.0) -> list:
    try:
        req = urllib.request.Request(f"{ollama_url}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="ignore"))
            return [m.get("name", "") for m in body.get("models", []) if m.get("name")]
    except Exception:
        return []


def select_best_model(installed: list, configured: str, patterns: tuple, fallback: str) -> str:
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


def resolve_local_models(installed: list, project_config: dict) -> tuple:
    coder = select_best_model(
        installed,
        str(project_config.get("localCoderModel") or "auto"),
        _CODER_PATTERNS,
        "qwen2.5-coder:7b",
    )
    prose = select_best_model(
        installed,
        str(project_config.get("localProseModel") or "auto"),
        _PROSE_PATTERNS,
        coder or "gemma4:latest",
    )
    raw_req = project_config.get("requiredLocalModels")
    if not raw_req or raw_req == ["auto"] or raw_req == "auto":
        required = tuple(dict.fromkeys([coder, prose]))
    else:
        required = tuple(raw_req)
    return coder, prose, required


def _fetch_ollama_tags(ollama_url: str, timeout: float = 1.5) -> str:
    req = urllib.request.Request(f"{ollama_url}/api/tags", method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def _try_spawn_ollama_daemon(ollama_url: str, log_fn) -> None:
    log_fn(f"[Local-Ollama] {ollama_url} is down — auto-starting `ollama serve`...")
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


async def ensure_ollama_daemon(
    ollama_url: str,
    project_config: dict,
    log_fn,
    call_tool_fn=None,
    allow_cloud_only: bool = False,
) -> tuple:
    """Ensure local Ollama is running; auto-start `ollama serve` if down, fail-closed otherwise."""
    if allow_cloud_only:
        log_fn("[Local-Ollama Gate] Bypassed via allow_cloud_only=True")
        return resolve_local_models([], project_config)

    raw_models = ""
    try:
        raw_models = _fetch_ollama_tags(ollama_url)
    except Exception:
        _try_spawn_ollama_daemon(ollama_url, log_fn)
        for _ in range(20):
            time.sleep(0.5)
            try:
                raw_models = _fetch_ollama_tags(ollama_url)
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
                f"Local Ollama ({ollama_url}) is still unreachable. Please verify Ollama is installed "
                "or pass allow_cloud_only=True to override."
            ) from exc

    if not raw_models:
        raise RuntimeError(
            f"HARD-STOP [LOCAL_OLLAMA_DOWN]: Auto-start of `ollama serve` timed out after 10s "
            f"and {ollama_url} is still unreachable."
        )

    try:
        parsed_tags = json.loads(raw_models)
        live_models = [m.get("name", "") for m in parsed_tags.get("models", []) if m.get("name")]
    except Exception:
        live_models = fetch_installed_ollama_models(ollama_url)

    coder, prose, required = resolve_local_models(live_models, project_config)
    missing = [m for m in required if m.split(":")[0] not in raw_models]
    if missing:
        raise RuntimeError(
            f"HARD-STOP [LOCAL_OLLAMA_MODELS_MISSING]: Missing required local Ollama models: {missing}. "
            f"Run `node .agents/scripts/init.mjs --pull` or `ollama pull {' && ollama pull '.join(missing)}` first."
        )
    log_fn(f"[Local-Ollama Gate] UP (coder={coder}, prose={prose}).")
    return coder, prose, required
