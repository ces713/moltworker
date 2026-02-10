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
 * API credentials for per-request authentication
 * Allows Mission Control to pass API keys for each execution
 */
export interface ApiCredentials {
  provider: 'anthropic' | 'openai' | 'xai' | 'moonshot' | 'cloudflare-ai-gateway';
  api_key: string;
  base_url?: string;  // For custom endpoints or AI Gateway
}

/**
 * Mission execution request from Mission Control
 */
export interface MissionExecuteRequest {
  agent_id: string;
  task_id: string;
  task_subject: string;
  task_description: string;
  soul_content: string;
  model_override?: string;  // e.g., "xai/grok-4-1" or "anthropic/claude-sonnet-4-5"
  team_context?: string;     // TEAM.md content
  methodology_context?: string;  // Methodology YAML
  agent_memory?: string;     // Agent's persistent memory
  project_memory?: string;   // Project-specific learnings
  project_communications?: string;  // COMMS.md
  project_document_index?: string;  // INDEX.md
  api_credentials?: ApiCredentials;  // Per-request API credentials from Mission Control
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
 * Build environment variables for per-request API credentials
 * These override the container's default environment for this specific execution
 */
function buildCredentialEnvVars(credentials: ApiCredentials): Record<string, string> {
  const envVars: Record<string, string> = {};

  switch (credentials.provider) {
    case 'anthropic':
      envVars.ANTHROPIC_API_KEY = credentials.api_key;
      if (credentials.base_url) {
        envVars.ANTHROPIC_BASE_URL = credentials.base_url;
      }
      break;

    case 'openai':
      envVars.OPENAI_API_KEY = credentials.api_key;
      if (credentials.base_url) {
        envVars.OPENAI_BASE_URL = credentials.base_url;
      }
      break;

    case 'xai':
      // xAI uses OpenAI-compatible API
      envVars.OPENAI_API_KEY = credentials.api_key;
      envVars.OPENAI_BASE_URL = credentials.base_url || 'https://api.x.ai/v1';
      break;

    case 'moonshot':
      envVars.MOONSHOT_API_KEY = credentials.api_key;
      if (credentials.base_url) {
        envVars.MOONSHOT_BASE_URL = credentials.base_url;
      }
      break;

    case 'cloudflare-ai-gateway':
      envVars.CLOUDFLARE_AI_GATEWAY_API_KEY = credentials.api_key;
      if (credentials.base_url) {
        // Parse account/gateway IDs from base_url if provided
        // Format: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}
        const match = credentials.base_url.match(/\/v1\/([^/]+)\/([^/]+)/);
        if (match) {
          envVars.CF_AI_GATEWAY_ACCOUNT_ID = match[1];
          envVars.CF_AI_GATEWAY_GATEWAY_ID = match[2];
        }
      }
      break;
  }

  return envVars;
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

    // Execute via openclaw CLI (non-interactive mode)
    // The CLI will use the configured API keys from the environment
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    // Build command with optional model override
    let command = `openclaw chat --once --url ws://localhost:18789`;
    if (request.model_override) {
      // Model format: provider/model-id (e.g., xai/grok-4-1)
      command += ` --model '${request.model_override}'`;
    }
    command += ` '${escapedPrompt}'`;

    console.log(`[mission] Executing task ${request.task_id} for agent ${request.agent_id}`);

    // Build environment with per-request credentials if provided
    let execEnv: Record<string, string> | undefined;
    if (request.api_credentials) {
      execEnv = buildCredentialEnvVars(request.api_credentials);
      console.log(`[mission] Using per-request credentials for provider: ${request.api_credentials.provider}`);
    }

    // Start process with optional environment override
    const proc = execEnv
      ? await sandbox.startProcess(command, { env: execEnv })
      : await sandbox.startProcess(command);

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
  const sections: string[] = [];

  // Agent soul/personality
  sections.push(`# Agent Context\n\n${request.soul_content}`);

  // Team context (TEAM.md) if provided
  if (request.team_context) {
    sections.push(`# Team Information\n\n${request.team_context}`);
  }

  // Agent memory if provided
  if (request.agent_memory) {
    sections.push(`# Your Memory (Learnings from previous tasks)\n\n${request.agent_memory}`);
  }

  // Project memory if provided
  if (request.project_memory) {
    sections.push(`# Project Memory\n\n${request.project_memory}`);
  }

  // Project communications if provided
  if (request.project_communications) {
    sections.push(`# Project Communications Log\n\n${request.project_communications}`);
  }

  // Project document index if provided
  if (request.project_document_index) {
    sections.push(`# Available Project Documents\n\n${request.project_document_index}`);
  }

  // Methodology context for orchestrators
  if (request.methodology_context) {
    sections.push(`# Methodology\n\n${request.methodology_context}`);
  }

  // Task details
  sections.push(`# Current Task

**Task ID:** ${request.task_id}
**Subject:** ${request.task_subject}

## Description

${request.task_description || 'No additional description provided.'}`);

  // Instructions
  sections.push(`# Instructions

You are executing this task as part of the Lifebot project.

1. Read the task description carefully
2. Implement the required functionality
3. Ensure the code works and handles basic errors
4. Report what you've created or accomplished

Begin the task now.`);

  return sections.join('\n\n---\n\n');
}

/**
 * Validate API credentials object
 */
function validateApiCredentials(creds: unknown): ApiCredentials | undefined {
  if (!creds || typeof creds !== 'object') {
    return undefined;
  }

  const c = creds as Record<string, unknown>;

  const validProviders = ['anthropic', 'openai', 'xai', 'moonshot', 'cloudflare-ai-gateway'];
  if (typeof c.provider !== 'string' || !validProviders.includes(c.provider)) {
    return undefined;
  }

  if (typeof c.api_key !== 'string' || !c.api_key) {
    return undefined;
  }

  return {
    provider: c.provider as ApiCredentials['provider'],
    api_key: c.api_key,
    base_url: typeof c.base_url === 'string' ? c.base_url : undefined,
  };
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
      // Optional fields
      model_override: typeof req.model_override === 'string' ? req.model_override : undefined,
      team_context: typeof req.team_context === 'string' ? req.team_context : undefined,
      methodology_context: typeof req.methodology_context === 'string' ? req.methodology_context : undefined,
      agent_memory: typeof req.agent_memory === 'string' ? req.agent_memory : undefined,
      project_memory: typeof req.project_memory === 'string' ? req.project_memory : undefined,
      project_communications: typeof req.project_communications === 'string' ? req.project_communications : undefined,
      project_document_index: typeof req.project_document_index === 'string' ? req.project_document_index : undefined,
      api_credentials: validateApiCredentials(req.api_credentials),
    },
  };
}
