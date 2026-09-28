"""Packages the extension as dist/teams-context-translator-<version>.xpi for upload to addons.mozilla.org."""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
EXTENSION_FILES = [
    "manifest.json",
    "settings.js",
    "text.js",
    "selectors.js",
    "background.js",
    "content.js",
    "send-confirm.js",
    "content.css",
    "options.html",
    "options.js",
    "popup.html",
    "popup.js",
    "icons/icon.svg",
]


def main():
    version = json.loads((ROOT / "manifest.json").read_text())["version"]
    output = ROOT / "dist" / f"teams-context-translator-{version}.xpi"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as xpi:
        for name in EXTENSION_FILES:
            xpi.write(ROOT / name, name)
    print(output)


if __name__ == "__main__":
    main()
