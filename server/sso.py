"""Microsoft 365 / Entra ID SSO via MSAL OAuth2 authorization code flow.

Flow:
  1. GET /auth/sso/login  — build an auth URL and redirect to Microsoft
  2. GET /auth/sso/callback — Microsoft redirects back with ?code=...
     • Exchange the code for tokens via MSAL
     • Fetch the user's profile from MS Graph (/me)
     • If a user with that email already exists, sign them in
     • If not, create a new account with role=member and sign them in
     • Admin can promote them later via the People panel
"""

import os
from flask import Blueprint, redirect, request, session, url_for
import msal

sso_bp = Blueprint("sso", __name__)

# MSAL adds openid, profile, and offline_access automatically.
# Only list the Graph scopes your app actually needs.
SCOPES = ["User.Read"]


def _msal_app():
    """Build an MSAL ConfidentialClientApplication.
    validate_authority=False defers network discovery to runtime so the
    import succeeds even when login.microsoftonline.com is unreachable
    (e.g. in the test environment).
    """
    tenant = os.environ.get("AAD_TENANT_ID", "common")
    return msal.ConfidentialClientApplication(
        client_id=os.environ.get("AAD_CLIENT_ID", ""),
        client_credential=os.environ.get("AAD_CLIENT_SECRET", ""),
        authority=f"https://login.microsoftonline.com/{tenant}",
        validate_authority=False,
    )


def _redirect_uri():
    return os.environ.get(
        "AAD_REDIRECT_URI",
        url_for("sso.callback", _external=True)
    )


def sso_enabled():
    return bool(os.environ.get("AAD_CLIENT_ID") and os.environ.get("AAD_CLIENT_SECRET"))


@sso_bp.get("/auth/sso/login")
def sso_login():
    if not sso_enabled():
        return redirect("/login?error=sso_not_configured")

    flow = _msal_app().initiate_auth_code_flow(
        scopes=SCOPES,
        redirect_uri=_redirect_uri(),
    )
    session["msal_flow"] = flow
    return redirect(flow["auth_uri"])


@sso_bp.get("/auth/sso/callback")
def callback():
    from .db import get_db, uid, now
    from .auth import _encode_roles

    flow = session.pop("msal_flow", None)
    if not flow:
        return redirect("/login?error=sso_session_expired")

    result = _msal_app().acquire_token_by_auth_code_flow(
        auth_code_flow=flow,
        auth_response=request.args.to_dict(),
    )

    if "error" in result:
        err = result.get("error_description", result["error"])
        return redirect(f"/login?error={err[:120]}")

    # Pull identity from the id_token_claims (already verified by MSAL)
    claims = result.get("id_token_claims", {})
    email = (claims.get("preferred_username") or claims.get("email") or "").strip().lower()
    name  = claims.get("name") or email.split("@")[0]

    if not email:
        return redirect("/login?error=no_email_from_microsoft")

    with get_db() as con:
        user = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not user:
            # Auto-provision with member role; admin promotes as needed
            new_id = uid()
            con.execute(
                "INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                (new_id, email, name, "", _encode_roles({"member"}), now())
            )
            user = con.execute("SELECT * FROM users WHERE id=?", (new_id,)).fetchone()

    session.clear()
    session["user_id"] = user["id"]
    return redirect("/")
