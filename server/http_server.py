import http.server
import socketserver
import os

# pindah ke folder gamon
os.chdir("C:/laragon/www/gamon")

PORT = 8080

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:

    print(f"Server running:")
    print(f"http://127.0.0.1:{PORT}")

    httpd.serve_forever()