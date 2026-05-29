import csv
import re
from io import StringIO
from pathlib import Path
from urllib.parse import unquote

from fastapi import HTTPException

from core.config import UPLOAD_DIR
from core.models import CsvCellUpdate, SelectedColumn
from core.text import normalize_text


def parse_csv(raw_content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    try:
        text = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded.") from exc

    reader = csv.DictReader(StringIO(text))
    columns = list(reader.fieldnames or [])

    if not columns:
        raise HTTPException(status_code=400, detail="CSV must include a header row.")

    rows = []
    for row in reader:
        rows.append(row)

    return columns, rows


def get_upload_path(filename: str) -> Path:
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
    if not original_value:
        return replacement_value

    if cell_value.strip() == original_value:
        return replacement_value

    parts = re.split(r"([,;|\n]+)", cell_value)
    changed = False

    for index, part in enumerate(parts):
        if normalize_text(part) == normalize_text(original_value):
            parts[index] = replacement_value
            changed = True

    if changed:
        return "".join(parts)

    return replacement_value


def read_selected_column_values(selected: SelectedColumn) -> dict[str, object]:
    upload_path = get_upload_path(selected.filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    if selected.column not in columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{selected.column}' was not found in {upload_path.name}.",
        )

    values = []
    for row in rows:
        values.append(row.get(selected.column, ""))

    return {
        "filename": upload_path.name,
        "column": selected.column,
        "values": values,
    }


def get_selected_column_from_disk(filename: str, column: str) -> SelectedColumn:
    upload_path = get_upload_path(filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    if column not in columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{column}' was not found in {upload_path.name}.",
        )

    values = []
    for row in rows:
        values.append(row.get(column, ""))

    return SelectedColumn(
        filename=upload_path.name,
        column=column,
        values=values,
    )


def list_csv_uploads() -> dict[str, list[dict[str, object]]]:
    uploads = []
    upload_paths = sorted(UPLOAD_DIR.glob("*.csv"), key=get_modified_time, reverse=True)

    for upload_path in upload_paths:
        columns, rows = parse_csv(upload_path.read_bytes())
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


def get_modified_time(path: Path) -> float:
    return path.stat().st_mtime


def get_csv_upload(filename: str) -> dict[str, object]:
    upload_path = get_upload_path(filename)
    columns, rows = parse_csv(upload_path.read_bytes())

    return {
        "filename": upload_path.name,
        "rows": rows,
        "row_count": len(rows),
        "columns": columns,
    }


def preview_csv_uploads(filenames: list[str]) -> dict[str, object]:
    files = []

    for filename in filenames:
        files.append(get_csv_upload(filename))

    return {
        "selected_filenames": filenames,
        "files": files,
    }


def save_uploaded_csv(filename: str, raw_content: bytes) -> dict[str, object]:
    columns, rows = parse_csv(raw_content)
    destination = UPLOAD_DIR / Path(filename).name
    destination.write_bytes(raw_content)

    return {
        "filename": destination.name,
        "rows": len(rows),
        "columns": columns,
    }


def save_cell_updates(updates: list[CsvCellUpdate]) -> int:
    updates_by_file: dict[str, list[CsvCellUpdate]] = {}

    for update in updates:
        safe_filename = Path(unquote(update.filename)).name

        if safe_filename not in updates_by_file:
            updates_by_file[safe_filename] = []

        updates_by_file[safe_filename].append(update)

    saved_updates = 0

    for filename, file_updates in updates_by_file.items():
        upload_path = get_upload_path(filename)
        columns, rows = parse_csv(upload_path.read_bytes())

        for update in file_updates:
            if not is_valid_cell_update(update, columns, rows):
                continue

            current_value = rows[update.rowIndex].get(update.column, "")
            original_value = update.originalValue or current_value
            rows[update.rowIndex][update.column] = replace_token_value(
                current_value,
                original_value,
                update.value,
            )
            saved_updates += 1

        write_csv(upload_path, columns, rows)

    return saved_updates


def is_valid_cell_update(
    update: CsvCellUpdate,
    columns: list[str],
    rows: list[dict[str, str]],
) -> bool:
    if update.column not in columns:
        return False

    if update.rowIndex < 0:
        return False

    if update.rowIndex >= len(rows):
        return False

    return True
