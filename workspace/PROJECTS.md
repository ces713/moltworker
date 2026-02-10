# Active Projects Registry

This file lists all active projects managed by the Mission Control system.

## Project Folder Structure

Each project has a dedicated folder in `projects/` with:
```
projects/{project-id}/
├── ACCESS.md      # Which agents can read/write
├── CONTEXT.md     # Working context (updated by agents)
└── research/      # Supporting documents
```

**Context Isolation Rule:** Context from one project should NOT carry over to other projects. Each project's CONTEXT.md is the single source of truth for that project.

## Projects

### lifebot
- **ID**: `lifebot`
- **Status**: active
- **Description**: AI-powered Chrome extension + backend for WhatsApp management
- **Repository**: https://github.com/ces713/lifebot
- **Lead Agent**: jarvis
- **Priority**: 1 (highest)
- **Context Folder**: `projects/lifebot/`

#### Key Documents
- Context: `projects/lifebot/CONTEXT.md`
- Access: `projects/lifebot/ACCESS.md`
- PRD: `projects/lifebot/research/WhatsApp_Life_Manager_PRD.md`
- Master Doc: `projects/lifebot/research/Lifebot_Project_Master_Document.md`

#### Components
| Component | Agent | Status |
|-----------|-------|--------|
| Chrome Extension | frontend | not_started |
| Backend API | backend | not_started |
| Architecture | architect | in_progress |

#### Current Phase
- Phase: **Pre-Development** (documentation/planning)
- Next Milestone: Technical specification complete

---

## Project Status Legend
- `active` - Currently being worked on
- `paused` - Temporarily on hold
- `completed` - Finished
- `archived` - No longer active

## Adding New Projects

1. Create folder: `projects/{project-id}/`
2. Create ACCESS.md with access rules
3. Create CONTEXT.md with initial context
4. Create research/ folder for documents
5. Add entry to this file (PROJECTS.md)
6. Notify Jarvis to update Mission Control database
