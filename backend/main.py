import csv
import re
from difflib import SequenceMatcher
from io import StringIO
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
                        "rowIndex": row_index,
                        "value": tag,
                        "normalized": normalized,
                    }
                )

    return occurrences


def build_exact_duplicate_tag_groups(
    occurrences: list[dict[str, object]],
) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = {}

    for occurrence in occurrences:
        grouped.setdefault(str(occurrence["normalized"]), []).append(occurrence)

    duplicate_groups = []

    for normalized, group_occurrences in grouped.items():
        if len(group_occurrences) < 2:
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
) -> list[dict[str, object]]:
    exact_normalized_tags = {str(group["normalizedTag"]) for group in exact_duplicate_groups}
    occurrences_by_tag: dict[str, list[dict[str, object]]] = {}
    display_by_tag: dict[str, str] = {}

    for occurrence in occurrences:
        normalized = str(occurrence["normalized"])

        if normalized in exact_normalized_tags:
            continue

        occurrences_by_tag.setdefault(normalized, []).append(occurrence)
        display_by_tag.setdefault(normalized, str(occurrence["value"]))

    tags = sorted(occurrences_by_tag)
    fuzzy_pairs = []

    for index, left_tag in enumerate(tags):
        for right_tag in tags[index + 1 :]:
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
    tag_occurrences = collect_tag_occurrences(selected_column_values)
    duplicate_tag_groups = build_exact_duplicate_tag_groups(tag_occurrences)
    fuzzy_tag_groups = build_fuzzy_tag_groups(tag_occurrences, duplicate_tag_groups)
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

