"""Tiny no-cache static server for local browser testing of the web game."""
import functools
import http.server
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    handler = functools.partial(NoCacheHandler, directory='.')
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), handler) as httpd:
        httpd.allow_reuse_address = True
        print(f'serving . on http://127.0.0.1:{port} (no-store)')
        httpd.serve_forever()
