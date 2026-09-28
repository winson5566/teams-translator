"""Serves the extension folder with caching disabled, so test/fake-teams.html always loads the current scripts."""
import http.server
import pathlib

PORT = 8766


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent.parent
    handler = lambda *args: NoCacheHandler(*args, directory=str(root))
    print(f"http://127.0.0.1:{PORT}/test/fake-teams.html")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
