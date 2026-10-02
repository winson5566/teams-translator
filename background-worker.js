// Entry point for Chrome and Edge, which run the background as a service worker; Firefox loads the
// same files through background.scripts in manifest.json.
importScripts("settings.js", "text.js", "background.js");
