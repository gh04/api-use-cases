"""JotForm API client for Python 3.

A clean, modern wrapper around the JotForm REST API using the requests library.
"""

import json
from urllib.parse import urlencode

import requests


class JotformAPIError(Exception):
    """Raised when a JotForm API request fails."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class JotformAPIClient:
    """Client for interacting with the JotForm API.

    Args:
        api_key: Your JotForm API key.
        base_url: API base URL. Override for EU accounts or self-hosted.
        output_type: Response format - 'json' or 'xml'.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.jotform.com/v1",
        output_type: str = "json",
    ):
        self.base_url = base_url.rstrip("/")
        self.output_type = output_type.lower()
        self._session = requests.Session()
        self._session.headers.update({"apiKey": api_key})

    def _request(self, method: str, path: str, params: dict | None = None) -> dict | str:
        """Make an API request and return the parsed response content."""
        url = f"{self.base_url}{path}"
        if self.output_type != "json":
            url += ".xml"

        kwargs: dict = {}
        if method == "GET" and params:
            kwargs["params"] = params
        elif method in ("POST", "DELETE") and params:
            kwargs["data"] = params
        elif method == "PUT" and params:
            kwargs["data"] = params

        try:
            response = self._session.request(method, url, **kwargs)
            response.raise_for_status()
        except requests.RequestException as e:
            status = getattr(e.response, "status_code", None) if hasattr(e, "response") else None
            raise JotformAPIError(str(e), status_code=status) from e

        if self.output_type == "json":
            return response.json().get("content")
        return response.text

    def _build_conditions(
        self,
        offset: int | None = None,
        limit: int | None = None,
        filter_array: dict | None = None,
        order_by: str | None = None,
    ) -> dict:
        params = {}
        if offset is not None:
            params["offset"] = offset
        if limit is not None:
            params["limit"] = limit
        if filter_array is not None:
            params["filter"] = json.dumps(filter_array)
        if order_by is not None:
            params["orderby"] = order_by
        return params

    # ── User endpoints ──────────────────────────────────────────────

    def get_user(self) -> dict:
        """Get user account details."""
        return self._request("GET", "/user")

    def get_usage(self) -> dict:
        """Get number of form submissions received this month."""
        return self._request("GET", "/user/usage")

    def get_forms(
        self,
        offset: int | None = None,
        limit: int | None = None,
        filter_array: dict | None = None,
        order_by: str | None = None,
    ) -> list[dict]:
        """Get a list of forms for this account."""
        params = self._build_conditions(offset, limit, filter_array, order_by)
        return self._request("GET", "/user/forms", params or None)

    def get_submissions(
        self,
        offset: int | None = None,
        limit: int | None = None,
        filter_array: dict | None = None,
        order_by: str | None = None,
    ) -> list[dict]:
        """Get a list of submissions for this account."""
        params = self._build_conditions(offset, limit, filter_array, order_by)
        return self._request("GET", "/user/submissions", params or None)

    def get_subusers(self) -> list[dict]:
        """Get a list of sub users for this account."""
        return self._request("GET", "/user/subusers")

    def get_folders(self) -> list[dict]:
        """Get a list of form folders for this account."""
        return self._request("GET", "/user/folders")

    def get_reports(self) -> list[dict]:
        """List of URLs for reports in this account."""
        return self._request("GET", "/user/reports")

    def get_settings(self) -> dict:
        """Get user's settings for this account."""
        return self._request("GET", "/user/settings")

    def update_settings(self, settings: dict) -> dict:
        """Update user's settings."""
        return self._request("POST", "/user/settings", settings)

    def get_history(
        self,
        action: str | None = None,
        date: str | None = None,
        sort_by: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict]:
        """Get user activity log."""
        params = {
            k: v
            for k, v in {
                "action": action,
                "date": date,
                "sortBy": sort_by,
                "startDate": start_date,
                "endDate": end_date,
            }.items()
            if v is not None
        }
        return self._request("GET", "/user/history", params or None)

    # ── Form endpoints ──────────────────────────────────────────────

    def get_form(self, form_id: str) -> dict:
        """Get basic information about a form."""
        return self._request("GET", f"/form/{form_id}")

    def get_form_questions(self, form_id: str) -> dict:
        """Get a list of all questions on a form."""
        return self._request("GET", f"/form/{form_id}/questions")

    def get_form_question(self, form_id: str, question_id: str) -> dict:
        """Get details about a question."""
        return self._request("GET", f"/form/{form_id}/question/{question_id}")

    def get_form_submissions(
        self,
        form_id: str,
        offset: int | None = None,
        limit: int | None = None,
        filter_array: dict | None = None,
        order_by: str | None = None,
    ) -> list[dict]:
        """List of a form's submissions."""
        params = self._build_conditions(offset, limit, filter_array, order_by)
        return self._request("GET", f"/form/{form_id}/submissions", params or None)

    def create_form_submission(self, form_id: str, submission: dict) -> dict:
        """Submit data to this form using the API."""
        sub = {}
        for key, value in submission.items():
            if "_" in key:
                qid = key[: key.find("_")]
                field = key[key.find("_") + 1 :]
                sub[f"submission[{qid}][{field}]"] = value
            else:
                sub[f"submission[{key}]"] = value
        return self._request("POST", f"/form/{form_id}/submissions", sub)

    def create_form_submissions(self, form_id: str, submissions) -> dict:
        """Submit multiple submissions to a form."""
        return self._request("PUT", f"/form/{form_id}/submissions", submissions)

    def get_form_files(self, form_id: str) -> list[dict]:
        """List of files uploaded on a form."""
        return self._request("GET", f"/form/{form_id}/files")

    def get_form_webhooks(self, form_id: str) -> dict:
        """Get list of webhooks for a form."""
        return self._request("GET", f"/form/{form_id}/webhooks")

    def create_form_webhook(self, form_id: str, webhook_url: str) -> dict:
        """Add a new webhook."""
        return self._request("POST", f"/form/{form_id}/webhooks", {"webhookURL": webhook_url})

    def delete_form_webhook(self, form_id: str, webhook_id: str) -> dict:
        """Delete a specific webhook of a form."""
        return self._request("DELETE", f"/form/{form_id}/webhooks/{webhook_id}")

    def get_form_properties(self, form_id: str) -> dict:
        """Get a list of all properties on a form."""
        return self._request("GET", f"/form/{form_id}/properties")

    def get_form_property(self, form_id: str, property_key: str) -> dict:
        """Get a specific property of the form."""
        return self._request("GET", f"/form/{form_id}/properties/{property_key}")

    def get_form_reports(self, form_id: str) -> list[dict]:
        """Get all the reports of a form."""
        return self._request("GET", f"/form/{form_id}/reports")

    def create_report(self, form_id: str, report: dict) -> dict:
        """Create new report of a form."""
        return self._request("POST", f"/form/{form_id}/reports", report)

    def set_form_properties(self, form_id: str, properties: dict) -> dict:
        """Add or edit properties of a specific form."""
        params = {f"properties[{k}]": v for k, v in properties.items()}
        return self._request("POST", f"/form/{form_id}/properties", params)

    def set_multiple_form_properties(self, form_id: str, properties) -> dict:
        """Add or edit multiple properties of a specific form (JSON body)."""
        return self._request("PUT", f"/form/{form_id}/properties", properties)

    def create_form_question(self, form_id: str, question: dict) -> dict:
        """Add new question to specified form."""
        params = {f"question[{k}]": v for k, v in question.items()}
        return self._request("POST", f"/form/{form_id}/questions", params)

    def create_form_questions(self, form_id: str, questions) -> dict:
        """Add new questions to specified form (JSON body)."""
        return self._request("PUT", f"/form/{form_id}/questions", questions)

    def edit_form_question(self, form_id: str, question_id: str, properties: dict) -> dict:
        """Add or edit a single question's properties."""
        params = {f"question[{k}]": v for k, v in properties.items()}
        return self._request("POST", f"/form/{form_id}/question/{question_id}", params)

    def delete_form_question(self, form_id: str, question_id: str) -> dict:
        """Delete a single form question."""
        return self._request("DELETE", f"/form/{form_id}/question/{question_id}")

    def clone_form(self, form_id: str) -> dict:
        """Clone a single form."""
        return self._request("POST", f"/form/{form_id}/clone", {"method": "post"})

    def create_form(self, form: dict) -> dict:
        """Create a new form."""
        params = {}
        for key, value in form.items():
            if key == "properties":
                for k, v in value.items():
                    params[f"properties[{k}]"] = v
            else:
                for k, v in value.items():
                    for a, av in v.items():
                        params[f"{key}[{k}][{a}]"] = av
        return self._request("POST", "/user/forms", params)

    def create_forms(self, form) -> dict:
        """Create new forms (JSON body)."""
        return self._request("PUT", "/user/forms", form)

    def delete_form(self, form_id: str) -> dict:
        """Delete a specific form."""
        return self._request("DELETE", f"/form/{form_id}")

    # ── Submission endpoints ────────────────────────────────────────

    def get_submission(self, submission_id: str) -> dict:
        """Get submission data."""
        return self._request("GET", f"/submission/{submission_id}")

    def edit_submission(self, submission_id: str, submission: dict) -> dict:
        """Edit a single submission."""
        sub = {}
        for key, value in submission.items():
            if "_" in key and key != "created_at":
                qid = key[: key.find("_")]
                field = key[key.find("_") + 1 :]
                sub[f"submission[{qid}][{field}]"] = value
            else:
                sub[f"submission[{key}]"] = value
        return self._request("POST", f"/submission/{submission_id}", sub)

    def delete_submission(self, submission_id: str) -> dict:
        """Delete a single submission."""
        return self._request("DELETE", f"/submission/{submission_id}")

    # ── Report endpoints ────────────────────────────────────────────

    def get_report(self, report_id: str) -> dict:
        """Get report details."""
        return self._request("GET", f"/report/{report_id}")

    def delete_report(self, report_id: str) -> dict:
        """Delete a specific report."""
        return self._request("DELETE", f"/report/{report_id}")

    # ── Folder endpoints ────────────────────────────────────────────

    def get_folder(self, folder_id: str) -> dict:
        """Get folder details."""
        return self._request("GET", f"/folder/{folder_id}")

    # ── System endpoints ────────────────────────────────────────────

    def get_plan(self, plan_name: str) -> dict:
        """Get details of a plan."""
        return self._request("GET", f"/system/plan/{plan_name}")

    # ── Auth endpoints ──────────────────────────────────────────────

    def register_user(self, user_details: dict) -> dict:
        """Register with username, password and email."""
        return self._request("POST", "/user/register", user_details)

    def login_user(self, credentials: dict) -> dict:
        """Login user with given credentials."""
        return self._request("POST", "/user/login", credentials)

    def logout_user(self) -> dict:
        """Logout user."""
        return self._request("GET", "/user/logout")
