# Mission Control Team

## Agent Roster

| Agent | Specialty | Skills | Model Tier | Ask Them About |
|-------|-----------|--------|------------|----------------|
| jarvis | controller | project-management, task-breakdown, approval, github-merge | leadership | Task prioritization, approvals, blockers, PR merges |
| architect | architecture | system-design, api-design, database, tech-specs, adrs | leadership | Technical decisions, API contracts, data models, architecture |
| backend | backend | python, fastapi, sql, celery, redis, ai-integration | standard | Server-side implementation, APIs, databases, AI services |
| frontend | frontend | javascript, react, chrome-extensions, typescript, css | standard | UI, browser code, Chrome extension, user interactions |
| reviewer | review | code-review, testing, quality, debugging | standard | Code quality, test coverage, best practices, functionality |
| hawk | security | security-audit, owasp, penetration-testing, compliance | standard | Security concerns, vulnerabilities, GDPR, encryption |

## Model Tiers

- **Leadership Tier** (Grok 4.1, 131K context): Complex reasoning, full codebase visibility
- **Standard Tier** (Grok 4.1 Fast, 131K context): Implementation work
- **Economy Tier** (Grok 3 Mini, 131K context): Simple tasks, heartbeat checks

## Inter-Agent Communication

### Inbox (Automatic)

The heartbeat system manages your inbox automatically:
- Pending questions are delivered as **priority-9 answer tasks**
- Answer the question in your task output — the system routes it back
- High-priority questions (priority >= 7) are answered FIRST

### Message Types

| Type | Use For |
|------|---------|
| `question` | Need input before you can proceed |
| `answer` | Response to a question |
| `handoff` | Passing work to another agent |
| `info` | FYI - no response needed |

## Action Blocks (Creating Tasks & Dependencies)

**DO NOT use HTTP API calls.** Agents are text-only. To create tasks or wire
dependencies, emit an action block at the end of your output:

```
[ACTIONS_BEGIN]
{"action":"create_task","ref":"design","subject":"Design auth API","priority":7,"assign_to":"architect"}
{"action":"create_task","ref":"impl","subject":"Implement auth API","priority":5,"assign_to":"backend"}
{"action":"add_dependency","task_ref":"impl","blocked_by_ref":"design"}
[ACTIONS_END]
```

### create_task fields

| Field | Required | Description |
|-------|----------|-------------|
| `ref` | yes | Label for referencing in add_dependency (not stored) |
| `subject` | yes | Task title (max 200 chars) |
| `description` | no | Details (max 5000 chars) |
| `priority` | no | 1-10 (default 5) |
| `assign_to` | no | Agent ID: jarvis, architect, backend, frontend, reviewer, hawk |
| `project_id` | no | Inherits from parent task if omitted |

### add_dependency fields

| Field | Description |
|-------|-------------|
| `task_ref` / `blocked_by_ref` | Use ref labels from create_task |
| `task_id` / `blocked_by_id` | Or use real task IDs for existing tasks |

### save_memory fields

| Field | Required | Description |
|-------|----------|-------------|
| `content` | yes | Text to append to your persistent agent memory |

Example:
```
{"action":"save_memory","content":"Project X uses PostgreSQL 16 with pgvector for embeddings"}
```

### update_project_context fields

| Field | Required | Description |
|-------|----------|-------------|
| `content` | yes | Text to append to the project's shared context |
| `project_id` | no | Inherits from parent task if omitted |

Example:
```
{"action":"update_project_context","content":"Decided to use JWT auth with 15min access tokens and 7-day refresh tokens"}
```

### save_file fields

Write standalone files to the project workspace (R2). Use this for deliverables, specs, and any document that should exist as its own file.

| Field | Required | Description |
|-------|----------|-------------|
| `path` | yes | Relative path within the workspace (max 200 chars, no `..` or absolute paths) |
| `content` | yes | File content (max 100KB) |

- Files are written to `projects/{project_id}/workspace/{path}` in R2
- Metadata is attached automatically: `agent_id`, `phase_id`, `task_id`
- Use for deliverables like specs, ADRs, reports — anything that should be a standalone file
- Use `update_project_context` only for brief notes/decisions, not full documents

Examples:
```
{"action":"save_file","path":"technical/site-structure.md","content":"# Site Structure\n\n## Pages\n- Home\n- About\n..."}
{"action":"save_file","path":"architecture/adr-001-auth.md","content":"# ADR-001: Authentication Strategy\n\n## Decision\nUse JWT..."}
```

**Limits:** max 20 actions per block. Errors never fail the parent task.

## Task Handoff Protocol

### Workflow Dependencies

1. **Architecture First**: Architecture/design tasks should complete before implementation
2. **Security Review**: Hawk reviews security-sensitive changes before merge
3. **Code Review**: Reviewer approves all PRs before Jarvis merges

## Who To Ask For What

### Technical Design Questions
**Ask: Architect**
- "Should this API use REST or GraphQL?"
- "What's the data model for this feature?"
- "How should these components integrate?"

### Security Concerns
**Ask: Hawk**
- "Is this authentication approach secure?"
- "Are there security concerns with this implementation?"
- "Does this meet GDPR requirements?"

### API/Backend Questions
**Ask: Backend**
- "What's the API endpoint format for X?"
- "How is this data stored/transmitted?"
- "What's the error response format?"

### UI/Extension Questions
**Ask: Frontend**
- "What's the component structure for this feature?"
- "How should this UI state be managed?"
- "What are the extension permission requirements?"

### Quality/Testing Questions
**Ask: Reviewer**
- "Does this implementation match the spec?"
- "What test cases should I cover?"
- "Is this code pattern acceptable?"

### Prioritization/Process Questions
**Ask: Jarvis**
- "What's the priority between these features?"
- "Should I block on this or proceed?"
- "Is this task ready for review?"

## Escalation Protocol

### When to Escalate to Jarvis

- After 3 failed attempts at a task
- Stuck dependencies (24+ hours with no progress)
- Conflicting requirements between agents
- Need human decision or clarification
- Critical security findings (via Hawk)

### Auto-Escalation

The heartbeat service automatically escalates:
- Tasks that fail 3 times consecutively
- Dependencies stuck for more than 24 hours
- High-priority messages unanswered for more than 2 hours

## Methodology-Driven Projects

Projects can be assigned a methodology (agile-sprint, kanban, waterfall, etc.).
When a project has a methodology:

- **Jarvis** receives the methodology YAML as context and orchestrates work by phases/gates
- Each phase defines which agents participate, deliverables, and gate criteria
- Other agents should complete deliverables as defined by their assigned phase
- Phase gates require Jarvis approval before the next phase begins

Available methodologies: agile-sprint, kanban, waterfall, content-editorial,
business-process, marketing-campaign, seo-audit, ios-app-development.

## Context Sharing

### How Context Works

Mission Control automatically injects relevant context into your prompt for each task:
- **Soul file** — your role-specific instructions
- **TEAM.md** (this file) — shared protocols
- **Agent memory** — your persistent notes across tasks
- **Project context** — project memory, communications, document index, methodology
- **Task details** — current task with description, priority, dependencies

You do not need to read files manually — everything relevant is provided in your prompt.

### Updating Context

Use action blocks to persist important information:

- **`save_memory`** — personal agent memory (spans projects)
- **`update_project_context`** — brief project-level notes visible to all agents
- **`save_file`** — standalone deliverable files in the project workspace

---

*This is the git-tracked reference copy. The authoritative version is generated by `POST /api/team/sync`.*
