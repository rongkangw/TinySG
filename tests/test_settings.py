from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.settings import load_dotenv


class SettingsTests(unittest.TestCase):
    def test_dotenv_loads_values_and_preserves_shell_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "# local keys\nLTA_DATAMALL_ACCOUNT_KEY=\"from-file\"\n"
                "DATA_GOV_SG_API_KEY=weather-key\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"LTA_DATAMALL_ACCOUNT_KEY": "from-shell"},
                clear=True,
            ):
                load_dotenv(path)
                self.assertEqual(
                    os.environ["LTA_DATAMALL_ACCOUNT_KEY"], "from-shell"
                )
                self.assertEqual(os.environ["DATA_GOV_SG_API_KEY"], "weather-key")


if __name__ == "__main__":
    unittest.main()
