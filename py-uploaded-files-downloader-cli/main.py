#!/usr/bin/env python3
"""JotForm Uploaded Files Downloader — CLI.

Usage:
    python main.py --api-key YOUR_KEY
    JOTFORM_API_KEY=YOUR_KEY python main.py
    python main.py                          # will prompt for the key
"""

import argparse
import os
import sys

from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table

from downloader import FileDownloader
from jotform_client import JotformAPIClient, JotformAPIError

console = Console()


# ── CLI arguments ───────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download uploaded files from your JotForm forms.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("JOTFORM_API_KEY"),
        help="JotForm API key (or set JOTFORM_API_KEY env var).",
    )
    parser.add_argument(
        "--output-dir",
        default="./downloads",
        help="Base directory for downloaded files (default: ./downloads).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of concurrent download threads (default: 4).",
    )
    parser.add_argument(
        "--base-url",
        default="https://api.jotform.com/v1",
        help="API base URL. Use https://eu-api.jotform.com/v1 for EU accounts.",
    )
    return parser.parse_args()


# ── Helpers ─────────────────────────────────────────────────────────

def get_api_key(args: argparse.Namespace) -> str:
    """Return API key from args/env or prompt the user."""
    if args.api_key:
        return args.api_key.strip()
    return Prompt.ask("[bold]Enter your JotForm API key").strip()


def display_forms(forms: list[dict]) -> None:
    """Print a numbered table of forms."""
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
    """Let the user pick one or more forms by number."""
    console.print(
        "\nEnter form numbers to download from "
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


def _human_size(num_bytes: int) -> str:
    """Format byte count as a human-readable string."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num_bytes) < 1024:
            return f"{num_bytes:,.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:,.1f} PB"


# ── Main flow ───────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    console.print("[bold]JotForm File Downloader[/bold]\n")

    # 1. Authenticate
    api_key = get_api_key(args)
    if not api_key:
        console.print("[red]No API key provided. Exiting.[/red]")
        sys.exit(1)

    client = JotformAPIClient(api_key, base_url=args.base_url)

    try:
        with console.status("Verifying API key and fetching forms..."):
            forms = client.get_forms()
    except JotformAPIError as e:
        console.print(f"[red]API error: {e}[/red]")
        sys.exit(1)

    if not forms:
        console.print("[yellow]No forms found for this account.[/yellow]")
        sys.exit(0)

    # 2. Select forms
    display_forms(forms)
    selected = select_forms(forms)

    if not selected:
        console.print("[yellow]No valid forms selected. Exiting.[/yellow]")
        sys.exit(0)

    # 3. Download files from each selected form
    downloader = FileDownloader(
        output_dir=args.output_dir,
        max_workers=args.workers,
    )

    for form in selected:
        form_id = form["id"]
        form_title = form.get("title", "Untitled")

        console.print(f"\n[bold]--- {form_title} (ID: {form_id}) ---[/bold]")

        try:
            with console.status("Fetching file list..."):
                files = client.get_form_files(form_id)
        except JotformAPIError as e:
            console.print(f"[red]Could not fetch files: {e}[/red]")
            continue

        if not files:
            console.print("[yellow]No uploaded files found for this form.[/yellow]")
            continue

        total_size = sum(int(f.get("size", 0)) for f in files)
        console.print(
            f"Found [bold]{len(files)}[/bold] file(s)"
            f"  ({_human_size(total_size)})"
        )

        if not Confirm.ask("Download?", default=True):
            continue

        result = downloader.download_files(files, subdirectory=str(form_id))

        if result["failed"]:
            console.print(f"[red]{len(result['failed'])} file(s) failed:[/red]")
            for f in result["failed"]:
                console.print(f"  [red]- {f['name']}: {f['error']}[/red]")

        console.print(
            f"[green]{len(result['succeeded'])} file(s) downloaded to "
            f"{os.path.join(args.output_dir, form_id)}[/green]"
        )

    console.print("\n[bold green]All done![/bold green]")


if __name__ == "__main__":
    main()
