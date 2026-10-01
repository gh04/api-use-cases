#!/usr/bin/env python3
"""JotForm Appointment Blockout Dates Manager — CLI.

Finds appointment widget questions on a form and lets you view,
add, or clear blockout date ranges.

Usage:
    python main.py --api-key YOUR_KEY --form-id 123456789
    JOTFORM_API_KEY=YOUR_KEY python main.py --form-id 123456789
    python main.py                          # will prompt for both
"""

import argparse
import json
import os
import sys
from datetime import datetime

from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from jotform_client import JotformAPIClient, JotformAPIError

console = Console()


# ── CLI arguments ───────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Manage blockout dates on JotForm appointment widgets.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("JOTFORM_API_KEY"),
        help="JotForm API key (or set JOTFORM_API_KEY env var).",
    )
    parser.add_argument(
        "--form-id",
        default=None,
        help="Form ID to manage blockout dates for.",
    )
    parser.add_argument(
        "--base-url",
        default="https://api.jotform.com/v1",
        help="API base URL. Use https://eu-api.jotform.com/v1 for EU accounts.",
    )
    return parser.parse_args()


# ── Helpers ─────────────────────────────────────────────────────────

def get_api_key(args: argparse.Namespace) -> str:
    if args.api_key:
        return args.api_key.strip()
    return Prompt.ask("[bold]Enter your JotForm API key").strip()


def get_form_id(args: argparse.Namespace) -> str:
    if args.form_id:
        return args.form_id.strip()
    return Prompt.ask("[bold]Enter the Form ID").strip()


def find_appointment_questions(questions: dict) -> list[dict]:
    """Return all appointment widget questions from a form's question dict."""
    appointments = []
    for qid, question in questions.items():
        if not isinstance(question, dict):
            continue
        if question.get("type") == "control_appointment":
            appointments.append({"qid": qid, **question})
    return appointments


def display_appointment_questions(appointments: list[dict]) -> None:
    table = Table(title="Appointment Widgets", show_lines=False)
    table.add_column("#", style="bold cyan", justify="right")
    table.add_column("QID", style="dim")
    table.add_column("Name / Text")
    table.add_column("Blockout Dates", justify="right")

    for i, q in enumerate(appointments, 1):
        blockout_raw = q.get("blockoutDates", "[]")
        try:
            dates = json.loads(blockout_raw) if blockout_raw else []
        except (json.JSONDecodeError, TypeError):
            dates = []
        table.add_row(
            str(i),
            q["qid"],
            q.get("text", q.get("name", "Unnamed")),
            str(len(dates)),
        )
    console.print(table)


def select_appointment(appointments: list[dict]) -> dict:
    if len(appointments) == 1:
        q = appointments[0]
        console.print(
            f"Found 1 appointment widget: "
            f"[bold]{q.get('text', q.get('name', 'Unnamed'))}[/bold] "
            f"(QID: {q['qid']})"
        )
        return q

    display_appointment_questions(appointments)
    while True:
        raw = Prompt.ask("Select an appointment widget by number")
        if raw.strip().isdigit():
            idx = int(raw.strip()) - 1
            if 0 <= idx < len(appointments):
                return appointments[idx]
        console.print("[yellow]Invalid selection. Try again.[/yellow]")


def parse_existing_blockouts(question: dict) -> list[dict]:
    raw = question.get("blockoutDates", "[]")
    try:
        dates = json.loads(raw) if raw else []
    except (json.JSONDecodeError, TypeError):
        dates = []
    return dates if isinstance(dates, list) else []


def display_blockout_dates(dates: list[dict]) -> None:
    if not dates:
        console.print("[yellow]No blockout dates currently set.[/yellow]")
        return

    table = Table(title="Current Blockout Dates", show_lines=False)
    table.add_column("#", style="bold cyan", justify="right")
    table.add_column("Start Date")
    table.add_column("End Date")

    for i, d in enumerate(dates, 1):
        table.add_row(str(i), d.get("startDate", "?"), d.get("endDate", "?"))
    console.print(table)


def validate_date(date_str: str) -> bool:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def prompt_for_dates() -> list[dict]:
    """Prompt the user to enter one or more blockout date ranges."""
    new_dates: list[dict] = []
    console.print(
        "\nEnter blockout date ranges (format: [bold]YYYY-MM-DD[/bold])."
        "\nLeave start date empty when done adding."
    )

    while True:
        start = Prompt.ask("\n  Start date (or press Enter to finish)", default="")
        if not start:
            break
        if not validate_date(start):
            console.print("[red]Invalid date format. Use YYYY-MM-DD.[/red]")
            continue

        end = Prompt.ask("  End date (same as start if single day)", default=start)
        if not validate_date(end):
            console.print("[red]Invalid date format. Use YYYY-MM-DD.[/red]")
            continue

        if end < start:
            console.print("[red]End date cannot be before start date.[/red]")
            continue

        new_dates.append({"startDate": start, "endDate": end})
        console.print(f"  [green]Added: {start} → {end}[/green]")

    return new_dates


