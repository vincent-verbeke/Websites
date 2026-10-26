/**
 * Kubotics Server-Side API Handler Specification
 * Direct integration with PostgreSQL & Microsoft 365 (Microsoft Graph API / Bookings)
 * Zero third-party SaaS dependency.
 */

export interface LeadSubmissionPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  interest?: 'Humanoid Robotics' | 'Manufacturing Automation' | 'IT Automation' | 'Consulting Test Day';
  transcript?: string;
  qualificationScore?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  gclid?: string;
  preferredMeetingSlot?: {
    startTime: string; // ISO 8601
    endTime: string;
  };
}

/**
 * Creates or updates lead & session records directly in the Kubotics PostgreSQL database.
 */
export async function persistLeadToPostgres(lead: LeadSubmissionPayload, dbClient: any) {
  const query = `
    WITH upsert_company AS (
      INSERT INTO companies (name)
      VALUES ($1)
      ON CONFLICT DO NOTHING
      RETURNING id
    ),
    upsert_contact AS (
      INSERT INTO contacts (
        email, first_name, last_name, phone, utm_source, utm_medium, utm_campaign, gclid, primary_interest
      )
      VALUES ($2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (email) DO UPDATE SET
        phone = COALESCE(EXCLUDED.phone, contacts.phone),
        updated_at = NOW()
      RETURNING id
    )
    SELECT id FROM upsert_contact;
  `;

  const values = [
    lead.company || 'Unknown Organization',
    lead.email,
    lead.firstName || '',
    lead.lastName || '',
    lead.phone || '',
    lead.utmSource || '',
    lead.utmMedium || '',
    lead.utmCampaign || '',
    lead.gclid || '',
    lead.interest || 'Consulting Test Day'
  ];

  return dbClient.query(query, values);
}

/**
 * Microsoft 365 Calendar / Bookings Integration via Microsoft Graph API
 * Schedules discovery calls or Unitree H2 Test Days directly into Vincent's M365 Outlook Calendar.
 */
export async function scheduleMeetingViaM365(
  lead: LeadSubmissionPayload,
  m365AccessToken: string,
  userPrincipalName: string = 'vincent@kubotics.ch'
) {
  if (!m365AccessToken) {
    console.warn('[M365] No Graph API token configured; skipping automated calendar invite');
    return null;
  }

  // Microsoft Graph API Event payload
  const eventPayload = {
    subject: `Kubotics Automation Consultation: ${lead.interest || 'Discovery'} — ${lead.company || lead.email}`,
    body: {
      contentType: 'HTML',
      content: `
        <h3>Kubotics Discovery & Feasibility Session</h3>
        <p><strong>Lead Email:</strong> ${lead.email}</p>
        <p><strong>Company:</strong> ${lead.company || 'N/A'}</p>
        <p><strong>Primary Interest:</strong> ${lead.interest || 'Humanoid / Automation'}</p>
        <hr/>
        <h4>AI Pre-Qualification Transcript</h4>
        <pre>${lead.transcript || 'Inquiry initiated via website.'}</pre>
      `
    },
    start: {
      dateTime: lead.preferredMeetingSlot?.startTime || new Date(Date.now() + 86400000 * 2).toISOString(),
      timeZone: 'Europe/Zurich'
    },
    end: {
      dateTime: lead.preferredMeetingSlot?.endTime || new Date(Date.now() + 86400000 * 2 + 1800000).toISOString(),
      timeZone: 'Europe/Zurich'
    },
    attendees: [
      {
        emailAddress: {
          address: lead.email,
          name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.email
        },
        type: 'required'
      }
    ],
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness'
  };

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${userPrincipalName}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${m365AccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventPayload)
  });

  return response.json();
}
