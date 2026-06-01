from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from core.csv_store import get_csv_upload, list_csv_uploads, save_uploaded_csv


router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.get("/csv")
def list_uploads_route() -> dict[str, list[dict[str, object]]]:
    return list_csv_uploads()


@router.get("/csv/{filename}")
def get_upload_route(filename: str) -> dict[str, object]:
    return get_csv_upload(filename)


@router.post("/csv")
async def upload_csv_route(file: UploadFile = File(...)) -> dict[str, object]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file.")

    raw_content = await file.read()
    safe_filename = Path(file.filename).name
    return save_uploaded_csv(safe_filename, raw_content)
