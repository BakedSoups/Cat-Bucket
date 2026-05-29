import re


def normalize_text(value: str) -> str:
    trimmed_value = value.strip().lower()
    return re.sub(r"\s+", " ", trimmed_value)


def split_tag_values(value: str) -> list[str]:
    tags = []

    for part in re.split(r"[,;|\n]+", value):
        cleaned_part = part.strip()

        if cleaned_part:
            tags.append(cleaned_part)

    return tags


def unique_non_empty_values(values: list[str]) -> list[str]:
    seen_values = set()
    unique_values = []

    for value in values:
        cleaned_value = value.strip()
        normalized_value = normalize_text(cleaned_value)

        if not cleaned_value:
            continue

        if normalized_value in seen_values:
            continue

        seen_values.add(normalized_value)
        unique_values.append(cleaned_value)

    return unique_values
