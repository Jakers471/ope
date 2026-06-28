"""
Flask API + static host for the schedule analytics app, launched inside a
PyWebView desktop window.

Run modes:
  python -m app.server          launch the desktop window (PyWebView)
  python -m app.server --web    serve only, open http://127.0.0.1:8731 in a browser
"""
from __future__ import annotations

import base64
import datetime
import json
import os
import re
import sys
import threading
import time
import uuid

from flask import Flask, jsonify, request, send_from_directory

# Allow running both as a module and as a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analytics import Analytics  # noqa: E402

HOST = "127.0.0.1"
PORT = 8731
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
ANALYTICS = Analytics()

# Share mode: when serving behind a public link, hide the personal pay/tips data.
SHARE = "--share" in sys.argv or os.environ.get("SHARE_MODE") == "1"

# Build id changes every restart; open pages poll it and reload to pick up updates.
BUILD = str(int(time.time()))

# Visit log: record each page open (real client IP via Cloudflare headers).
_LOG_DIR = os.path.abspath(os.path.join(os.path.dirname(STATIC_DIR), "..", "logs"))
VISITS_LOG = os.path.join(_LOG_DIR, "visits.tsv")
EVENTS_LOG = os.path.join(_LOG_DIR, "events.tsv")
CHAT_LOG = os.path.join(_LOG_DIR, "chat.jsonl")
UPLOAD_DIR = os.path.join(_LOG_DIR, "chat_uploads")

_chat = []
_chat_lock = threading.Lock()
_PUB_FIELDS = ("id", "ts", "name", "text", "img")
_IMG_RE = re.compile(r"^data:image/(png|jpeg|jpg|gif|webp);base64,(.+)$", re.DOTALL)


def _load_chat():
    if os.path.exists(CHAT_LOG):
        with open(CHAT_LOG, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        _chat.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass


_load_chat()


def _pub(m):
    return {k: m.get(k, "") for k in _PUB_FIELDS}


def _add_msg(name, text, img=""):
    with _chat_lock:
        mid = (_chat[-1]["id"] + 1) if _chat else 1
        msg = {"id": mid, "ts": datetime.datetime.now().strftime("%H:%M"),
               "name": name, "text": text, "img": img, "ip": _client_ip()}
        _chat.append(msg)
        os.makedirs(_LOG_DIR, exist_ok=True)
        with open(CHAT_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg) + "\n")
    return msg


_BOT_UA = ("claude-user", "headless", "curl", "python-requests", "bot", "wget", "spider")


def _client_ip():
    return (request.headers.get("Cf-Connecting-Ip")
            or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.remote_addr or "?")


def _is_real_visitor(ip, ua):
    """Skip local testing and automation so only real browser visits are logged."""
    if ip in ("127.0.0.1", "::1", "?"):
        return False
    ual = ua.lower()
    return not any(b in ual for b in _BOT_UA)


def _append(path, header, line):
    os.makedirs(_LOG_DIR, exist_ok=True)
    new = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as f:
        if new:
            f.write(header + "\n")
        f.write(line + "\n")


# Visits are logged from a client beacon (POST), not the page request, because
# Cloudflare may serve the cached HTML without the request reaching this origin.


def _range():
    """Read the optional start/end date window from the query string."""
    return request.args.get("start") or None, request.args.get("end") or None


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/config")
def api_config():
    return jsonify({"share": SHARE, "build": BUILD})


@app.route("/api/track", methods=["POST"])
def api_track():
    ip = _client_ip()
    ua = request.headers.get("User-Agent", "")
    if not _is_real_visitor(ip, ua):
        return ("", 204)
    d = request.get_json(silent=True) or {}
    sid = str(d.get("sid", ""))[:12]
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if d.get("event") == "open":  # a fresh page open -> visit log
        country = request.headers.get("Cf-IPCountry", "")
        _append(VISITS_LOG, "Time\tIP\tCountry\tSession\tUserAgent",
                f"{ts}\t{ip}\t{country}\t{sid}\t{ua.replace(chr(9), ' ')[:140]}")
        print(f"[VISIT] {ts}  {ip}  {country}  {sid}", flush=True)
    else:  # a page view with time spent -> events log
        page = str(d.get("page", ""))[:50]
        try:
            secs = round(float(d.get("secs", 0)), 1)
        except (TypeError, ValueError):
            secs = 0
        _append(EVENTS_LOG, "Time\tIP\tSession\tPage\tSeconds", f"{ts}\t{ip}\t{sid}\t{page}\t{secs}")
        print(f"[VIEW]  {ts}  {ip}  {sid}  {page}  {secs}s", flush=True)
    return ("", 204)


