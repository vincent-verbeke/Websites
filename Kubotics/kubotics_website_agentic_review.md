# Kubotics Website Review — Agentic Lead Generation & Sales

**Review date:** 2026-10-25  
**Website:** https://www.kubotics.ch  
**Primary goal:** Turn the website into the front door of a fully agentic lead-generation, qualification and sales system.

## Executive assessment

The new Kubotics site is substantially stronger as a technology/commercial presentation, but it is still primarily a **website that explains Kubotics** rather than an **agentic sales interface that converts visitors into structured business opportunities**.

The strategic shift should be:

> **Website → conversation → qualification → solution recommendation → lead/opportunity → meeting/demo → proposal → customer/support lifecycle**

The website should therefore be designed less like a brochure and more like the **visual and conversational entry point to the Kubotics Agent**.

The strongest positioning is not simply “we sell robots.” It is:

> **Tell us what you want to automate. Kubotics determines whether robotics, AI, or a combination can automate it — and helps take it from assessment to deployment.**

---

# 1. What is already good

## Strong positioning

The homepage immediately communicates:

- humanoid robotics
- factory automation
- AI-supported business processes
- Unitree specialization
- Swiss engineering positioning

This is much clearer than a generic robotics-company site.

## Strong product credibility

The H2, G1/G1-D and B2 sections give the visitor concrete technology to anchor the offer.

The H2 especially gives Kubotics a distinctive commercial entry point.

## Good breadth

The combination of:

1. Humanoid/mobile robotics
2. Factory automation
3. IT/business-process automation
4. AI document processing

supports the larger Kubotics story: **automation of physical and digital work**.

## Swiss identity

The Swiss positioning, Wollerau address and engineering language create useful trust for Swiss B2B customers.

## The site is already suitable for an agentic architecture

The current content can become the knowledge base for an AI sales agent without requiring a completely different website concept.

---

# 2. The biggest strategic issue

The site still asks the visitor to understand Kubotics before Kubotics understands the visitor.

For an agentic business, this should be reversed.

### Current mental model

```text
Visitor
  ↓
Reads about Kubotics
  ↓
Reads about robots
  ↓
Reads about solutions
  ↓
Maybe contacts Kubotics
```

### Target mental model

```text
Visitor
  ↓
Describes a problem
  ↓
AI understands the business context
  ↓
AI identifies automation opportunity
  ↓
AI asks qualification questions
  ↓
AI recommends a path
  ↓
Lead/opportunity is created
  ↓
Meeting / test / assessment
  ↓
Proposal
  ↓
Delivery + support
```

This is the most important change I would make.

---

# 3. Make the primary CTA conversational

The current CTAs are still relatively traditional:

- Lösungen erkunden
- Roboter & Tech
- H2 Testtag buchen
- Kontakt

For an agentic company, the primary CTA should be closer to:

> **Was möchten Sie automatisieren?**

or:

> **Beschreiben Sie Ihren Automatisierungsbedarf**

or:

> **Start an Automation Assessment**

The visitor should immediately enter the AI conversation.

The website can still retain normal navigation and traditional CTAs, but the **agent should be the dominant conversion mechanism**.

---

# 4. Turn the AI chatbot into the actual sales interface

The existing AI entry point should evolve from a chatbot into a **Kubotics Sales Engineer**.

It should be capable of:

### Discovery

Understand:

- company
- industry
- process
- current workflow
- pain point
- volumes
- frequency
- human involvement
- machines/software already involved

### Qualification

Determine:

- automation potential
- estimated complexity
- robotics vs software vs AI
- required integration
- urgency
- budget range
- decision-maker status
- expected timeline

### Recommendation

The agent should be able to say something like:

> Based on what you described, this looks primarily like a machine-tending automation project rather than a humanoid-robot project. We would recommend a short automation assessment.

Or:

> Your process appears suitable for an initial H2 feasibility test. The next useful step would be a Test Day using your actual workflow.

That is much more valuable than simply answering questions about the H2.

---

# 5. The website should collect structured business data

Do not let the AI conversation remain only as chat history.

The agent should extract structured information into PostgreSQL.

Example:

```text
lead
 ├── person
 ├── company
 ├── industry
 ├── process
 ├── problem
 ├── automation_type
 ├── current_solution
 ├── estimated_volume
 ├── estimated_frequency
 ├── urgency
 ├── budget
 ├── timeline
 ├── qualification_score
 ├── recommended_solution
 └── next_action
```

