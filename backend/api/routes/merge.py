from fastapi import APIRouter, HTTPException

from core.csv_store import preview_csv_uploads, save_cell_updates
from core.models import (
    AutoCategorizeRequest,
    CategorizeRequest,
    DuplicateColumnsRequest,
    MergeCsvRequest,
    SaveMergeChangesRequest,
)
from core.unification import find_duplicate_columns
from ml.categorization import auto_categorize_rows, categorize_rows


router = APIRouter(prefix="/api/merge", tags=["merge"])


@router.post("/csv")
def merge_csv_uploads_route(request_body: MergeCsvRequest) -> dict[str, object]:
    if len(request_body.filenames) < 2:
        raise HTTPException(status_code=400, detail="Select at least two CSV files to merge.")

    return preview_csv_uploads(request_body.filenames)


@router.post("/find-duplicates")
def find_duplicate_columns_route(request_body: DuplicateColumnsRequest) -> dict[str, object]:
    return find_duplicate_columns(request_body)


@router.post("/categorize")
def categorize_rows_route(request_body: CategorizeRequest) -> dict[str, object]:
    return categorize_rows(request_body)


@router.post("/save-changes")
def save_merge_changes_route(request_body: SaveMergeChangesRequest) -> dict[str, object]:
    saved_update_count = save_cell_updates(request_body.updates)
    return {"savedUpdateCount": saved_update_count}


@router.post("/auto-categorize")
def auto_categorize_rows_route(request_body: AutoCategorizeRequest) -> dict[str, object]:
    return auto_categorize_rows(request_body)
