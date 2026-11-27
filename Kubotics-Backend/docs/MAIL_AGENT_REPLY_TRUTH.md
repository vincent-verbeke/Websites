# Mail agent reply truth (2026-11-27 incident)

## What happened

27 Nov 2026 11:11 UTC: Maurizio Arrigo (Pictet & Co, private bank) replied to
Vincent's 20 Nov EGM letter with a short, formal acknowledgement:

> Dear Mr. Verbeke, Thank you for sharing your thoughts. We appreciate your
> transparency. Best regards, Maurizio Arrigo

61 seconds later the mail agent auto-replied (`state=replied`,
`route=thread_reply`):

> Thank you, Maurizio — much appreciated for getting your voting form back to
> us so promptly for the EGM on 25 November. It's genuinely helpful to have
> your response in hand well ahead of time. ...

Vincent: *"this was completely wrong to an important contact!"*

The reply was wrong on every axis:

1. **Roles reversed** — Arrigo is the administrator acknowledging Vincent's
   (the shareholder's) abstention form; the reply thanked HIM as if he had
   submitted a form to us.
2. **Temporal nonsense** — "well ahead of time" for an EGM that had already
   happened two days earlier.
3. **Invented sentiment** — "your continued engagement — it means a great
   deal" for a four-line bank acknowledgement.

## Root cause

`build_compose_system()` (mail_llm.py) built the composer prompt from
sender name, tier, **subject line** and classification category/criticality
only. The inbound message body and the classifier's (correct!) summary were
never passed to the composing model. Subject "RE: Voting Form – EGM..." plus
`kind=thank_you` rules was enough for the model to invent a voting-form
thank-you. The classifier HAD read the body (`classify_message` receives
`body_text`); the composer never did.

## Fix (same day)

* `compose_reply` / `build_compose_system` now accept `message_body` +
  `message_summary` and inject them into the prompt, with an explicit
  instruction to base the reply only on their actual words and never invent
  obligations/actions (`mail_agent` passes `body_text` + `cls["summary"]`).
* Regression test: `test_build_compose_system_sees_their_actual_message`.

## Follow-ups (recommended, need Vincent's call)

* The apology draft for Arrigo was **not sent** — drafted and emailed to
  Vincent for approval (per his instruction).
* Consider `MAIL_AGENT_MODE=observe` for high-tier contacts (tier gating
  for auto-send) so important relationships always get a human pass.
