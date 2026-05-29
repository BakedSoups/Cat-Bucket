from pydantic import BaseModel


class MergeCsvRequest(BaseModel):
    filenames: list[str]


class SelectedColumn(BaseModel):
    filename: str
    column: str
    values: list[str]


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
