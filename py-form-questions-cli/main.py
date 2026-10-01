#!/usr/bin/env python3
"""JotForm Form Questions Exporter — CLI.

Fetches the questions/fields for selected forms and saves the raw JSON
to a file per form.

Usage:
    python main.py --api-key YOUR_KEY
    JOTFORM_API_KEY=YOUR_KEY python main.py
    python main.py                          # will prompt for the key
"""

import argparse
import json
import os
import sys

from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from jotform_client import JotformAPIClient, JotformAPIError

console = Console()


# ── CLI arguments ───────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export form questions/fields to JSON files.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("JOTFORM_API_KEY"),
        help="JotForm API key (or set JOTFORM_API_KEY env var).",
    )
    parser.add_argument(
        "--output-dir",
        default="./questions",
        help="Directory for exported JSON files (default: ./questions).",
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


def display_forms(forms: list[dict]) -> None:
    table = Table(title="Your Forms", show_lines=False)
    table.add_column("#", style="bold cyan", justify="right")
    table.add_column("Form ID", style="dim")
    table.add_column("Title")
    table.add_column("Submissions", justify="right")
    table.add_column("Status")

    for i, form in enumerate(forms, 1):
        table.add_row(
            str(i),
            form.get("id", ""),
            form.get("title", "Untitled"),
            str(form.get("count", "0")),
            form.get("status", ""),
        )
    console.print(table)


def select_forms(forms: list[dict]) -> list[dict]:
    console.print(
        "\nEnter form numbers to export "
        "(comma-separated, e.g. [bold]1,3,5[/bold]) or [bold]all[/bold]:"
    )
    raw = Prompt.ask("Selection")

    if raw.strip().lower() == "all":
        return list(forms)

    selected: list[dict] = []
    for part in raw.split(","):
        part = part.strip()
        if not part.isdigit():
            console.print(f"[yellow]Skipping invalid input: {part}[/yellow]")
            continue
        idx = int(part) - 1
        if 0 <= idx < len(forms):
            selected.append(forms[idx])
        else:
            console.print(f"[yellow]Skipping out-of-range: {part}[/yellow]")

    return selected


# ── Main flow ───────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    console.print("[bold]JotForm Form Questions Exporter[/bold]\n")

    api_key = get_api_key(args)
    if not api_key:
        console.print("[red]No API key provided. Exiting.[/red]")
        sys.exit(1)

    client = JotformAPIClient(api_key, base_url=args.base_url)

    try:
        with console.status("Verifying API key and fetching forms..."):
            forms = client.get_all_forms()
    except JotformAPIError as e:
        console.print(f"[red]API error: {e}[/red]")
        sys.exit(1)

    if not forms:
        console.print("[yellow]No forms found for this account.[/yellow]")
        sys.exit(0)

    display_forms(forms)
    selected = select_forms(forms)

    if not selected:
        console.print("[yellow]No valid forms selected. Exiting.[/yellow]")
        sys.exit(0)

    os.makedirs(args.output_dir, exist_ok=True)

    for form in selected:
        form_id = form["id"]
        form_title = form.get("title", "Untitled")

        console.print(f"\n[bold]--- {form_title} (ID: {form_id}) ---[/bold]")

        try:
            with console.status("Fetching questions..."):
                questions = client.get_form_questions(form_id)
        except JotformAPIError as e:
            console.print(f"[red]Could not fetch questions: {e}[/red]")
            continue

        if not questions:
            console.print("[yellow]No questions found for this form.[/yellow]")
            continue

        out_path = os.path.join(args.output_dir, f"{form_id}_questions.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(questions, f, indent=2, ensure_ascii=False)

        question_count = len(questions) if isinstance(questions, list) else len(questions.keys())
        console.print(
            f"[green]{question_count} question(s) saved to {out_path}[/green]"
        )

    console.print("\n[bold green]All done![/bold green]")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n[yellow]Cancelled.[/yellow]")
        sys.exit(130)
