# Heartbeat Checklist

This file defines what the heartbeat agent should check on each cycle. Keep prompts minimal to reduce token usage.

## Mission

> Build a working Lifebot PoC - Chrome extension + backend demo

## Heartbeat Actions

On each heartbeat, perform these checks in order:

### 1. Check Task Board Status

```
Query: GET /api/tasks/board
```

Review:
- [ ] Any tasks stuck in `claimed` > 30 min? → Release to backlog
- [ ] Any tasks in `review` without reviewer? → Assign reviewer
- [ ] Any tasks in `backlog`? → Assign to available agent

### 2. Check Agent Availability

```
Query: GET /api/agents
```

Review:
- [ ] Any idle agents with tasks in backlog? → Trigger assignment
- [ ] Any agents stuck in `working` > 2 hours? → Log warning
- [ ] All agents healthy (recent heartbeat)? → Alert if not

### 3. Mission Alignment Check

If generating new tasks, ensure they map to PoC requirements:

**Chrome Extension (Frontend)**
- [ ] Manifest V3 setup
- [ ] WhatsApp message interception
- [ ] Popup UI for displaying messages
- [ ] Backend API communication

**Backend API (Backend)**
- [ ] FastAPI server skeleton
- [ ] Message storage endpoint
- [ ] Priority scoring service
- [ ] Health check endpoint

**Integration**
- [ ] Extension → Backend message flow
- [ ] End-to-end demo working

### 4. Log Activity

Record heartbeat completion:
```
POST /api/agents/jarvis/heartbeat
```

## Heartbeat Response Format

```json
{
  "timestamp": "ISO8601",
  "actions_taken": [
    "Released stale task task-xxx",
    "Assigned task-yyy to backend agent",
    "No tasks need review assignment"
  ],
  "mission_status": {
    "tasks_completed": 2,
    "tasks_in_progress": 1,
    "tasks_remaining": 5
  },
  "next_priority": "task-zzz: Implement message interception"
}
```

## Minimal Prompt Template

For cost-efficient heartbeat (using cheaper model like Kimi K2.5):

```
You are Jarvis, mission controller for Lifebot PoC.

Current state:
- Backlog tasks: {count}
- In-progress tasks: {count}
- Agents idle: {list}

Actions needed:
1. If backlog > 0 and idle agents, assign next task
2. If tasks stuck > 30min, release them
3. Report status

Respond with JSON: {"actions": [...], "status": "ok/warning/blocked"}
```

---

*Keep heartbeats light. Save tokens for real work.*