This fits the architecture you are already planning much better than introducing a third-party CRM.

---

# 6. PostgreSQL should remain the system of record

I would **not introduce HubSpot or another CRM simply because the website needs lead management**.

Your existing PostgreSQL platform is actually an advantage.

The agent should create and maintain:

```text
organizations
contacts
conversations
messages
leads
opportunities
projects
products
robots
support_cases
documents
knowledge
agent_runs
agent_actions
communications
audit_events
```

The website, Telegram, Teams and eventually voice should all use the same agent core and business database.

This creates:

> **One business brain + one system of record + many interfaces**

rather than independent systems that later need synchronisation.

---

# 7. Separate conversation history from agent execution history

This is particularly important for an autonomous sales system.

Store:

```text
conversation
    ↓
messages
    ↓
agent_run
    ↓
tool_calls
    ↓
tool_results
    ↓
business_events
```

This allows you to answer:

- What did the customer say?
- What did the agent understand?
- What did the agent decide?
- Which tools did it call?
- Which records did it modify?
- Did it send an email?
- Did it book a meeting?
- Did a human approve the action?

This will become extremely important once the agent starts acting autonomously.

---

# 8. Change the information hierarchy

The current site is technology-heavy.

For commercial conversion, I would reorder the story:

## 1. Problem

“What do you want to automate?”

## 2. Outcome

“Reduce repetitive work, increase throughput, improve consistency, or automate an entire workflow.”

## 3. Solution

Robotics / AI / software / integrated automation.

## 4. Proof

H2, G1, B2, robot arms, AI systems, integrations.

## 5. Process

Assess → Prototype → Integrate → Deploy → Operate.

## 6. Conversation

Talk to the Kubotics agent.

This puts the technology in the role of **proof and implementation**, rather than making the technology itself the product.

---

# 9. Create an explicit automation problem selector

A very useful homepage component would be:

### What are you trying to automate?

Possible choices:

- Production
- Machine tending
- Logistics
- Inspection
- Assembly
- Quality control
- Warehouse
- Administration
- Invoices
- Planning
- Customer service
- Something else

Selecting one should immediately open the agent with context.

For example:

```text
User selects:
Machine tending

Agent:
Tell me a little about the machine, the current loading/unloading
process and how many cycles you run per shift.
```

This dramatically reduces the effort required to start a sales conversation.

---

# 10. Make H2 a funnel, not just a product

The H2 section is strong, but it should lead toward a business outcome.

Instead of:

> Here are the specifications of the H2.

Use:

> **Could a humanoid robot automate your process?**

Then:

1. Describe the use case.
2. Upload photos/video/process information.
3. Agent evaluates feasibility.
4. Agent asks additional questions.
5. Agent recommends H2 Test Day / assessment.
6. Lead is created.
7. Meeting is booked.

The H2 itself becomes the **conversion engine**.

---

# 11. Test Day should become a structured product

The H2 Test Day is one of the strongest commercial ideas on the website.

Turn it into an actual productized service:

## H2 Automation Test Day

**Bring your process. We test whether the H2 can perform it.**

Possible flow:

```text
Describe process
      ↓
AI pre-qualification
      ↓
Upload images/video/process data
      ↓
Technical pre-assessment
      ↓
Book Test Day
      ↓
Test
      ↓
Feasibility report
      ↓
Integration proposal
```

This is much easier for an AI sales agent to sell than a generic “contact us” interaction.

---

# 12. Add a clear customer journey

I recommend explicitly presenting:

```text
01 DISCOVER
Describe the problem

02 ASSESS
AI + engineering evaluate the opportunity

03 PROTOTYPE
Test the automation

04 INTEGRATE
Connect robot, machines and software

05 DEPLOY
Put the system into operation

06 OPERATE
Support, optimization and further automation
```

This also gives the agent a natural sales state machine.

---

# 13. The agent should have a sales state machine

Instead of an unstructured chatbot, define states such as:

```text
NEW
 ↓
DISCOVERY
 ↓
QUALIFICATION
 ↓
TECHNICAL_ASSESSMENT
 ↓
SOLUTION_RECOMMENDED
 ↓
MEETING_REQUESTED
 ↓
MEETING_BOOKED
 ↓
OPPORTUNITY
 ↓
PROPOSAL
 ↓
CUSTOMER
```

The AI can converse naturally while the backend maintains deterministic business state.

