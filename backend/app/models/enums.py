"""Shared enums used by API schemas and database checks."""

from enum import StrEnum


class Relationship(StrEnum):
    FRIEND = "friend"
    GROUP = "group"
    COWORKER = "coworker"
    FAMILY = "family"
    DATE = "date"
    NEIGHBOR = "neighbor"
    OTHER = "other"


class Tone(StrEnum):
    HONEST = "honest"
    COZY = "cozy"
    THEATRICAL = "theatrical"


RELATIONSHIP_VALUES = tuple(item.value for item in Relationship)
TONE_VALUES = tuple(item.value for item in Tone)
