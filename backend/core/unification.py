from difflib import SequenceMatcher

from fastapi import HTTPException

from core.config import FUZZY_TAG_LIMIT, FUZZY_TAG_THRESHOLD, OFFLINE_LLM_STATUS
from core.csv_store import read_selected_column_values
from core.models import DuplicateColumnsRequest
from core.text import split_tag_values, normalize_text


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

            tags = split_tag_values(str(raw_value))
            for tag in tags:
                normalized = normalize_text(tag)

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
        normalized = str(occurrence["normalized"])

        if normalized not in grouped:
            grouped[normalized] = []

        grouped[normalized].append(occurrence)

    duplicate_groups = []

    for normalized, group_occurrences in grouped.items():
        source_keys = set()
        display_values = set()
        public_occurrences = []

        for occurrence in group_occurrences:
            source_keys.add(get_source_key(occurrence))
            display_values.add(str(occurrence["value"]))
            public_occurrences.append(
                {
                    "filename": occurrence["filename"],
                    "column": occurrence["column"],
                    "rowIndex": occurrence["rowIndex"],
                    "value": occurrence["value"],
                }
            )

        if len(group_occurrences) < 2:
            continue

        if require_cross_source and len(source_keys) < 2:
            continue

        sorted_display_values = sorted(display_values)
        duplicate_groups.append(
            {
                "canonicalTag": sorted_display_values[0],
                "normalizedTag": normalized,
                "values": sorted_display_values,
                "duplicateCount": len(group_occurrences),
                "occurrences": public_occurrences,
            }
        )

    duplicate_groups.sort(key=duplicate_group_sort_key)
    return duplicate_groups


def duplicate_group_sort_key(group: dict[str, object]) -> tuple[int, str]:
    duplicate_count = int(group["duplicateCount"])
    canonical_tag = str(group["canonicalTag"]).lower()
    return -duplicate_count, canonical_tag


def build_fuzzy_tag_groups(
    occurrences: list[dict[str, object]],
    exact_duplicate_groups: list[dict[str, object]],
    require_cross_source: bool,
) -> list[dict[str, object]]:
    exact_normalized_tags = set()

    for group in exact_duplicate_groups:
        exact_normalized_tags.add(str(group["normalizedTag"]))

    occurrences_by_tag: dict[str, list[dict[str, object]]] = {}
    display_by_tag: dict[str, str] = {}
    source_keys_by_tag: dict[str, set[str]] = {}

    for occurrence in occurrences:
        normalized = str(occurrence["normalized"])

        if normalized in exact_normalized_tags:
            continue

        if normalized not in occurrences_by_tag:
            occurrences_by_tag[normalized] = []

        if normalized not in display_by_tag:
            display_by_tag[normalized] = str(occurrence["value"])

        if normalized not in source_keys_by_tag:
            source_keys_by_tag[normalized] = set()

        occurrences_by_tag[normalized].append(occurrence)
        source_keys_by_tag[normalized].add(get_source_key(occurrence))

    tags = sorted(occurrences_by_tag)
    fuzzy_pairs = []

    for index, left_tag in enumerate(tags):
        remaining_tags = tags[index + 1 :]

        for right_tag in remaining_tags:
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

        used_tags.add(left_tag)
        used_tags.add(right_tag)
        group_tags = [left_tag, right_tag]
        group_occurrences = []

        for tag in group_tags:
            for occurrence in occurrences_by_tag[tag]:
                group_occurrences.append(occurrence)

        fuzzy_groups.append(
            {
                "suggestedTag": display_by_tag[left_tag],
                "values": build_display_values(group_tags, display_by_tag),
                "score": round(score, 3),
                "occurrenceCount": len(group_occurrences),
                "occurrences": build_public_occurrences(group_occurrences),
            }
        )

    return fuzzy_groups


def build_display_values(tags: list[str], display_by_tag: dict[str, str]) -> list[str]:
    values = []

    for tag in tags:
        values.append(display_by_tag[tag])

    return values


def build_public_occurrences(
    occurrences: list[dict[str, object]],
) -> list[dict[str, object]]:
    public_occurrences = []

    for occurrence in occurrences:
        public_occurrences.append(
            {
                "filename": occurrence["filename"],
                "column": occurrence["column"],
                "rowIndex": occurrence["rowIndex"],
                "value": occurrence["value"],
            }
        )

    return public_occurrences


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

    candidates.sort(key=unification_candidate_sort_key)
    return candidates


def unification_candidate_sort_key(candidate: dict[str, object]) -> tuple[int, float, str]:
    total_match_count = int(candidate["totalMatchCount"])
    score = float(candidate["score"])
    canonical_tag = str(candidate["canonicalTag"]).lower()
    return -total_match_count, -score, canonical_tag


def find_duplicate_columns(request_body: DuplicateColumnsRequest) -> dict[str, object]:
    if not request_body.columns:
        raise HTTPException(status_code=400, detail="Select at least one column.")

    selected_column_values = []

    for selected in request_body.columns:
        column_data = read_selected_column_values(selected)
        selected_column_values.append(column_data)

    require_cross_source = len(request_body.columns) > 1
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

    normalized_tags = set()
    for occurrence in tag_occurrences:
        normalized_tags.add(str(occurrence["normalized"]))

    return {
        "sources": build_sources(request_body),
        "selectedColumnValues": selected_column_values,
        "matches": [],
        "duplicateTagGroups": duplicate_tag_groups,
        "fuzzyTagGroups": fuzzy_preview_groups,
        "unificationCandidates": unification_candidates,
        "summary": {
            "tagCount": len(tag_occurrences),
            "uniqueTagCount": len(normalized_tags),
            "duplicateGroupCount": len(duplicate_tag_groups),
            "fuzzyGroupCount": len(fuzzy_tag_groups),
            "fuzzyPreviewLimit": FUZZY_TAG_LIMIT,
            "llmCandidateCount": llm_candidate_count,
            "llmMatchCount": 0,
            "llmStatus": OFFLINE_LLM_STATUS,
        },
    }


def build_sources(request_body: DuplicateColumnsRequest) -> list[dict[str, object]]:
    sources = []

    for selected in request_body.columns:
        sources.append(selected.model_dump())

    return sources
