"""Transactional account email through a provider-neutral SMTP connection."""

from __future__ import annotations

import html
import logging
import smtplib
from email.message import EmailMessage

log = logging.getLogger("algoliquid.mailer")


def send_action_email(settings, *, recipient: str, name: str, kind: str, token: str) -> None:
    action = "verify" if kind == "verify" else "reset"
    url = f"{settings.public_app_url}/?{action}={token}"
    if not settings.email_configured:
        if settings.is_production:
            raise RuntimeError("transactional email is not configured")
        # Development-only convenience. Tokens are never logged in production.
        log.warning("Development %s link for %s: %s", action, recipient, url)
        return

    verify = kind == "verify"
    subject = "Verify your AlgoLiquid Studio email" if verify else "Reset your AlgoLiquid Studio password"
    heading = "Verify your email" if verify else "Reset your password"
    button = "Verify email" if verify else "Choose a new password"
    expiry = "24 hours" if verify else "30 minutes"
    safe_name = html.escape(name or "there")
    safe_url = html.escape(url, quote=True)
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message.set_content(f"Hello {name or 'there'},\n\n{heading}: {url}\n\nThis link expires in {expiry}. If you did not request it, ignore this email.")
    message.add_alternative(
        f"""<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0b0d12;color:#f5f7fb;padding:32px">
        <div style="max-width:560px;margin:auto;background:#151923;border:1px solid #2a3140;border-radius:12px;padding:28px">
        <h2>{heading}</h2><p>Hello {safe_name},</p><p>Use the secure button below to continue. This link expires in {expiry}.</p>
        <p style="margin:28px 0"><a href="{safe_url}" style="background:#3b82f6;color:white;text-decoration:none;padding:12px 18px;border-radius:7px">{button}</a></p>
        <p style="color:#9aa4b5;font-size:13px">If you did not request this, you can safely ignore this email.</p></div></body></html>""",
        subtype="html",
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_starttls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
