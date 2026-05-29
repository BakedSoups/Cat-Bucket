import csv
import json
import os
import re
from difflib import SequenceMatcher
from io import StringIO
from urllib import error, request
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Data Bucket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
FUZZY_TAG_LIMIT = 5
FUZZY_TAG_THRESHOLD = 0.82
OFFLINE_LLM_STATUS = "offline_model_not_configured"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
CATEGORY_SAMPLE_LIMIT = 80
CATEGORIZATION_ROW_LIMIT = 50


# Request body for POST /api/merge/csv.
# Example from the frontend:
# {
#     "filenames": ["customers.csv", "orders.csv"]
# }
# The backend uses these names to load files already saved in backend/uploads.
class MergeCsvRequest(BaseModel):
    filenames: list[str]


# One selected column from one sheet preview.
# Example item:
# {
#     "filename": "customers.csv",
#     "column": "email",
#     "values": ["a@test.com", "b@test.com"]
# }
class SelectedColumn(BaseModel):
    filename: str
    column: str
    values: list[str]


# Request body for POST /api/merge/find-duplicates.
# Example from the frontend when the user selects multiple column headers:
# {
#     "columns": [
#         {"filename": "customers.csv", "column": "email", "values": ["a@test.com"]},
#         {"filename": "orders.csv", "column": "buyer_email", "values": ["a@test.com"]}
#     ]
# }
class DuplicateColumnsRequest(BaseModel):
    columns: list[SelectedColumn]


class CategorizeRequest(BaseModel):
    categoryColumn: SelectedColumn
    targetColumn: SelectedColumn
    contextColumns: list[SelectedColumn] = []


class AutoCategorizeRequest(BaseModel):
    filenames: list[str]


class CsvCellUpdate(BaseModel):
    filename: str
    column: str
    rowIndex: int
    value: str
    originalValue: str | None = None


class SaveMergeChangesRequest(BaseModel):
    updates: list[CsvCellUpdate]


