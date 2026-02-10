"""File download manager with concurrent downloads and rich progress display."""

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from rich.progress import (
    BarColumn,
    DownloadColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TransferSpeedColumn,
)


class DownloadError(Exception):
    """Raised when a file download fails."""

    def __init__(self, filename: str, reason: str):
        super().__init__(f"Failed to download {filename}: {reason}")
        self.filename = filename
        self.reason = reason


class FileDownloader:
    """Downloads files concurrently with terminal progress display.

    Args:
        output_dir: Base directory for downloaded files.
        max_workers: Number of concurrent download threads.
        chunk_size: Bytes per read chunk during streaming downloads.
    """

    def __init__(
        self,
        api_key: str,
        output_dir: str = "./downloads",
        max_workers: int = 4,
        chunk_size: int = 8192,
    ):
        self.api_key = api_key
        self.output_dir = output_dir
        self.max_workers = max_workers
        self.chunk_size = chunk_size
        self._local = threading.local()

    def _resolve_dest_path(self, directory: str, filename: str) -> str:
        """Build a destination path, adding a numeric suffix on collision."""
        dest = os.path.join(directory, filename)
        if not os.path.exists(dest):
            return dest

        name, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(dest):
            dest = os.path.join(directory, f"{name}_{counter}{ext}")
            counter += 1
        return dest

    def _get_session(self) -> requests.Session:
        """Return a thread-local session (one per worker thread)."""
        if not hasattr(self._local, "session"):
            session = requests.Session()
            session.headers.update({"apiKey": self.api_key})
            self._local.session = session
        return self._local.session

    def _download_single(
        self,
        url: str,
        dest_path: str,
        expected_size: int | None,
        progress: Progress,
        task_id,
    ) -> str:
        """Download a single file with per-file progress tracking.

        Removes the partial file from disk if anything goes wrong.
        """
        session = self._get_session()
        try:
            response = session.get(url, stream=True, timeout=60)
            response.raise_for_status()

            # Prefer the size from the API; fall back to content-length header
            total = expected_size or int(response.headers.get("content-length", 0)) or None
            progress.update(task_id, total=total)

            written = 0
            with open(dest_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=self.chunk_size):
                    f.write(chunk)
                    written += len(chunk)
                    progress.advance(task_id, len(chunk))

            # Verify size if the API told us what to expect
            if expected_size and written != expected_size:
                raise DownloadError(
                    os.path.basename(dest_path),
                    f"size mismatch: expected {expected_size} bytes, got {written}",
                )
        except BaseException:
            # Clean up partial/corrupt file on any failure
            if os.path.exists(dest_path):
                os.remove(dest_path)
            raise

        return dest_path

    def download_files(
        self,
        files: list[dict],
        subdirectory: str | None = None,
    ) -> dict:
        """Download a list of files with progress display.

        Args:
            files: List of dicts with 'name' and 'url' keys.
            subdirectory: Optional subdirectory under output_dir.

        Returns:
            Dict with 'succeeded' and 'failed' lists.
        """
        target_dir = os.path.join(self.output_dir, subdirectory) if subdirectory else self.output_dir
        os.makedirs(target_dir, exist_ok=True)

        succeeded: list[str] = []
        failed: list[dict] = []

        file_progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
        )
        overall_progress = Progress(
            TextColumn("[bold blue]Overall"),
            BarColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
        )

        # Use a group to render both progress bars together
        from rich.live import Live
        from rich.table import Table as RichTable

        def make_layout():
            table = RichTable.grid()
            table.add_row(file_progress)
            table.add_row(overall_progress)
            return table

        overall_task = overall_progress.add_task("Overall", total=len(files))

        with Live(make_layout(), refresh_per_second=12):
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = {}

                for file_info in files:
                    filename = file_info["name"]
                    url = file_info["url"]
                    expected_size = int(file_info["size"]) if file_info.get("size") else None
                    dest = self._resolve_dest_path(target_dir, filename)

                    task_id = file_progress.add_task(
                        filename, total=expected_size,
                    )
                    future = executor.submit(
                        self._download_single, url, dest, expected_size,
                        file_progress, task_id,
                    )
                    futures[future] = (filename, task_id)

                for future in as_completed(futures):
                    filename, task_id = futures[future]
                    try:
                        future.result()
                        succeeded.append(filename)
                    except Exception as e:
                        failed.append({"name": filename, "error": str(e)})

                    file_progress.remove_task(task_id)
                    overall_progress.advance(overall_task)

        return {"succeeded": succeeded, "failed": failed}