def remove_blockout_dates(existing: list[dict]) -> list[dict]:
    """Let the user select which blockout dates to remove."""
    if not existing:
        console.print("[yellow]No blockout dates to remove.[/yellow]")
        return existing

    display_blockout_dates(existing)
    console.print(
        "\nEnter numbers to remove "
        "(comma-separated, e.g. [bold]1,3[/bold]) or [bold]all[/bold]:"
    )
    raw = Prompt.ask("Selection")

    if raw.strip().lower() == "all":
        return []

    to_remove: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            idx = int(part) - 1
            if 0 <= idx < len(existing):
                to_remove.add(idx)
            else:
                console.print(f"[yellow]Skipping out-of-range: {part}[/yellow]")
        else:
            console.print(f"[yellow]Skipping invalid input: {part}[/yellow]")

    return [d for i, d in enumerate(existing) if i not in to_remove]


# ── Main flow ───────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    console.print("[bold]JotForm Appointment Blockout Dates Manager[/bold]\n")

    api_key = get_api_key(args)
    if not api_key:
        console.print("[red]No API key provided. Exiting.[/red]")
        sys.exit(1)

    form_id = get_form_id(args)
    if not form_id:
        console.print("[red]No Form ID provided. Exiting.[/red]")
        sys.exit(1)

    client = JotformAPIClient(api_key, base_url=args.base_url)

    # 1. Fetch questions and find appointment widgets
    try:
        with console.status("Fetching form questions..."):
            questions = client.get_form_questions(form_id)
    except JotformAPIError as e:
        console.print(f"[red]API error: {e}[/red]")
        sys.exit(1)

    appointments = find_appointment_questions(questions)

    if not appointments:
        console.print("[red]No appointment widget found on this form.[/red]")
        sys.exit(1)

    # 2. Select the appointment widget
    selected = select_appointment(appointments)
    qid = selected["qid"]

    # 3. Show existing blockout dates
    existing = parse_existing_blockouts(selected)
    console.print()
    display_blockout_dates(existing)

    # 4. Choose action
    console.print("\nWhat would you like to do?")
    console.print("  [bold]1[/bold] — Add blockout dates")
    console.print("  [bold]2[/bold] — Remove blockout dates")
    console.print("  [bold]3[/bold] — Clear all blockout dates")
    console.print("  [bold]4[/bold] — Exit")

    choice = Prompt.ask("Choice", choices=["1", "2", "3", "4"], default="1")

    if choice == "4":
        console.print("[yellow]Exiting.[/yellow]")
        sys.exit(0)

    if choice == "1":
        new_dates = prompt_for_dates()
        if not new_dates:
            console.print("[yellow]No dates entered. Exiting.[/yellow]")
            sys.exit(0)
        updated = existing + new_dates

    elif choice == "2":
        updated = remove_blockout_dates(existing)
        if updated == existing:
            console.print("[yellow]No changes made. Exiting.[/yellow]")
            sys.exit(0)

    elif choice == "3":
        if not existing:
            console.print("[yellow]Already empty. Exiting.[/yellow]")
            sys.exit(0)
        if not Confirm.ask("Clear all blockout dates?", default=False):
            console.print("[yellow]Cancelled.[/yellow]")
            sys.exit(0)
        updated = []

    # 5. Preview and confirm
    console.print(f"\n[bold]Updated blockout dates ({len(updated)} total):[/bold]")
    if updated:
        for d in updated:
            console.print(f"  {d['startDate']} → {d['endDate']}")
    else:
        console.print("  [dim](none)[/dim]")

    if not Confirm.ask("\nPush these blockout dates to JotForm?", default=True):
        console.print("[yellow]Cancelled.[/yellow]")
        sys.exit(0)

    # 6. Update
    blockout_json = json.dumps(updated)
    try:
        with console.status("Updating blockout dates..."):
            client.edit_form_question(form_id, qid, {"blockoutDates": blockout_json})
    except JotformAPIError as e:
        console.print(f"[red]Failed to update: {e}[/red]")
        sys.exit(1)

    console.print("[bold green]Blockout dates updated successfully![/bold green]")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n[yellow]Cancelled.[/yellow]")
        sys.exit(130)
