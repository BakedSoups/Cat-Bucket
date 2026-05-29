import json

from fastapi import HTTPException

from core.config import CATEGORY_SAMPLE_LIMIT, CATEGORIZATION_ROW_LIMIT, OLLAMA_MODEL
from core.csv_store import (
    get_selected_column_from_disk,
    get_upload_path,
    parse_csv,
    read_selected_column_values,
)
from core.models import AutoCategorizeRequest, CategorizeRequest
from core.text import unique_non_empty_values
from ml.ollama import generate_json


def build_categorization_rows(
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> list[dict[str, object]]:
    target_values = target_column["values"]

    if not isinstance(target_values, list):
        return []

    rows = []

    for row_index, target_value in enumerate(target_values):
        context = build_row_context(target_column, context_columns, row_index)
        target_text = str(target_value or "")

        if not target_text.strip() and not has_context_value(context):
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


def build_row_context(
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
    row_index: int,
) -> dict[str, str]:
    context = {}

    for context_column in context_columns:
        if context_column["filename"] != target_column["filename"]:
            continue

        context_values = context_column["values"]

        if not isinstance(context_values, list):
            continue

        if row_index >= len(context_values):
            continue

        context[str(context_column["column"])] = str(context_values[row_index] or "")

    return context


def has_context_value(context: dict[str, str]) -> bool:
    for value in context.values():
        if value.strip():
            return True

    return False


def build_column_reference(
    filename: str,
    columns: list[str],
    rows: list[dict[str, str]],
) -> list[dict[str, object]]:
    references = []

    for column in columns:
        samples = build_column_samples(column, rows)
        references.append(
            {
                "filename": filename,
                "column": column,
                "samples": samples,
                "nonEmptyCount": count_non_empty_values(column, rows),
                "uniqueSampleCount": count_unique_non_empty_values(column, rows),
            }
        )

    return references


def build_column_samples(column: str, rows: list[dict[str, str]]) -> list[str]:
    samples = []

    for row in rows[:8]:
        value = row.get(column, "").strip()

        if value and value not in samples:
            samples.append(value)

        if len(samples) >= 5:
            break

    return samples


def count_non_empty_values(column: str, rows: list[dict[str, str]]) -> int:
    count = 0

    for row in rows:
        if row.get(column, "").strip():
            count += 1

    return count


def count_unique_non_empty_values(column: str, rows: list[dict[str, str]]) -> int:
    values = set()

    for row in rows:
        value = row.get(column, "").strip()

        if value:
            values.add(value)

    return len(values)


def infer_categorizer_columns_with_llm(
    references: list[dict[str, object]],
) -> tuple[dict[str, object] | None, list[str], str]:
    prompt = json.dumps(
        {
            "columns": references,
            "instructions": (
                "Pick columns for categorizing bank/purchase rows. Choose one existing "
                "column that contains allowed category labels, one existing column whose "
                "rows need categories filled or interpreted, and useful context columns "
                "such as description, service, account, amount, purchase type, or date. "
                "Return only JSON with keys categoryColumn, targetColumn, contextColumns, "
                "and questions. Each column reference must include filename and column."
            ),
        },
        ensure_ascii=True,
    )
    parsed_response, status = generate_json(prompt, timeout_seconds=30)

    if parsed_response is None:
        return None, ["The local LLM was not reachable for automatic column selection."], status

    questions = normalize_questions(parsed_response.get("questions", []))
    return parsed_response, questions, status


def normalize_questions(raw_questions: object) -> list[str]:
    if not isinstance(raw_questions, list):
        return []

    questions = []

    for raw_question in raw_questions:
        question = str(raw_question).strip()

        if question:
            questions.append(question)

    return questions


def is_known_column(reference_lookup: set[tuple[str, str]], column_ref: object) -> bool:
    if not isinstance(column_ref, dict):
        return False

    filename = str(column_ref.get("filename", ""))
    column = str(column_ref.get("column", ""))
    return (filename, column) in reference_lookup


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


def call_ollama_categorizer(
    categories: list[str],
    rows: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[str], str]:
    prompt = build_categorization_prompt(categories, rows)
    parsed_response, status = generate_json(prompt, timeout_seconds=60)

    if parsed_response is None:
        return [], [], status

    raw_suggestions = parsed_response.get("suggestions")

    if not isinstance(raw_suggestions, list):
        return [], [], "offline_model_invalid_response"

    suggestions = []
    for raw_suggestion in raw_suggestions:
        if isinstance(raw_suggestion, dict):
            suggestions.append(raw_suggestion)

    questions = normalize_questions(parsed_response.get("questions", []))
    return suggestions, questions, status


def build_default_categorization_questions(
    category_column: dict[str, object],
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> list[str]:
    context_names = build_context_names(context_columns)
    category_source = f"{category_column['filename']} / {category_column['column']}"
    target_source = f"{target_column['filename']} / {target_column['column']}"
    return [
        f"Which rule should choose categories from {category_source} for rows in {target_source}?",
        f"When using {context_names}, which field should matter most for deciding the category?",
        "Are there categories that should only be applied after explicit user approval?",
    ]


def build_context_names(context_columns: list[dict[str, object]]) -> str:
    names = []

    for column in context_columns:
        names.append(str(column["column"]))

    if names:
        return ", ".join(names)

    return "no context columns"


def build_category_suggestions(
    categories: list[str],
    rows: list[dict[str, object]],
    category_column: dict[str, object],
    target_column: dict[str, object],
    context_columns: list[dict[str, object]],
) -> tuple[list[dict[str, object]], str, list[str]]:
    llm_suggestions, llm_questions, llm_status = call_ollama_categorizer(categories, rows)

    if llm_status != "ready":
        questions = build_default_categorization_questions(
            category_column,
            target_column,
            context_columns,
        )
        return [], llm_status, questions

    suggestions_by_row = index_suggestions_by_row(llm_suggestions)
    suggestions = []

    for row in rows:
        row_index = int(row["rowIndex"])
        llm_suggestion = suggestions_by_row.get(row_index)

        if not is_valid_category_suggestion(llm_suggestion, categories):
            continue

        suggestions.append(
            {
                "filename": row["filename"],
                "rowIndex": row_index,
                "targetValue": row["targetValue"],
                "context": row["context"],
                "suggestedCategory": str(llm_suggestion["suggestedCategory"]),
                "confidence": normalize_confidence(llm_suggestion.get("confidence", 0.5)),
                "reason": str(llm_suggestion.get("reason", "Local LLM suggestion.")),
                "method": "offline_llm",
            }
        )

    return suggestions, llm_status, llm_questions


def index_suggestions_by_row(
    llm_suggestions: list[dict[str, object]],
) -> dict[int, dict[str, object]]:
    suggestions_by_row = {}

    for suggestion in llm_suggestions:
        if "rowIndex" not in suggestion:
            continue

        try:
            row_index = int(suggestion["rowIndex"])
        except (TypeError, ValueError):
            continue

        suggestions_by_row[row_index] = suggestion

    return suggestions_by_row


def is_valid_category_suggestion(
    suggestion: dict[str, object] | None,
    categories: list[str],
) -> bool:
    if not suggestion:
        return False

    suggested_category = str(suggestion.get("suggestedCategory", ""))
    return suggested_category in categories


def normalize_confidence(raw_confidence: object) -> float:
    try:
        confidence = float(raw_confidence)
    except (TypeError, ValueError):
        confidence = 0.5

    if confidence < 0:
        confidence = 0

    if confidence > 1:
        confidence = 1

    return round(confidence, 2)


def categorize_rows(request_body: CategorizeRequest) -> dict[str, object]:
    category_column = read_selected_column_values(request_body.categoryColumn)
    target_column = read_selected_column_values(request_body.targetColumn)
    context_columns = []

    for context_column in request_body.contextColumns:
        context_columns.append(read_selected_column_values(context_column))

    category_values = category_column["values"]

    if not isinstance(category_values, list):
        raise HTTPException(status_code=400, detail="Category column could not be read.")

    category_strings = []
    for value in category_values:
        category_strings.append(str(value or ""))

    categories = unique_non_empty_values(category_strings)

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


def auto_categorize_rows(request_body: AutoCategorizeRequest) -> dict[str, object]:
    references = []

    for filename in request_body.filenames:
        upload_path = get_upload_path(filename)
        columns, rows = parse_csv(upload_path.read_bytes())
        column_references = build_column_reference(upload_path.name, columns, rows)
        references.extend(column_references)

    if not references:
        raise HTTPException(
            status_code=400,
            detail="No CSV columns were available for auto categorization.",
        )

    reference_lookup = build_reference_lookup(references)
    inferred, inference_questions, inference_status = infer_categorizer_columns_with_llm(references)

    if not inferred:
        return build_auto_categorize_failure(inference_questions, inference_status)

    category_ref = inferred.get("categoryColumn")
    target_ref = inferred.get("targetColumn")
    context_refs = inferred.get("contextColumns", [])

    if not is_known_column(reference_lookup, category_ref):
        return build_invalid_column_selection_response(inference_questions)

    if not is_known_column(reference_lookup, target_ref):
        return build_invalid_column_selection_response(inference_questions)

    valid_context_refs = filter_valid_context_refs(reference_lookup, context_refs)
    category_column = get_selected_column_from_disk(
        str(category_ref["filename"]),
        str(category_ref["column"]),
    )
    target_column = get_selected_column_from_disk(
        str(target_ref["filename"]),
        str(target_ref["column"]),
    )
    context_columns = []

    for context_ref in valid_context_refs:
        context_columns.append(
            get_selected_column_from_disk(
                str(context_ref["filename"]),
                str(context_ref["column"]),
            )
        )

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


def build_reference_lookup(references: list[dict[str, object]]) -> set[tuple[str, str]]:
    reference_lookup = set()

    for reference in references:
        filename = str(reference["filename"])
        column = str(reference["column"])
        reference_lookup.add((filename, column))

    return reference_lookup


def build_auto_categorize_failure(questions: list[str], status: str) -> dict[str, object]:
    return {
        "categoryColumn": None,
        "targetColumn": None,
        "contextColumns": [],
        "categories": [],
        "suggestions": [],
        "questions": questions,
        "summary": {
            "categoryCount": 0,
            "rowCount": 0,
            "suggestionCount": 0,
            "llmStatus": status,
            "ollamaModel": OLLAMA_MODEL,
            "autoSelected": False,
        },
    }


def build_invalid_column_selection_response(questions: list[str]) -> dict[str, object]:
    invalid_questions = list(questions)
    invalid_questions.append("The local LLM did not identify valid category and target columns.")
    return build_auto_categorize_failure(invalid_questions, "auto_column_selection_invalid")


def filter_valid_context_refs(
    reference_lookup: set[tuple[str, str]],
    context_refs: object,
) -> list[dict[str, object]]:
    valid_context_refs = []

    if not isinstance(context_refs, list):
        return valid_context_refs

    for context_ref in context_refs:
        if is_known_column(reference_lookup, context_ref):
            valid_context_refs.append(context_ref)

    return valid_context_refs
