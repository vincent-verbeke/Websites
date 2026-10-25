"""Microsoft Graph Service for M365 Calendar, Teams, and Mailbox Integration.

Uses enterprise X.509 client certificate authentication via MSAL without passwords.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
import httpx
import msal

load_dotenv()

logger = logging.getLogger(__name__)


class M365GraphService:
    def __init__(
        self,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        cert_path: Optional[str] = None,
        cert_thumbprint: Optional[str] = None,
        organizer_email: Optional[str] = None,
        timezone: str = "Europe/Zurich",
    ):
        self.tenant_id = tenant_id or os.getenv("AZURE_TENANT_ID")
        self.client_id = client_id or os.getenv("AZURE_CLIENT_ID")
        self.cert_path = cert_path or os.getenv("AZURE_CLIENT_CERT_PATH", "certs/m365_app.key")
        self.cert_thumbprint = cert_thumbprint or os.getenv("AZURE_CLIENT_CERT_THUMBPRINT")
        self.organizer_email = organizer_email or os.getenv("M365_ORGANIZER_EMAIL", "vincent.verbeke@kuroliv.ch")
        self.timezone = timezone or os.getenv("M365_DEFAULT_TIMEZONE", "Europe/Zurich")

        self._user_guid: Optional[str] = None
        self._msal_app: Optional[msal.ConfidentialClientApplication] = None

    def _get_msal_app(self) -> msal.ConfidentialClientApplication:
        if self._msal_app is None:
            # Check if private key is supplied directly via env var
            private_key = os.getenv("AZURE_CLIENT_CERT_KEY")
            if not private_key:
                if not os.path.exists(self.cert_path):
                    raise FileNotFoundError(f"M365 private key not found at: {self.cert_path} and AZURE_CLIENT_CERT_KEY env var not set")
                with open(self.cert_path, "r") as f:
                    private_key = f.read()

            self._msal_app = msal.ConfidentialClientApplication(
                self.client_id,
                authority=f"https://login.microsoftonline.com/{self.tenant_id}",
                client_credential={
                    "private_key": private_key,
                    "thumbprint": self.cert_thumbprint,
                },
            )
        return self._msal_app

    def get_access_token(self) -> str:
        app = self._get_msal_app()
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" in result:
            return result["access_token"]
        raise RuntimeError(f"Failed to acquire Microsoft Graph token: {result.get('error_description')}")

    async def get_organizer_user_id(self) -> str:
        """Resolve organizer email to user GUID and cache it."""
        if self._user_guid:
            return self._user_guid

        token = self.get_access_token()
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"https://graph.microsoft.com/v1.0/users/{self.organizer_email}",
                headers=headers,
            )
            if resp.status_code == 200:
                self._user_guid = resp.json()["id"]
                return self._user_guid
            raise RuntimeError(f"Failed to find M365 user {self.organizer_email}: {resp.text}")

    async def get_availability(
        self,
        start_time: datetime,
        end_time: datetime,
        interval_minutes: int = 30,
    ) -> List[Dict[str, Any]]:
        """Query free/busy schedule for the organizer.
        
        Returns availabilityView string and schedule items.
        """
        token = self.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = {
            "schedules": [self.organizer_email],
            "startTime": {
                "dateTime": start_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": self.timezone,
            },
            "endTime": {
                "dateTime": end_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": self.timezone,
            },
            "availabilityViewInterval": interval_minutes,
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"https://graph.microsoft.com/v1.0/users/{self.organizer_email}/calendar/getSchedule",
                headers=headers,
                json=payload,
            )
            if resp.status_code == 200:
                data = resp.json().get("value", [])
                return data
            raise RuntimeError(f"Failed to get schedule: {resp.text}")

    async def book_meeting_with_teams(
        self,
        subject: str,
        start_time: datetime,
        duration_minutes: int = 30,
        attendee_email: Optional[str] = None,
        attendee_name: Optional[str] = None,
        description: str = "",
    ) -> Dict[str, Any]:
        """Create a Calendar Event with an automatic Microsoft Teams video link."""
        user_id = await self.get_organizer_user_id()
        token = self.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        end_time = start_time + timedelta(minutes=duration_minutes)

        attendees = []
        if attendee_email:
            attendees.append({
                "emailAddress": {
                    "address": attendee_email,
                    "name": attendee_name or attendee_email,
                },
                "type": "required",
            })

        event_payload: Dict[str, Any] = {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": f"""
                <p>{description}</p>
                <hr/>
                <p><b>Kubotics Autonomous Scheduling Engine</b><br/>
                Host: Vincent Verbeke (KuroLIV / Kubotics)<br/>
                A Microsoft Teams link has been generated below.</p>
                """,
            },
            "start": {
                "dateTime": start_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": self.timezone,
            },
            "end": {
                "dateTime": end_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "timeZone": self.timezone,
            },
            "isOnlineMeeting": True,
            "onlineMeetingProvider": "teamsForBusiness",
        }

        if attendees:
            event_payload["attendees"] = attendees

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"https://graph.microsoft.com/v1.0/users/{user_id}/events",
                headers=headers,
                json=event_payload,
            )
            if resp.status_code in (200, 201):
                event_data = resp.json()
                teams_url = event_data.get("onlineMeeting", {}).get("joinUrl", "")
                return {
                    "success": True,
                    "event_id": event_data.get("id"),
                    "subject": subject,
                    "start": start_time.isoformat(),
                    "end": end_time.isoformat(),
                    "teams_join_url": teams_url,
                    "web_link": event_data.get("webLink"),
                }
            raise RuntimeError(f"Failed to create Teams calendar event: {resp.text}")

    async def send_confirmation_email(
        self,
        recipient_email: str,
        subject: str,
        body_html: str,
    ) -> bool:
        """Send an email from the organizer's mailbox."""
        user_id = await self.get_organizer_user_id()
        token = self.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML",
                    "content": body_html,
                },
                "toRecipients": [
                    {"emailAddress": {"address": recipient_email}}
                ],
            },
            "saveToSentItems": True,
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"https://graph.microsoft.com/v1.0/users/{user_id}/sendMail",
                headers=headers,
                json=payload,
            )
            return resp.status_code == 202


m365_service = M365GraphService()
