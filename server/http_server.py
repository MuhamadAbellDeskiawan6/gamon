import http.server
import os
import socketserver
from urllib.parse import urlparse

ROOT_DIR = "C:/laragon/www/gamon"
PORT = 3000

ROUTE_MAP = {
    "/": "user/undangan/index.html",
    "/index.html": "user/undangan/index.html",
    "/login": "user/undangan/login.html",
    "/login.html": "user/undangan/login.html",
    "/register": "user/undangan/register.html",
    "/register.html": "user/undangan/register.html",
    "/dashboard": "user/undangan/dashboard.html",
    "/dashboard.html": "user/undangan/dashboard.html",
    "/preview": "templates/preview.html",
    "/preview.html": "templates/preview.html",
    "/user/templates": "templates/preview.html",
    "/user/templates/preview": "templates/preview.html",
    "/user/templates/preview.html": "templates/preview.html",
    "/profil": "user/undangan/profil.html",
    "/profil.html": "user/undangan/profil.html",
    "/form": "user/undangan/form.html",
    "/form.html": "user/undangan/form.html",
}


class LocalRouteHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urlparse(path)
        clean_path = parsed.path

        if clean_path.startswith("/assets/"):
            clean_path = "user/undangan/" + clean_path.lstrip("/")
        elif clean_path.startswith("/user/undangan/assets/"):
            clean_path = clean_path.lstrip("/")
        else:
            mapped = ROUTE_MAP.get(clean_path)
            if mapped:
                clean_path = mapped

        if clean_path.startswith("/"):
            clean_path = clean_path.lstrip("/")

        abs_path = os.path.abspath(os.path.join(ROOT_DIR, clean_path))

        if not abs_path.startswith(os.path.abspath(ROOT_DIR)):
            abs_path = os.path.abspath(os.path.join(ROOT_DIR, "index.html"))

        return abs_path

    def log_message(self, format, *args):
        print(f"[HTTP] {self.address_string()} - {format % args}")


os.chdir(ROOT_DIR)

with socketserver.TCPServer(("", PORT), LocalRouteHandler) as httpd:
    print("Server running:")
    print(f"http://127.0.0.1:{PORT}")
    print("Routes: /, /login, /register, /dashboard, /preview")
    httpd.serve_forever()