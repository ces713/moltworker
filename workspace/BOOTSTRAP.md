# Bootstrap Protocol

**Execute this protocol on every startup or when context is unclear.**

## Step 1: Establish Identity

Read these files to understand who you are:
1. `IDENTITY.md` - Your core identity and role
2. `souls/{your-agent-id}.md` - Your personality and approach

## Step 2: Load Project Context

**IMPORTANT: Context isolation is mandatory. Only load context for projects you're working on.**

### 2a. Check Project Registry
Read `PROJECTS.md` to see all active projects.

### 2b. For Each Assigned Project:

1. **Check Access**
   - Read `projects/{project-id}/ACCESS.md`
   - Verify you have access (read or write)
   - If denied, skip this project

2. **Load Context**
   - Read `projects/{project-id}/CONTEXT.md`
   - This is your primary context source
   - Note "Last updated by" to see who touched it last

3. **Check Research (as needed)**
   - Browse `projects/{project-id}/research/`
   - Read documents relevant to your current task

### 2c. Context Update Protocol

When you learn something significant, update CONTEXT.md:
1. Add a new section with your agent ID and date
2. Update "Last updated by" header
3. Keep updates concise and actionable
4. Do NOT duplicate entire documents - reference them

Example:
```markdown
**Last updated by:** backend
**Updated:** 2026-02-08

### backend - 2026-02-08 - API Structure Decision
Decided to use FastAPI with Pydantic models for type safety.
See tech-spec in research/tech-specs/api-design.md
```

## Step 3: Check Mission Control

Query Mission Control API for current state:
```
GET https://mission-control.micah-ee7.workers.dev/api/status
GET https://mission-control.micah-ee7.workers.dev/api/tasks?status=backlog
GET https://mission-control.micah-ee7.workers.dev/api/agents
```

## Step 4: Determine Action

Based on current state, take ONE of these actions:

### If tasks are in backlog:
1. Review the highest priority unassigned task
2. Determine which agent should handle it
3. Assign the task via Mission Control API

### If agents are idle with no tasks:
1. Review project CONTEXT.md for current state
2. Identify the next logical task to create
3. Create task in Mission Control

### If waiting for reviews:
1. Check pending reviews
2. Assign reviewer if not assigned
3. Follow up on stale reviews

### If all tasks complete:
1. Update project CONTEXT.md with completion status
2. Report summary to user
3. Ask for next project priorities

## Step 5: Execute

Once you've determined the action:
1. Log your decision to activity feed
2. Execute the action
3. **Update CONTEXT.md** with any learnings

## Context File Guidelines

### DO:
- Keep CONTEXT.md concise and current
- Reference research documents instead of duplicating
- Add timestamps to all updates
- Include your agent ID

### DON'T:
- Copy entire documents into CONTEXT.md
- Mix context from different projects
- Delete other agents' notes without reason
- Leave stale information unmarked

## Heartbeat Checks

Every 5 minutes, the cron trigger runs. During heartbeat:
1. Check for stale claims (>30 min)
2. Reassign stuck tasks
3. Update agent heartbeat timestamps
4. Send notifications for important events

## Emergency Protocols

### If Mission Control is unreachable:
- Continue with last known state from CONTEXT.md
- Log the connectivity issue
- Retry every 5 minutes

### If agent execution fails 3 times:
- Escalate to Jarvis for investigation
- Create investigation task
- Notify via Telegram

## Quick Reference

| API Endpoint | Purpose |
|--------------|---------|
| `GET /api/status` | Overall system status |
| `GET /api/tasks` | List all tasks |
| `POST /api/tasks` | Create new task |
| `PATCH /api/tasks/:id` | Update task |
| `GET /api/agents` | List all agents |
| `POST /api/heartbeat` | Trigger manual heartbeat |

| Context File | Purpose |
|--------------|---------|
| `projects/{id}/ACCESS.md` | Who can access this project |
| `projects/{id}/CONTEXT.md` | Working context (update this!) |
| `projects/{id}/research/` | Supporting documents |
