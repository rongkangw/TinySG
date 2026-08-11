"""Small standard-library JSON HTTP client with provider-aware API keys."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections.abc import Mapping
from typing import Any


def fetch_json(
    url: str,
    api_key: str | None,
    timeout: float = 12.0,
    account_key: bool = False,
    params: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    if params:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urllib.parse.urlencode(params)}"
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mini-Singapore/1.0",
    }
    if api_key:
        headers["AccountKey" if account_key else "x-api-key"] = api_key
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))
