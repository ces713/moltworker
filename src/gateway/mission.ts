/**
 * Mission Execution Module
 *
 * Handles task execution requests from Mission Control.
 * Executes tasks with agent context (soul files) via the MoltBot gateway.
 */

import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { ensureMoltbotGateway, waitForProcess } from './index';

/**
 * Mission execution request from Mission Control
 */
export interface MissionExecuteRequest {
  agent_id: string;
  task_id: string;
  task_subject: string;
  task_description: string;
  soul_content: string;
}

/**
 * Mission execution response
 */
export interface MissionExecuteResponse {
  success: boolean;
  output?: string;
  artifact_path?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Execute a task via the MoltBot gateway
 *
 * This injects the agent's soul content as system context and
 * sends the task as a user prompt to the gateway.
 */
export async function executeMissionTask(
  sandbox: Sandbox,
  env: MoltbotEnv,
  request: MissionExecuteRequest
): Promise<MissionExecuteResponse> {
  const startTime = Date.now();

  try {
    // Ensure gateway is running
    await ensureMoltbotGateway(sandbox, env);

    // Build the prompt with task context
    const prompt = buildTaskPrompt(request);

    // Execute via clawdbot CLI (non-interactive mode)
    // The CLI will use the configured API keys from the environment
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `clawdbot chat --once --url ws://localhost:18789 '${escapedPrompt}'`;

    console.log(`[mission] Executing task ${request.task_id} for agent ${request.agent_id}`);

    const proc = await sandbox.startProcess(command);

    // Wait for completion with 5 minute timeout (tasks can be complex)
    await waitForProcess(proc, 300000);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    const duration_ms = Date.now() - startTime;

    if (proc.exitCode !== 0) {
      console.error(`[mission] Task ${request.task_id} failed:`, stderr);
      return {
        success: false,
        error: `Process exited with code ${proc.exitCode}: ${stderr}`,
        duration_ms,
      };
    }

    console.log(`[mission] Task ${request.task_id} completed in ${duration_ms}ms`);

    return {
      success: true,
      output: stdout,
      duration_ms,
    };
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[mission] Task execution error:`, error);

    return {
      success: false,
      error: errorMessage,
      duration_ms,
    };
  }
}

/**
 * Build the task prompt with agent context
 */
function buildTaskPrompt(request: MissionExecuteRequest): string {
  return `# Agent Context

${request.soul_content}

---

# Current Task

**Task ID:** ${request.task_id}
**Subject:** ${request.task_subject}

## Description

${request.task_description || 'No additional description provided.'}

---

# Instructions

You are executing this task as part of the Lifebot PoC development.

1. Read the task description carefully
2. Implement the required functionality
3. Ensure the code works and handles basic errors
4. Report what you've created or accomplished

Remember: This is a PoC - focus on working functionality over perfection.

Begin the task now.`;
}

/**
 * Validate a mission execution request
 */
export function validateMissionRequest(
  body: unknown
): { valid: true; request: MissionExecuteRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const req = body as Record<string, unknown>;

  if (typeof req.agent_id !== 'string' || !req.agent_id) {
    return { valid: false, error: 'agent_id is required and must be a string' };
  }

  if (typeof req.task_id !== 'string' || !req.task_id) {
    return { valid: false, error: 'task_id is required and must be a string' };
  }

  if (typeof req.task_subject !== 'string' || !req.task_subject) {
    return { valid: false, error: 'task_subject is required and must be a string' };
  }

  if (typeof req.task_description !== 'string') {
    return { valid: false, error: 'task_description must be a string' };
  }

  if (typeof req.soul_content !== 'string' || !req.soul_content) {
    return { valid: false, error: 'soul_content is required and must be a string' };
  }

  return {
    valid: true,
    request: {
      agent_id: req.agent_id,
      task_id: req.task_id,
      task_subject: req.task_subject,
      task_description: req.task_description,
      soul_content: req.soul_content,
    },
  };
}
