import json
from urllib import error, request

from core.config import OLLAMA_BASE_URL, OLLAMA_MODEL


def generate_json(prompt: str, timeout_seconds: int = 60) -> tuple[dict[str, object] | None, str]:
    body = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }
    ).encode("utf-8")
    ollama_request = request.Request(
        f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(ollama_request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except TimeoutError:
        return None, "offline_model_timeout"
    except (OSError, error.URLError, json.JSONDecodeError):
        return None, "offline_model_unavailable"

    try:
        parsed_response = json.loads(str(payload.get("response", "{}")))
    except json.JSONDecodeError:
        return None, "offline_model_invalid_response"

    if not isinstance(parsed_response, dict):
        return None, "offline_model_invalid_response"

    return parsed_response, "ready"