This is a critical architectural distinction.

---

# 14. Add proof and trust

The current site communicates capability, but not enough **evidence of commercial execution**.

Add:

### Case studies

Even a small number is useful.

Example:

> CNC machine tending  
> X hours/day automated  
> Y% reduction in manual handling

### Real deployments

Show:

- robot
- environment
- integration
- result

### Engineering credibility

Show:

- Swiss engineering
- integration capability
- robotics/software expertise
- support
- commissioning

### People

A real person behind the company improves trust significantly in B2B sales.

---

# 15. Be careful with technical claims

The homepage currently contains claims such as:

- Precision 0.01mm
- Response <1ms
- Autonomy Level 5

These are potentially powerful, but only keep them if they are:

1. objectively measurable,
2. clearly defined,
3. applicable to the relevant system,
4. defensible in front of a technical customer.

Otherwise they create more risk than credibility.

For an agentic sales system, every public claim should ideally exist as a verified knowledge-base fact that the agent can safely repeat.

---

# 16. Unitree partnership claim

The statement:

> “Offizieller Partner & Spezialist für Unitree-Roboter in der Schweiz und Europa.”

is commercially strong.

But **“official partner” should only remain if the contractual relationship supports that exact wording**.

If not, use something such as:

> Swiss specialist for Unitree robotics

or

> Unitree robotics specialist in Switzerland and Europe

The agent should also know exactly what commercial relationship Kubotics has with Unitree.

---

# 17. Website language

For Swiss B2B customers, I would make **German the primary commercial experience**.

English should remain available for:

- international robotics partners
- technical users
- developers
- international customers

The agent should support both naturally.

The language should also be stored as part of the customer/contact context so that subsequent emails and conversations remain consistent.

---

# 18. SEO should support agentic acquisition

SEO should target customer problems, not only robot names.

Examples:

### Robotics

- humanoider Roboter Schweiz
- Unitree H2 Schweiz
- humanoide Robotik Unternehmen Schweiz
- humanoider Roboter Industrie

### Automation

- CNC Maschinenbeschickung Schweiz
- Roboter Maschinenbeschickung
- Fabrikautomation Schweiz
- Roboterzelle Schweiz
- Pick and Place Automation Schweiz

### AI

- KI Automatisierung Unternehmen Schweiz
- Geschäftsprozesse automatisieren Schweiz
- KI Rechnungsverarbeitung
- AI Agent Schweiz
- AI Voice Agent Schweiz

Each landing page should ultimately feed the **same agent**, not a separate lead form.

---

# 19. Build the website around reusable agent knowledge

The website content should become structured knowledge rather than only HTML copy.

For example:

```text
Product
 ├── H2
 │    ├── capabilities
 │    ├── specifications
 │    ├── limitations
 │    ├── use_cases
 │    ├── pricing_rules
 │    └── test_day
 │
Solution
 ├── machine_tending
 ├── inspection
 ├── logistics
 ├── document_processing
 └── planning
```

Then the same information can power:

- website
- chatbot
- Telegram
- Teams
- email
- future voice agent
- sales proposals
- support

That is much more scalable than maintaining separate content for every channel.

---

# 20. Telegram should be the first external agent channel

For the POC, I agree with starting with Telegram rather than telephony.

The architecture should be:

```text
Telegram
    ↓
Telegram Adapter
    ↓
Kubotics Agent Core
    ↓
PostgreSQL
    ↓
Tools
 ├── Knowledge
 ├── Leads
 ├── Calendar
 ├── Email
 ├── Products
 ├── Projects
 └── Documents
```

Then add:

```text
Microsoft Teams
       ↓
same Agent Core
```

and later:

```text
Voice / Phone
       ↓
same Agent Core
```

There should be **no separate intelligence layer per channel**.

---

# 21. Microsoft 365 should become a major sales integration

Because Kubotics already uses Microsoft 365 Business Premium, Microsoft Graph should eventually connect:

- Outlook
- Calendar
- Teams
- contacts
- email
- meetings
- internal collaboration

The agent should eventually be able to:

```text
qualify lead
    ↓
check calendar
    ↓
propose times
    ↓
book meeting
    ↓
create opportunity
    ↓
prepare meeting briefing
    ↓
send follow-up
```

This is much more valuable than simply having a Teams chatbot.

---

# 22. Autonomous sales needs permissions

Do not make every agent action unrestricted.

Define tools and permissions such as:

```text
READ
 ├── products
 ├── knowledge
 ├── availability
 └── customer history

WRITE
 ├── lead
 ├── opportunity
 └── meeting

REQUIRES_APPROVAL
 ├── quotation
 ├── discount
 ├── contractual commitment
 ├── delivery promise
 └── high-value purchase
```

Later, some of these approval requirements can be relaxed once the agent proves reliable.

---

# 23. The ideal Kubotics architecture

```text
                         KUBOTICS WEBSITE
                               │
                               ▼
                         AI CONVERSATION
                               │
                               ▼
                    ┌─────────────────────┐
                    │   KUBOTICS AGENT    │
                    │                     │
                    │ Discovery           │
                    │ Qualification       │
                    │ Reasoning           │
                    │ Recommendation      │
                    │ Sales               │
                    │ Handover            │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        PostgreSQL        Knowledge        Tool APIs
       System of Record    / RAG          / Business Logic
              │                │                │
              └────────────────┼────────────────┘
                               │
       ┌───────────────┬───────┼────────┬───────────────┐
       ▼               ▼       ▼        ▼               ▼
    Website         Telegram  Teams   Email          Voice
       │               │       │        │               │
       └───────────────┴───────┴────────┴───────────────┘
```

The website is therefore not the product.

**The agentic business platform is the product. The website is its public interface.**

---

# 24. Recommended homepage structure

I would target something close to:

## Hero

**Robotics & AI that automate real work.**

Short explanation:

> From humanoid robots and industrial automation to AI-powered business processes, Kubotics turns repetitive work into intelligent automation.

Primary CTA:

**Describe what you want to automate**

Secondary CTA:

**Explore our solutions**

---

## Automation problem selector

**What would you like to automate?**

Production | Logistics | Inspection | Administration | Customer Service | Other

---

## AI conversation

> Tell us what is currently taking too much time, money or manpower.

Start the agent.

---

## Solutions

### Humanoid Robotics
H2 / G1 / B2

### Industrial Automation
Robot arms / cells / machine tending

### AI & Business Automation
Agents / ERP / documents / planning

---

## Featured H2

**Could a humanoid robot automate your process?**

→ Start H2 assessment

---

## How it works

Discover → Assess → Prototype → Integrate → Deploy → Operate

---

## Proof

Case studies / projects / technology / partners

---

## Final CTA

**Tell Kubotics what you want to automate.**

---

# 25. Priority backlog

## P0 — Do first

1. Make the agent the primary conversion path.
2. Replace generic contact-first CTA with automation/problem-first CTA.
3. Turn chatbot into structured AI sales engineer.
4. Connect agent to PostgreSQL.
5. Store structured lead and opportunity data.
6. Add agent runs/actions/audit trail.
7. Productize H2 Test Day.
8. Remove or verify questionable technical claims.
9. Verify “official Unitree partner” wording.

## P1 — Next

10. Add automation problem selector.
11. Add customer journey.
12. Add case studies/proof.
13. Add AI automation assessment.
14. Connect calendar.
15. Connect email.
16. Start Telegram agent.
17. Connect website and Telegram to exactly the same agent.

## P2

18. Microsoft Teams.
19. Microsoft Graph / Outlook.
20. Automated meeting preparation.
21. Automated follow-up.
22. Proposal generation.
23. Lead scoring.
24. Agent-driven outbound prospecting.

## P3

25. Voice.
26. Customer portal.
27. Autonomous marketing.
28. Automated campaign experiments.
29. Agent-driven account management.
30. Fully autonomous lead → opportunity → proposal workflow with human approval gates.

---

# Final recommendation

The website is now good enough to become the **front end of the Kubotics agentic sales platform**.

I would **not spend the next iteration mainly on visual polish**.

The biggest opportunity is to make the website *behave differently*:

> **Stop asking visitors to browse Kubotics. Start asking them what they want to automate.**

The most important implementation is therefore:

```text
Website
   ↓
"Describe your automation problem"
   ↓
Kubotics Agent
   ↓
PostgreSQL
   ↓
Qualification
   ↓
Solution recommendation
   ↓
Calendar / Test Day / Meeting
   ↓
Opportunity
   ↓
Proposal
```

Once that works, Telegram, Teams, email and eventually voice become relatively thin interfaces around the same business intelligence.

**Strategic principle:**

> **One agent brain. One PostgreSQL system of record. Many customer interfaces.**