@app.route("/api/chat", methods=["GET", "POST"])
def api_chat():
    if request.method == "POST":
        d = request.get_json(silent=True) or {}
        name = (str(d.get("name", "")).strip()[:24]) or "Guest"
        text = str(d.get("text", "")).strip()[:500]
        if not text:
            return ("", 204)
        msg = _add_msg(name, text)
        print(f"[CHAT]  {msg['ts']}  {name}: {text}", flush=True)
        return jsonify(_pub(msg))
    since = request.args.get("since", 0, type=int)
    with _chat_lock:
        out = [_pub(m) for m in _chat if m["id"] > since]
    return jsonify(out)


@app.route("/api/chat/image", methods=["POST"])
def api_chat_image():
    d = request.get_json(silent=True) or {}
    m = _IMG_RE.match(d.get("data", ""))
    if not m:
        return jsonify({"error": "not an image"}), 400
    ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
    try:
        raw = base64.b64decode(m.group(2))
    except (ValueError, TypeError):
        return jsonify({"error": "bad data"}), 400
    if len(raw) > 6_000_000:
        return jsonify({"error": "image too big (6MB max)"}), 413
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    fn = uuid.uuid4().hex + "." + ext
    with open(os.path.join(UPLOAD_DIR, fn), "wb") as f:
        f.write(raw)
    name = (str(d.get("name", "")).strip()[:24]) or "Guest"
    text = str(d.get("text", "")).strip()[:500]
    msg = _add_msg(name, text, img="/chatimg/" + fn)
    print(f"[CHAT]  {msg['ts']}  {name}: [image] {text}", flush=True)
    return jsonify(_pub(msg))


@app.route("/chatimg/<path:fn>")
def chatimg(fn):
    return send_from_directory(UPLOAD_DIR, fn)


@app.route("/api/meta")
def api_meta():
    return jsonify(ANALYTICS.bounds())


@app.route("/api/overview")
def api_overview():
    start, end = _range()
    return jsonify(ANALYTICS.overview(start, end))


@app.route("/api/jobs")
def api_jobs():
    start, end = _range()
    return jsonify(ANALYTICS.jobs(start, end))


@app.route("/api/job/<path:job>")
def api_job(job):
    start, end = _range()
    detail = ANALYTICS.job_detail(job, start, end)
    if detail is None:
        return jsonify({"error": "no data for job in period", "job": job}), 404
    return jsonify(detail)


@app.route("/api/dynamics/<path:job>")
def api_dynamics(job):
    start, end = _range()
    dyn = ANALYTICS.job_dynamics(job, start, end)
    if dyn is None:
        return jsonify({"error": "no data for job in period", "job": job}), 404
    return jsonify(dyn)


@app.route("/api/seniority")
def api_seniority():
    start, end = _range()
    return jsonify(ANALYTICS.seniority(start, end))


@app.route("/api/trajectory/<int:pid>")
def api_trajectory(pid):
    start, end = _range()
    scope = request.args.get("scope", "srv")
    traj = ANALYTICS.trajectory(pid, scope, start, end)
    if traj is None:
        return jsonify({"error": "no trajectory for person", "id": pid}), 404
    return jsonify(traj)


@app.route("/api/favorability")
def api_favorability():
    start, end = _range()
    scope = request.args.get("scope", "srv")
    return jsonify(ANALYTICS.favorability_grid(scope, start, end))


@app.route("/api/pay")
def api_pay():
    if SHARE:
        return jsonify({"error": "private"}), 403  # personal data hidden in share mode
    p = ANALYTICS.pay()
    if p is None:
        return jsonify({"error": "no timecard data"}), 404
    return jsonify(p)


@app.route("/api/people")
def api_people():
    start, end = _range()
    return jsonify(ANALYTICS.people(start, end))


@app.route("/api/person/<int:pid>")
def api_person(pid):
    start, end = _range()
    detail = ANALYTICS.person(pid, start, end)
    if detail is None:
        return jsonify({"error": "no data for person in period", "id": pid}), 404
    return jsonify(detail)


def _run_server():
    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)


def main():
    web_only = "--web" in sys.argv
    url = f"http://{HOST}:{PORT}"
    if web_only:
        print(f"Serving at {url}")
        _run_server()
        return

    try:
        import webview
    except ImportError:
        print("pywebview not installed; serving in browser mode.")
        print(f"Open {url}")
        _run_server()
        return

    threading.Thread(target=_run_server, daemon=True).start()
    webview.create_window(
        "Oakville Grill & Cellar - Schedule Analytics",
        url,
        width=1480,
        height=940,
        min_size=(1100, 720),
        background_color="#0a0e13",
    )
    webview.start()


if __name__ == "__main__":
    main()
