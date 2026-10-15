"""Serves the repository exactly the way Vercel's static hosting does.

Used to verify the production artifact before/without a live deployment:

    python tools/vercel_sim.py 8130

Differences from ``tools/serve.py`` (the convenience dev server):

* ``cleanUrls`` semantics: ``/index.html`` and ``/foo.html`` are 308-redirected
  to their extensionless path, and a request for a directory serves its
  ``index.html``.
* ``trailingSlash: false``: a path ending in ``/`` is redirected to the path
  without it.
* Only the files Vercel would upload are served - anything matched by
  ``.vercelignore`` returns 404, so a reference to an asset that is not deployed
  fails here instead of silently working off a local file.
* Responses carry the same Cache-Control values as ``vercel.json``.
"""
import fnmatch
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_ignore():
    patterns = []
    path = os.path.join(ROOT, '.vercelignore')
    if not os.path.exists(path):
        return patterns
    with open(path, 'r', encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith('#'):
                patterns.append(line)
    return patterns


IGNORE = load_ignore()
# ``--with-tools`` keeps tools/ reachable so the in-page audit harness
# (tools/browser_audit.js + tools/dom_audit.js) can be loaded against the
# production file set. It is a verification convenience only; the real
# deployment excludes tools/.
WITH_TOOLS = '--with-tools' in sys.argv
if WITH_TOOLS:
    IGNORE = [p for p in IGNORE if p.rstrip('/') != '/tools']


def ignored(rel_path):
    rel = rel_path.replace(os.sep, '/')
    for pattern in IGNORE:
        anchored = pattern.startswith('/')
        needle = pattern[1:] if anchored else pattern
        if anchored:
            if fnmatch.fnmatch(rel, needle) or rel.startswith(needle.rstrip('/') + '/'):
                return True
        else:
            if fnmatch.fnmatch(rel, needle) or fnmatch.fnmatch(os.path.basename(rel), needle):
                return True
            if needle.endswith('/') and rel.startswith(needle):
                return True
    return False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        fs_path = super().translate_path(path)
        rel = os.path.relpath(fs_path, ROOT)
        if rel.startswith('..'):
            return fs_path
        if os.path.isdir(fs_path):
            return fs_path
        if ignored(rel):
            # Pretend the file was never uploaded.
            return os.path.join(ROOT, '__deployed_404__')
        return fs_path

    def do_GET(self):  # noqa: N802 - http.server naming
        request_path = self.path.split('?', 1)[0]
        if request_path.endswith('/') and request_path != '/':
            self.send_response(308)
            self.send_header('Location', request_path.rstrip('/'))
            self.end_headers()
            return
        if request_path.endswith('.html'):
            clean = request_path[:-5]
            if clean.endswith('/index'):
                clean = clean[:-5]
            if clean == '':
                clean = '/'
            self.send_response(308)
            self.send_header('Location', clean)
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path.startswith('/assets/'):
            self.send_header('Cache-Control', 'public, max-age=604800')
        else:
            self.send_header('Cache-Control', 'public, max-age=0, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write('%s\n' % (fmt % args))
        sys.stdout.flush()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8130
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
        print(f'serving the deployed file set on http://127.0.0.1:{port} '
              f'({len(IGNORE)} .vercelignore patterns)')
        httpd.serve_forever()
