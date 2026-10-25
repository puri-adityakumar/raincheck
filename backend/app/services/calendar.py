"""RFC 5545 download only. Never an invitation or a calendar write."""

from datetime import timedelta

from app.core.time import local_instant, utc_now
from app.models.ticket import Ticket
from app.schemas.common import clean_text


def escape_text(value: str) -> str:
    # Removing CR and escaping LF prevents untrusted text from adding properties.
    value = clean_text(value.replace("\r", ""))
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold_line(value: str) -> str:
    lines: list[str] = []
    current = ""
    size = 0
    for char in value:
        width = len(char.encode("utf-8"))
        if size + width > 75:
            lines.append(current)
            current = " "
            size = 1
        current += char
        size += width
    lines.append(current)
    return "\r\n".join(lines)


def calendar_bytes(ticket: Ticket) -> bytes:
    start = local_instant(ticket.proposed_date, ticket.proposed_start_time, ticket.timezone)
    end = (
        local_instant(ticket.proposed_date, ticket.proposed_end_time, ticket.timezone)
        if ticket.proposed_end_time
        else start + timedelta(hours=1)
    )
    description = [
        ticket.message,
        "",
        "A Raincheck suggestion — not confirmed. "
        "The recipient has not accepted via this calendar file.",
        f"Suggested time: {ticket.proposed_date.isoformat()} {ticket.proposed_start_time}"
        + (f"–{ticket.proposed_end_time}" if ticket.proposed_end_time else "")
        + f" ({ticket.timezone}).",
    ]
    if ticket.location_label:
        description.append(f"Suggested place: {ticket.location_label}.")
    if ticket.weather_json:
        description.append(f"{ticket.weather_json['summary']} Weather data by Open-Meteo.com")
    if ticket.tone == "theatrical":
        description.append("Clearly theatrical — a joke, not a real excuse.")
    description.append("Open the ticket to accept.")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Raincheck//Raincheck//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:raincheck-{ticket.id}@raincheck",
        f"DTSTAMP:{utc_now():%Y%m%dT%H%M%SZ}",
        f"DTSTART:{start:%Y%m%dT%H%M%SZ}",
        f"DTEND:{end:%Y%m%dT%H%M%SZ}",
        f"SUMMARY:{escape_text('Raincheck: ' + (ticket.plan_title or 'A raincheck'))}",
        f"DESCRIPTION:{escape_text(chr(10).join(description))}",
        "STATUS:TENTATIVE",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return ("\r\n".join(fold_line(line) for line in lines) + "\r\n").encode("utf-8")