def parse_csv(raw_content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    # Convert raw file bytes into:
    # 1. a list of column names from the header row
    # 2. a list of row dictionaries like {"email": "a@test.com"}
    try:
        text = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded.") from exc

    reader = csv.DictReader(StringIO(text))
    columns = list(reader.fieldnames or [])

    if not columns:
        raise HTTPException(status_code=400, detail="CSV must include a header row.")

    return columns, list(reader)


def get_upload_path(filename: str) -> Path:
    # Only use the base filename so a request cannot escape backend/uploads.
    # Example: "../secret.csv" becomes "secret.csv".
    safe_name = Path(unquote(filename)).name
    upload_path = UPLOAD_DIR / safe_name

    if not upload_path.exists() or not upload_path.is_file():
        raise HTTPException(status_code=404, detail="CSV upload not found.")

    return upload_path


def write_csv(upload_path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    upload_path.write_text(output.getvalue(), encoding="utf-8", newline="")


def replace_token_value(cell_value: str, original_value: str, replacement_value: str) -> str:
    if not original_value or cell_value.strip() == original_value:
        return replacement_value

    parts = re.split(r"([,;|\n]+)", cell_value)
    changed = False

    for index, part in enumerate(parts):
        if normalize_tag(part) == normalize_tag(original_value):
            parts[index] = replacement_value
            changed = True

    return "".join(parts) if changed else replacement_value


def read_selected_column_values(selected: SelectedColumn) -> dict[str, object]:
    # Read the selected CSV from disk and pull values from the selected column.
    # The frontend sends filename/column/values, but this function reads from disk
    # so the backend is the source of truth for the actual CSV data.
    upload_path = get_upload_path(selected.filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    if selected.column not in columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{selected.column}' was not found in {upload_path.name}.",
        )

    values = [row.get(selected.column, "") for row in rows]

    return {
        "filename": upload_path.name,
        "column": selected.column,
        "values": values,
    }


def normalize_tag(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def split_tag_values(value: str) -> list[str]:
    return [tag.strip() for tag in re.split(r"[,;|\n]+", value) if tag.strip()]


def get_source_key(occurrence: dict[str, object]) -> str:
    return f'{occurrence["filename"]}::{occurrence["column"]}'


def collect_tag_occurrences(
    selected_column_values: list[dict[str, object]],
) -> list[dict[str, object]]:
    occurrences = []

    for source in selected_column_values:
        filename = str(source["filename"])
        column = str(source["column"])
        values = source["values"]

        if not isinstance(values, list):
            continue

        for row_index, raw_value in enumerate(values):
            if raw_value is None:
                continue

            for tag in split_tag_values(str(raw_value)):
                normalized = normalize_tag(tag)

                if not normalized:
                    continue

                occurrences.append(
                    {
                        "filename": filename,
                        "column": column,
                        "sourceKey": f"{filename}::{column}",
                        "rowIndex": row_index,
                        "value": tag,
                        "normalized": normalized,
                    }
                )

    return occurrences


def build_exact_duplicate_tag_groups(
    occurrences: list[dict[str, object]],
    require_cross_source: bool,
) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = {}

    for occurrence in occurrences:
        grouped.setdefault(str(occurrence["normalized"]), []).append(occurrence)

    duplicate_groups = []

    for normalized, group_occurrences in grouped.items():
        source_keys = {get_source_key(occurrence) for occurrence in group_occurrences}

        if len(group_occurrences) < 2:
            continue

        if require_cross_source and len(source_keys) < 2:
            continue

        display_values = sorted({str(occurrence["value"]) for occurrence in group_occurrences})
        duplicate_groups.append(
            {
                "canonicalTag": display_values[0],
                "normalizedTag": normalized,
                "values": display_values,
                "duplicateCount": len(group_occurrences),
                "occurrences": [
                    {
                        "filename": occurrence["filename"],
                        "column": occurrence["column"],
                        "rowIndex": occurrence["rowIndex"],
                        "value": occurrence["value"],
                    }
                    for occurrence in group_occurrences
                ],
            }
        )

    return sorted(
        duplicate_groups,
        key=lambda group: (-int(group["duplicateCount"]), str(group["canonicalTag"]).lower()),
    )


def build_fuzzy_tag_groups(
    occurrences: list[dict[str, object]],
    exact_duplicate_groups: list[dict[str, object]],
    require_cross_source: bool,
) -> list[dict[str, object]]:
    exact_normalized_tags = {str(group["normalizedTag"]) for group in exact_duplicate_groups}
    occurrences_by_tag: dict[str, list[dict[str, object]]] = {}
    display_by_tag: dict[str, str] = {}
    source_keys_by_tag: dict[str, set[str]] = {}

    for occurrence in occurrences:
        normalized = str(occurrence["normalized"])

        if normalized in exact_normalized_tags:
            continue

        occurrences_by_tag.setdefault(normalized, []).append(occurrence)
        display_by_tag.setdefault(normalized, str(occurrence["value"]))
        source_keys_by_tag.setdefault(normalized, set()).add(get_source_key(occurrence))

    tags = sorted(occurrences_by_tag)
    fuzzy_pairs = []

    for index, left_tag in enumerate(tags):
        for right_tag in tags[index + 1 :]:
            combined_source_keys = source_keys_by_tag[left_tag] | source_keys_by_tag[right_tag]

            if require_cross_source and len(combined_source_keys) < 2:
                continue

            score = SequenceMatcher(None, left_tag, right_tag).ratio()

            if score >= FUZZY_TAG_THRESHOLD:
                fuzzy_pairs.append((score, left_tag, right_tag))

    fuzzy_pairs.sort(reverse=True)

    used_tags: set[str] = set()
    fuzzy_groups = []

    for score, left_tag, right_tag in fuzzy_pairs:
        if left_tag in used_tags or right_tag in used_tags:
            continue

        used_tags.update({left_tag, right_tag})
        group_tags = [left_tag, right_tag]
        group_occurrences = [
            occurrence for tag in group_tags for occurrence in occurrences_by_tag[tag]
        ]

        fuzzy_groups.append(
            {
                "suggestedTag": display_by_tag[left_tag],
                "values": [display_by_tag[tag] for tag in group_tags],
                "score": round(score, 3),
                "occurrenceCount": len(group_occurrences),
                "occurrences": [
                    {
                        "filename": occurrence["filename"],
                        "column": occurrence["column"],
                        "rowIndex": occurrence["rowIndex"],
                        "value": occurrence["value"],
                    }
                    for occurrence in group_occurrences
                ],
            }
        )

    return fuzzy_groups


def get_row_value(filename: str, column: str, row_index: int) -> str:
    upload_path = get_upload_path(filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    if column not in columns or row_index >= len(rows):
        return ""

    return rows[row_index].get(column, "")


def unique_non_empty_values(values: list[str]) -> list[str]:
    seen = set()
    unique_values = []

    for value in values:
        cleaned = value.strip()
        normalized = normalize_tag(cleaned)

        if not cleaned or normalized in seen:
            continue

        seen.add(normalized)
        unique_values.append(cleaned)

    return unique_values


def build_categorization_rows(
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> list[dict[str, object]]:
    target_values = target_column["values"]

    if not isinstance(target_values, list):
        return []

    rows = []

    for row_index, target_value in enumerate(target_values):
        context = {}

        for context_column in context_columns:
            if context_column["filename"] != target_column["filename"]:
                continue

            context_values = context_column["values"]

            if not isinstance(context_values, list) or row_index >= len(context_values):
                continue

            context[str(context_column["column"])] = str(context_values[row_index] or "")

        target_text = str(target_value or "")

        if not target_text.strip() and not any(value.strip() for value in context.values()):
            continue

        rows.append(
            {
                "filename": target_column["filename"],
                "rowIndex": row_index,
                "targetValue": target_text,
                "context": context,
            }
        )

        if len(rows) >= CATEGORIZATION_ROW_LIMIT:
            break

    return rows



def build_column_reference(filename: str, columns: list[str], rows: list[dict[str, str]]) -> list[dict[str, object]]:
    references = []

    for column in columns:
        samples = []

        for row in rows[:8]:
            value = row.get(column, "").strip()
            if value and value not in samples:
                samples.append(value)

            if len(samples) >= 5:
                break

        references.append(
            {
                "filename": filename,
                "column": column,
                "samples": samples,
                "nonEmptyCount": sum(1 for row in rows if row.get(column, "").strip()),
                "uniqueSampleCount": len({row.get(column, "").strip() for row in rows if row.get(column, "").strip()}),
            }
        )

    return references


def get_selected_column_from_disk(filename: str, column: str) -> SelectedColumn:
    upload_path = get_upload_path(filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    if column not in columns:
        raise HTTPException(status_code=400, detail=f"Column '{column}' was not found in {upload_path.name}.")

    return SelectedColumn(
        filename=upload_path.name,
        column=column,
        values=[row.get(column, "") for row in rows],
    )


def infer_categorizer_columns_with_llm(references: list[dict[str, object]]) -> tuple[dict[str, object] | None, list[str], str]:
    prompt = json.dumps(
        {
            "columns": references,
            "instructions": (
                "Pick columns for categorizing bank/purchase rows. Choose one existing column that contains the allowed category labels, "
                "one existing column whose rows need categories filled or interpreted, and useful context columns such as description, service, account, amount, purchase type, date. "
                "Return only JSON with keys categoryColumn, targetColumn, contextColumns, and questions. "
                "Each column reference must include filename and column."
            ),
        },
        ensure_ascii=True,
    )
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
        with request.urlopen(ollama_request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        parsed_response = json.loads(str(payload.get("response", "{}")))
    except (OSError, TimeoutError, error.URLError, json.JSONDecodeError):
        return None, ["The local LLM was not reachable for automatic column selection."], "offline_model_unavailable"

    questions = parsed_response.get("questions", [])
    if not isinstance(questions, list):
        questions = []

    return parsed_response, [str(question) for question in questions if str(question).strip()], "ready"


def is_known_column(reference_lookup: set[tuple[str, str]], column_ref: object) -> bool:
    return (
        isinstance(column_ref, dict)
        and (str(column_ref.get("filename", "")), str(column_ref.get("column", ""))) in reference_lookup
    )

def build_categorization_prompt(categories: list[str], rows: list[dict[str, object]]) -> str:
    payload = {
        "categories": categories[:CATEGORY_SAMPLE_LIMIT],
        "rows": rows,
        "instructions": (
            "For each row, choose exactly one category from categories. "
            "Return only JSON in this shape: "
            "{\"suggestions\":[{\"rowIndex\":0,\"suggestedCategory\":\"...\","
            "\"confidence\":0.0,\"reason\":\"short reason\"}],"
            "\"questions\":[\"short question for the user when more context is needed\"]}"
        ),
    }
    return json.dumps(payload, ensure_ascii=True)


def call_ollama_categorizer(categories: list[str], rows: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[str], str]:
    body = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": build_categorization_prompt(categories, rows),
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
        with request.urlopen(ollama_request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, TimeoutError, error.URLError, json.JSONDecodeError):
        return [], [], "offline_model_unavailable"

    try:
        parsed_response = json.loads(str(payload.get("response", "{}")))
    except json.JSONDecodeError:
        return [], [], "offline_model_invalid_response"

    suggestions = parsed_response.get("suggestions")

    if not isinstance(suggestions, list):
        return [], [], "offline_model_invalid_response"

    return suggestions, "ready"


def build_default_categorization_questions(
    category_column: dict[str, object],
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> list[str]:
    context_names = ", ".join(str(column["column"]) for column in context_columns) or "no context columns"
    return [
        f"Which rules should choose one {category_column['column']} category for each row in {target_column['column']}?",
        f"When using {context_names}, which field should matter most for the category decision?",
        "Are there categories that should only be applied after explicit user approval?",
    ]


def build_category_suggestions(
    categories: list[str],
    rows: list[dict[str, object]],
    category_column: dict[str, object],
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> tuple[list[dict[str, object]], str, list[str]]:
    llm_suggestions, llm_questions, llm_status = call_ollama_categorizer(categories, rows)

    if llm_status != "ready":
        return [], llm_status, build_default_categorization_questions(
            category_column,
            target_column,
            context_columns,
        )

    suggestions_by_row = {
        int(suggestion["rowIndex"]): suggestion
        for suggestion in llm_suggestions
        if isinstance(suggestion, dict) and "rowIndex" in suggestion
    }
    suggestions = []

    for row in rows:
        row_index = int(row["rowIndex"])
        llm_suggestion = suggestions_by_row.get(row_index)

        if not llm_suggestion or str(llm_suggestion.get("suggestedCategory", "")) not in categories:
            continue

        suggestions.append(
            {
                "filename": row["filename"],
                "rowIndex": row_index,
                "targetValue": row["targetValue"],
                "context": row["context"],
                "suggestedCategory": str(llm_suggestion["suggestedCategory"]),
                "confidence": round(max(0, min(float(llm_suggestion.get("confidence", 0.5)), 1)), 2),
                "reason": str(llm_suggestion.get("reason", "Local LLM suggestion.")),
                "method": "offline_llm",
            }
        )

    return suggestions, llm_status, llm_questions


def build_unification_candidates(
    exact_duplicate_groups: list[dict[str, object]],
    fuzzy_tag_groups: list[dict[str, object]],
) -> list[dict[str, object]]:
    candidates = []

    for group in exact_duplicate_groups:
        exact_occurrences = list(group["occurrences"])
        candidates.append(
            {
                "canonicalTag": group["canonicalTag"],
                "values": group["values"],
                "exactMatchCount": len(exact_occurrences),
                "fuzzyMatchCount": 0,
                "llmMatchCount": 0,
                "totalMatchCount": len(exact_occurrences),
                "score": 1,
                "llmStatus": OFFLINE_LLM_STATUS,
                "exactOccurrences": exact_occurrences,
                "fuzzyOccurrences": [],
                "llmOccurrences": [],
            }
        )

    for group in fuzzy_tag_groups:
        fuzzy_occurrences = list(group["occurrences"])
        candidates.append(
            {
                "canonicalTag": group["suggestedTag"],
                "values": group["values"],
                "exactMatchCount": 0,
                "fuzzyMatchCount": len(fuzzy_occurrences),
                "llmMatchCount": 0,
                "totalMatchCount": len(fuzzy_occurrences),
                "score": group["score"],
                "llmStatus": OFFLINE_LLM_STATUS,
                "exactOccurrences": [],
                "fuzzyOccurrences": fuzzy_occurrences,
                "llmOccurrences": [],
            }
        )

    return sorted(
        candidates,
        key=lambda candidate: (
            -int(candidate["totalMatchCount"]),
            -float(candidate["score"]),
            str(candidate["canonicalTag"]).lower(),
        ),
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/uploads/csv")
def list_csv_uploads() -> dict[str, list[dict[str, object]]]:
    uploads = []

    for upload_path in sorted(UPLOAD_DIR.glob("*.csv"), key=lambda path: path.stat().st_mtime, reverse=True):
        raw_content = upload_path.read_bytes()
        columns, rows = parse_csv(raw_content)
        stat = upload_path.stat()
        uploads.append(
            {
                "filename": upload_path.name,
                "rows": len(rows),
                "columns": columns,
                "size": stat.st_size,
                "modified_at": stat.st_mtime,
            }
        )

    return {"uploads": uploads}


@app.get("/api/uploads/csv/{filename}")
def get_csv_upload(filename: str) -> dict[str, object]:
    upload_path = get_upload_path(filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    return {
        "filename": upload_path.name,
        "rows": rows,
        "row_count": len(rows),
        "columns": columns,
    }


@app.post("/api/uploads/csv")
async def upload_csv(file: UploadFile = File(...)) -> dict[str, object]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file.")

    raw_content = await file.read()
    columns, rows = parse_csv(raw_content)
    destination = UPLOAD_DIR / Path(file.filename).name
    destination.write_bytes(raw_content)

    return {
        "filename": destination.name,
        "rows": len(rows),
        "columns": columns,
    }


@app.post("/api/merge/csv")
def merge_csv_uploads(request: MergeCsvRequest) -> dict[str, object]:
    # The merge screen calls this first to get preview data for selected files.
    # It does not merge rows yet; it returns each selected CSV with rows/columns.
    if len(request.filenames) < 2:
        raise HTTPException(status_code=400, detail="Select at least two CSV files to merge.")

    files = []

    for filename in request.filenames:
        # Look up each selected upload by filename, then parse it for the UI preview.
        upload_path = get_upload_path(filename)
        columns, rows = parse_csv(upload_path.read_bytes())
        files.append(
            {
                "filename": upload_path.name,
                "rows": rows,
                "row_count": len(rows),
                "columns": columns,
            }
        )

    return {
        "selected_filenames": request.filenames,
        "files": files,
    }


@app.post("/api/merge/find-duplicates")
def find_duplicate_columns(request: DuplicateColumnsRequest) -> dict[str, object]:
    # The frontend calls this after the user selects tag-like columns.
    # It returns exact duplicate tag groups, a five-group fuzzy preview,
    # and a count of remaining fuzzy groups for a later LLM review pass.
    if not request.columns:
        raise HTTPException(status_code=400, detail="Select at least one column.")

    selected_column_values = []

    for selected in request.columns:
        column_data = read_selected_column_values(selected)
        selected_column_values.append(column_data)

    print("Selected column values:", selected_column_values, flush=True)
    require_cross_source = len(request.columns) > 1
    tag_occurrences = collect_tag_occurrences(selected_column_values)
    duplicate_tag_groups = build_exact_duplicate_tag_groups(
        tag_occurrences,
        require_cross_source,
    )
    fuzzy_tag_groups = build_fuzzy_tag_groups(
        tag_occurrences,
        duplicate_tag_groups,
        require_cross_source,
    )
    fuzzy_preview_groups = fuzzy_tag_groups[:FUZZY_TAG_LIMIT]
    unification_candidates = build_unification_candidates(
        duplicate_tag_groups,
        fuzzy_tag_groups,
    )
    llm_candidate_count = max(len(fuzzy_tag_groups) - FUZZY_TAG_LIMIT, 0)

    return {
        "sources": [selected.model_dump() for selected in request.columns],
        "selectedColumnValues": selected_column_values,
        "matches": [],
        "duplicateTagGroups": duplicate_tag_groups,
        "fuzzyTagGroups": fuzzy_preview_groups,
        "unificationCandidates": unification_candidates,
        "summary": {
            "tagCount": len(tag_occurrences),
            "uniqueTagCount": len({str(occurrence["normalized"]) for occurrence in tag_occurrences}),
            "duplicateGroupCount": len(duplicate_tag_groups),
            "fuzzyGroupCount": len(fuzzy_tag_groups),
            "fuzzyPreviewLimit": FUZZY_TAG_LIMIT,
            "llmCandidateCount": llm_candidate_count,
            "llmMatchCount": 0,
            "llmStatus": OFFLINE_LLM_STATUS,
        },
    }



@app.post("/api/merge/categorize")
def categorize_rows(request_body: CategorizeRequest) -> dict[str, object]:
    category_column = read_selected_column_values(request_body.categoryColumn)
    target_column = read_selected_column_values(request_body.targetColumn)
    context_columns = [
        read_selected_column_values(context_column)
        for context_column in request_body.contextColumns
    ]
    category_values = category_column["values"]

    if not isinstance(category_values, list):
        raise HTTPException(status_code=400, detail="Category column could not be read.")

    categories = unique_non_empty_values([str(value or "") for value in category_values])

    if not categories:
        raise HTTPException(status_code=400, detail="Category column has no categories.")

    rows = build_categorization_rows(target_column, context_columns)

    if not rows:
        raise HTTPException(status_code=400, detail="No rows were available to categorize.")

    suggestions, llm_status, questions = build_category_suggestions(
        categories,
        rows,
        category_column,
        target_column,
        context_columns,
    )

    return {
        "categoryColumn": category_column,
        "targetColumn": target_column,
        "contextColumns": context_columns,
        "categories": categories,
        "suggestions": suggestions,
        "questions": questions,
        "summary": {
            "categoryCount": len(categories),
            "rowCount": len(rows),
            "suggestionCount": len(suggestions),
            "llmStatus": llm_status,
            "ollamaModel": OLLAMA_MODEL,
        },
    }


@app.post("/api/merge/save-changes")
def save_merge_changes(request_body: SaveMergeChangesRequest) -> dict[str, object]:
    updates_by_file: dict[str, list[CsvCellUpdate]] = {}

    for update in request_body.updates:
        updates_by_file.setdefault(Path(unquote(update.filename)).name, []).append(update)

    saved_updates = 0

    for filename, updates in updates_by_file.items():
        upload_path = get_upload_path(filename)
        columns, rows = parse_csv(upload_path.read_bytes())

        for update in updates:
            if update.column not in columns or update.rowIndex < 0 or update.rowIndex >= len(rows):
                continue

            current_value = rows[update.rowIndex].get(update.column, "")
            rows[update.rowIndex][update.column] = replace_token_value(
                current_value,
                update.originalValue or current_value,
                update.value,
            )
            saved_updates += 1

        write_csv(upload_path, columns, rows)

    return {"savedUpdateCount": saved_updates}


@app.post("/api/merge/auto-categorize")
def auto_categorize_rows(request_body: AutoCategorizeRequest) -> dict[str, object]:
    references = []

    for filename in request_body.filenames:
        upload_path = get_upload_path(filename)
        columns, rows = parse_csv(upload_path.read_bytes())
        references.extend(build_column_reference(upload_path.name, columns, rows))

    if not references:
        raise HTTPException(status_code=400, detail="No CSV columns were available for auto categorization.")

    reference_lookup = {
        (str(reference["filename"]), str(reference["column"]))
        for reference in references
    }
    inferred, inference_questions, inference_status = infer_categorizer_columns_with_llm(references)

    if not inferred:
        return {
            "categoryColumn": None,
            "targetColumn": None,
            "contextColumns": [],
            "categories": [],
            "suggestions": [],
            "questions": inference_questions,
            "summary": {
                "categoryCount": 0,
                "rowCount": 0,
                "suggestionCount": 0,
                "llmStatus": inference_status,
                "ollamaModel": OLLAMA_MODEL,
                "autoSelected": False,
            },
        }

    category_ref = inferred.get("categoryColumn")
    target_ref = inferred.get("targetColumn")
    context_refs = inferred.get("contextColumns", [])

    if not is_known_column(reference_lookup, category_ref) or not is_known_column(reference_lookup, target_ref):
        return {
            "categoryColumn": None,
            "targetColumn": None,
            "contextColumns": [],
            "categories": [],
            "suggestions": [],
            "questions": inference_questions + ["The local LLM did not identify valid category and target columns."],
            "summary": {
                "categoryCount": 0,
                "rowCount": 0,
                "suggestionCount": 0,
                "llmStatus": "auto_column_selection_invalid",
                "ollamaModel": OLLAMA_MODEL,
                "autoSelected": False,
            },
        }

    valid_context_refs = [
        context_ref
        for context_ref in context_refs
        if is_known_column(reference_lookup, context_ref)
    ] if isinstance(context_refs, list) else []

    category_column = get_selected_column_from_disk(str(category_ref["filename"]), str(category_ref["column"]))
    target_column = get_selected_column_from_disk(str(target_ref["filename"]), str(target_ref["column"]))
    context_columns = [
        get_selected_column_from_disk(str(context_ref["filename"]), str(context_ref["column"]))
        for context_ref in valid_context_refs
    ]

    response = categorize_rows(
        CategorizeRequest(
            categoryColumn=category_column,
            targetColumn=target_column,
            contextColumns=context_columns,
        )
    )
    response["questions"] = inference_questions + list(response.get("questions", []))
    response["summary"]["autoSelected"] = True
    return response
