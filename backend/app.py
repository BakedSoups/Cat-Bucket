from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from core.csv_store import (
    get_csv_upload,
    list_csv_uploads,
    preview_csv_uploads,
    save_cell_updates,
    save_uploaded_csv,
)
from core.models import (
    AutoCategorizeRequest,
    CategorizeRequest,
    DuplicateColumnsRequest,
    MergeCsvRequest,
    SaveMergeChangesRequest,
)
from core.unification import find_duplicate_columns
from ml.categorization import auto_categorize_rows, categorize_rows


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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/uploads/csv")
def list_uploads_route() -> dict[str, list[dict[str, object]]]:
    return list_csv_uploads()


@app.get("/api/uploads/csv/{filename}")
def get_upload_route(filename: str) -> dict[str, object]:
    return get_csv_upload(filename)


@app.post("/api/uploads/csv")
async def upload_csv_route(file: UploadFile = File(...)) -> dict[str, object]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file.")

    raw_content = await file.read()
    safe_filename = Path(file.filename).name
    return save_uploaded_csv(safe_filename, raw_content)


@app.post("/api/merge/csv")
def merge_csv_uploads_route(request_body: MergeCsvRequest) -> dict[str, object]:
    if len(request_body.filenames) < 2:
        raise HTTPException(status_code=400, detail="Select at least two CSV files to merge.")

    return preview_csv_uploads(request_body.filenames)


@app.post("/api/merge/find-duplicates")
def find_duplicate_columns_route(request_body: DuplicateColumnsRequest) -> dict[str, object]:
    return find_duplicate_columns(request_body)


@app.post("/api/merge/categorize")
def categorize_rows_route(request_body: CategorizeRequest) -> dict[str, object]:
    return categorize_rows(request_body)


@app.post("/api/merge/save-changes")
def save_merge_changes_route(request_body: SaveMergeChangesRequest) -> dict[str, object]:
    saved_update_count = save_cell_updates(request_body.updates)
    return {"savedUpdateCount": saved_update_count}


@app.post("/api/merge/auto-categorize")
def auto_categorize_rows_route(request_body: AutoCategorizeRequest) -> dict[str, object]:
    return auto_categorize_rows(request_body)
