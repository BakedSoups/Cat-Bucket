import csv
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
    "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


class MergeCsvRequest(BaseModel):
    filenames: list[str]


class SelectedColumn(BaseModel):
    filename: str
    column: str
    values: list[str]


class DuplicateColumnsRequest(BaseModel):
    columns: list[SelectedColumn]


def parse_csv(raw_content: bytes) -> tuple[list[str], list[dict[str, str]]]:
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
    safe_name = Path(unquote(filename)).name
    upload_path = UPLOAD_DIR / safe_name

    if not upload_path.exists() or not upload_path.is_file():
        raise HTTPException(status_code=404, detail="CSV upload not found.")

    return upload_path


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
    if len(request.filenames) < 2:
        raise HTTPException(status_code=400, detail="Select at least two CSV files to merge.")

    files = []

    for filename in request.filenames:
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
    if not request.columns:
        raise HTTPException(status_code=400, detail="Select at least one column.")

    source_value_map = {}

    for selected in request.columns:
        get_upload_path(selected.filename)
        values = {value.strip() for value in selected.values if value and value.strip()}
        source_value_map[(selected.filename, selected.column)] = values

    matches = []

    for upload_path in sorted(UPLOAD_DIR.glob("*.csv")):
        columns, rows = parse_csv(upload_path.read_bytes())

        for column in columns:
            column_values = {
                row.get(column, "").strip()
                for row in rows
                if row.get(column, "").strip()
            }

            matched_sources = []
            duplicate_values = set()

            for source_key, source_values in source_value_map.items():
                source_filename, source_column = source_key

                if upload_path.name == source_filename and column == source_column:
                    continue

                overlap = source_values.intersection(column_values)

                if overlap:
                    duplicate_values.update(overlap)
                    matched_sources.append(
                        {
                            "filename": source_filename,
                            "column": source_column,
                        }
                    )

            if duplicate_values:
                matches.append(
                    {
                        "filename": upload_path.name,
                        "column": column,
                        "duplicateValues": sorted(duplicate_values),
                        "duplicateCount": len(duplicate_values),
                        "matchedSources": matched_sources,
                    }
                )

    return {
        "sources": [selected.model_dump() for selected in request.columns],
        "matches": matches,
    }

