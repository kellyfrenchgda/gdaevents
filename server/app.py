"""Flask application: sessions, static files, route guards."""
import os
import re
from pathlib import Path

from flask import Flask, redirect, send_from_directory, url_for, session

from .db import init_db
from .auth import auth_bp
from .api import api_bp
from .sso import sso_bp, sso_enabled

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def create_app():
    app = Flask(__name__, static_folder=None)

    app.secret_key = os.environ.get("SESSION_SECRET", "dev-only-secret-change-me")
    app.config.update(
        SESSION_COOKIE_NAME="gda.sid",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("NODE_ENV") == "production"
            or os.environ.get("FLASK_ENV") == "production",
        PERMANENT_SESSION_LIFETIME=12 * 60 * 60,
    )

    init_db()

    @app.context_processor
    def _inject_sso():
        return {"sso_enabled": sso_enabled()}

    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(sso_bp)

    @app.get("/api/sso-config")
    def sso_config():
        from flask import jsonify
        return jsonify(sso_enabled=sso_enabled())

    @app.get("/healthz")
    def health():
        return "ok", 200, {"Content-Type": "text/plain"}

    # Public static assets (CSS, JS) — no auth needed
    @app.get("/styles.css")
    def css():
        return send_from_directory(PUBLIC_DIR, "styles.css")

    @app.get("/js/<path:filename>")
    def js_assets(filename):
        return send_from_directory(PUBLIC_DIR / "js", filename)

    @app.get("/login")
    def login_page():
        return send_from_directory(PUBLIC_DIR, "login.html")

    # Root and board — require session
    @app.get("/")
    @app.get("/index.html")
    def index():
        if not session.get("user_id"):
            return redirect("/login")
        return send_from_directory(PUBLIC_DIR, "index.html")

    @app.errorhandler(404)
    def not_found(e):
        if "/api/" in str(e):
            from flask import jsonify
            return jsonify(error="Not found."), 404
        return send_from_directory(PUBLIC_DIR, "login.html"), 404

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_ENV") != "production")
