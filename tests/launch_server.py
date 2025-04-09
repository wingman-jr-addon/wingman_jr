import http.server
import socketserver

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Override the 'Content-Type' header
        self.send_header('Content-Type', 'text/plain')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def send_header(self, keyword, value):
        # Only send headers that are not 'Content-Type'
        if keyword.lower() != 'content-type':
            super().send_header(keyword, value)


if __name__ == "__main__":
    PORT = 8000
    handler = CustomHTTPRequestHandler
    httpd = socketserver.TCPServer(("", PORT), handler)
    print(f"Serving at port {PORT}")
    httpd.serve_forever()
