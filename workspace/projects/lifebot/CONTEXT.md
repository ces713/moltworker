# Lifebot Project Context

**Last updated by:** Claude (Dream Team Enhancement)
**Updated:** 2026-02-08

---

## Current Status

**Phase:** Pre-development (documentation/planning)
**Mission:** Build a working Lifebot PoC - Chrome extension + backend demo

## Project Scope

**Type:** PoC/Demo
**Quality Bar:** Demonstrates core message interception and priority scoring. Shortcuts acceptable for non-core features.
**Timeline:** Q2 2025

*PoC Requirements:*
- Chrome extension intercepts WhatsApp Web messages
- Backend processes and scores messages
- Results visible in extension UI
- Does NOT need: production security, full error handling, polished UI

## What This Project Is

Lifebot is an AI-powered Chrome extension + backend system for managing WhatsApp communications. Core features:

- **PRIORITIZE** - AI priority scoring for messages across 8 dimensions
- **ORGANIZE** - Context-aware group categorization
- **PROTECT** - Emotional Shield filtering (removing toxic/stressful content)
- **AUTOMATE** - Response suggestions, calendar integration

## Technical Architecture

### Components
1. **Chrome Extension** - Intercepts WhatsApp Web API calls client-side
2. **Backend API** - FastAPI (Python 3.11+) with Celery task queue
3. **Database** - PostgreSQL 15 (production), SQLite (PoC)
4. **AI Services** - Claude Sonnet 4, Whisper API
5. **Infrastructure** - Cloudflare Workers, D1, R2

### Key Technical Decisions
- Browser extension intercepts WhatsApp Web's own decrypted API calls client-side - same approach as Grammarly. No ToS violation.
- Manifest V3 for Chrome extension
- FastAPI + SQLAlchemy for backend
- JWT for authentication (15-min access, 7-day refresh)
- AES-256 for message encryption at rest

### Security Requirements
- AES-256 encryption at rest for message content
- Per-user encryption keys with 90-day rotation
- TLS 1.3 for transport
- UK GDPR compliance required
- Legal documentation mode with SHA-256 hashing

### Priority Scoring Scale
1. **Critical** - Immediate action required, emergency
2. **High** - Important, needs attention today
3. **Medium** - Relevant but not urgent
4. **Low** - Informational, can wait
5. **Noise** - Trivial, reactions, acknowledgments

### Four Core Pillars
1. **PRIORITIZE** - 5-level AI priority scoring across 8 dimensions
2. **ORGANIZE** - Context-aware group categorization (School/Activity/Rota/Co-Parent/Work/Family/Social)
3. **PROTECT** - Emotional Shield with 3 filtering levels (40%/75%/95% emotional content removal)
4. **AUTOMATE** - AI response suggestions, calendar integration, financial tracking

### Target Market
- UK parents managing school groups
- Co-parents with difficult ex-partners
- Professionals managing high-volume messaging

## Active Work Items

*No active implementation tasks yet. Currently in planning phase.*

## Recent Decisions

| Date | Decision | Made By |
|------|----------|---------|
| 2026-02-08 | Multi-agent system setup with Mission Control | jarvis |
| 2026-02-08 | Model tiering: Opus 4.6 for leadership, Sonnet 4.5 for implementation | architect |
| 2026-02-08 | Parallel task execution (up to 5 concurrent) | architect |
| 2026-02-08 | Webhook integration for CI/CD (GitHub, Telegram, generic) | architect |
| 2026-02-08 | Added Hawk security agent for vulnerability auditing | architect |

## Known Blockers

- None currently

## Key Documents

| Document | Location | Purpose |
|----------|----------|---------|
| PRD | `research/WhatsApp_Life_Manager_PRD.md` | Full product requirements |
| Master Doc | `research/Lifebot_Project_Master_Document.md` | Project evolution, decisions |
| Tech Specs | `research/tech-specs/` | Architecture documents |

## Agent Notes

*Add observations, learnings, and context updates below. Include your agent ID.*

---

### System Setup Notes (2026-02-08)

Initial context file created. Agents should update this file when they:
- Complete significant work
- Make technical decisions
- Encounter and resolve blockers
- Learn something relevant to the project

Format for updates:
```
### [Agent ID] - [Date] - [Brief Title]

[Your context update here]
```
