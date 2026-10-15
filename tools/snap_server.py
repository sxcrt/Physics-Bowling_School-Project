"""Receives POSTed data-URL JPEGs from the browser audit and writes them to disk.

Used with ``tools/snapshot.js``, which composites the WebGL canvas and the DOM
UI in the page and POSTs the image here (the automated browser used for the
audit cannot always produce a native screenshot):

    python tools/snap_server.py 8899 ./snaps
    # in the page: await window.hellsSnap('menu')
"""
import base64
import http.server
import os
import socketserver
import sys

OUT = sys.argv[2] if len(sys.argv) > 2 else '.'


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            name = self.path.strip('/').replace('/', '_') or 'snap'
            data = body.split(',', 1)[1] if ',' in body else body
            path = os.path.join(OUT, name + '.jpg')
            with open(path, 'wb') as fh:
                fh.write(base64.b64decode(data + '=' * (-len(data) % 4)))
            reply = b'ok'
        except Exception as exc:  # noqa: BLE001 - diagnostics server
            reply = f'error: {exc}'.encode()
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
        httpd.allow_reuse_address = True
        print(f'writing snapshots to {OUT} on port {port}')
        httpd.serve_forever()
