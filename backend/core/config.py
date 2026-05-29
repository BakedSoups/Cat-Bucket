import os
from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

FUZZY_TAG_LIMIT = 5
FUZZY_TAG_THRESHOLD = 0.82
OFFLINE_LLM_STATUS = "offline_model_not_configured"

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

CATEGORY_SAMPLE_LIMIT = 40
CATEGORIZATION_ROW_LIMIT = 15
