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

- **Leadership Tier** (Opus 4.6, 1M context): Jarvis, Architect - complex reasoning, full codebase visibility
- **Standard Tier** (Sonnet 4.5, 200K context): Backend, Frontend, Reviewer, Hawk - implementation work
- **Economy Tier** (Kimi K2.5, 128K context): Heartbeat checks, simple queries

## Inter-Agent Communication Protocol

### Checking Your Inbox

Before starting any task, check for pending messages:

```
GET /api/agents/{your-id}/inbox
```

**Rules:**
- High-priority questions (priority >= 7) should be answered FIRST
- Read all pending messages before claiming new work
- Don't let questions sit unanswered for more than one heartbeat cycle

### Asking Questions

When you need input from another agent:

1. **POST to their inbox** with your task_id so your task gets blocked:
   ```
   POST /api/agents/{target-agent}/inbox
   {
     "type": "question",
     "content": "Your specific question here",
     "task_id": "your-current-task-id",
     "priority": 7
   }
   ```

2. **Wait for the answer** - DO NOT guess or assume
3. The heartbeat will create an answer task for them automatically
4. Your task will be unblocked when they respond

### Answering Questions

When responding to a question:

1. Reference the original `message_id` in your response
2. Be **specific and actionable** - vague answers cause delays
3. Include code snippets, file paths, or diagrams when helpful

```
POST /api/agents/{asking-agent}/inbox/{message-id}/answer
{
  "content": "Your detailed answer here"
}
```

### Message Types

| Type | Use For |
|------|---------|
| `question` | Need input before you can proceed |
| `answer` | Response to a question |
| `handoff` | Passing work to another agent |
| `info` | FYI - no response needed |

## Task Handoff Protocol

### Workflow Dependencies

1. **Architecture First**: Architecture/design tasks should complete before implementation
2. **Security Review**: Hawk reviews security-sensitive changes before merge
3. **Code Review**: Reviewer approves all PRs before Jarvis merges

### Standard Task Flow

```
Jarvis creates task
        ↓
Architect designs (if needed)
        ↓
Backend/Frontend implements
        ↓
Reviewer reviews code
        ↓
Hawk reviews security (if applicable)
        ↓
Jarvis merges PR
```

### Creating Task Dependencies

When creating tasks that depend on each other:

1. Create the blocking task first (e.g., architecture design)
2. Create the dependent task second (e.g., implementation)
3. Add dependency:
   ```
   POST /api/tasks/{impl-id}/dependencies
   { "blocked_by_task_id": "{arch-id}" }
   ```
4. The dependent task won't be assigned until the blocker completes

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

## Context Sharing

### Project Context

Every agent should read before starting work on a project:
1. `projects/{project-id}/CONTEXT.md` - Current state and decisions
2. `projects/{project-id}/ACCESS.md` - Your permissions

### Updating Context

When you make significant decisions or discoveries:
```markdown
### {agent-id} - {DATE} - {Brief Title}

{Your update - decisions made, blockers resolved, patterns discovered}
```

Update the "Last updated by" header when modifying CONTEXT.md.

---

*"Alone we can do so little; together we can do so much." - But with clear protocols.*
