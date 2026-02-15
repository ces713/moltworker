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
  provider: 'anthropic' | 'openai' | 'xai' | 'moonshot' | 'cloudflare-ai-gateway' | 'openrouter' | 'minimax';
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
  max_iterations?: number;   // Multi-turn: max LLM turns per execution (default: 1 = single-shot)
}

/**
 * Output from a single turn in multi-turn execution
 */
export interface TurnOutput {
  turn: number;
  output: string;
  duration_ms: number;
  completed: boolean;
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
  turns_used?: number;          // Multi-turn: how many turns were executed
  turn_outputs?: TurnOutput[];  // Multi-turn: per-turn output details
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

    case 'openrouter':
      // OpenRouter uses OpenAI-compatible API
      envVars.OPENAI_API_KEY = credentials.api_key;
      envVars.OPENAI_BASE_URL = credentials.base_url || 'https://openrouter.ai/api/v1';
      break;

    case 'minimax':
      // MiniMax uses OpenAI-compatible API
      envVars.OPENAI_API_KEY = credentials.api_key;
      envVars.OPENAI_BASE_URL = credentials.base_url || 'https://api.minimaxi.chat/v1';
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
 * Multi-turn timeout constants
 */
const SINGLE_SHOT_TIMEOUT_MS = 300_000;    // 5 min legacy timeout for single-shot
const MULTI_TURN_TOTAL_BUDGET_MS = 270_000; // 4.5 min total budget for multi-turn
const MULTI_TURN_PER_TURN_CAP_MS = 180_000; // 3 min max per turn
const MULTI_TURN_MIN_REMAINING_MS = 60_000;  // 1 min minimum to start a new turn

/**
 * Error indicators for heuristic completion detection
 */
const ERROR_INDICATORS = [
  'error:',
  'failed',
  'todo:',
  'fixme',
  'not implemented',
  'incomplete',
  'missing',
  'broken',
];

/**
 * Check if a turn's output indicates task completion
 *
 * Priority order:
 * 1. [TASK_COMPLETE] marker → completed
 * 2. Exit code != 0 → not completed (failure)
 * 3. [NEEDS_REFINEMENT] marker → not completed
 * 4. No error indicators + output > 100 chars → completed (heuristic)
 * 5. Default → not completed
 */
function checkCompletion(output: string, exitCode: number): boolean {
  // 1. Explicit completion marker
  if (output.includes('[TASK_COMPLETE]')) {
    return true;
  }

  // 2. Process failure
  if (exitCode !== 0) {
    return false;
  }

  // 3. Explicit refinement request
  if (output.includes('[NEEDS_REFINEMENT]')) {
    return false;
  }

  // 4. Heuristic: clean output with sufficient length
  if (output.length > 100) {
    const lowerOutput = output.toLowerCase();
    const hasErrors = ERROR_INDICATORS.some(indicator => lowerOutput.includes(indicator));
    if (!hasErrors) {
      return true;
    }
  }

  // 5. Default: not completed
  return false;
}

/**
 * Execute a task via the MoltBot gateway
 * Supports multi-turn execution: each turn is a fresh `openclaw chat --once` invocation
 * whose prompt includes the previous turn's output for self-correction.
 */
export async function executeMissionTask(
  sandbox: Sandbox,
  env: MoltbotEnv,
  request: MissionExecuteRequest
): Promise<MissionExecuteResponse> {
  const startTime = Date.now();
  const maxIterations = request.max_iterations || 1;
  const isMultiTurn = maxIterations > 1;

  try {
    // Ensure gateway is running
    await ensureMoltbotGateway(sandbox, env);

    // Build environment with per-request credentials if provided
    let execEnv: Record<string, string> | undefined;
    if (request.api_credentials) {
      execEnv = buildCredentialEnvVars(request.api_credentials);
      console.log(`[mission] Using per-request credentials for provider: ${request.api_credentials.provider}`);
    }

    console.log(`[mission] Executing task ${request.task_id} for agent ${request.agent_id} (max_iterations: ${maxIterations})`);

    const turnOutputs: TurnOutput[] = [];
    let finalOutput = '';
    let finalSuccess = false;
    let lastStderr = '';

    for (let turn = 1; turn <= maxIterations; turn++) {
      const turnStart = Date.now();
      const elapsed = turnStart - startTime;

      // Calculate per-turn timeout
      let turnTimeout: number;
      if (!isMultiTurn) {
        // Single-shot: use legacy 300s timeout (backwards compat)
        turnTimeout = SINGLE_SHOT_TIMEOUT_MS;
      } else {
        const remaining = MULTI_TURN_TOTAL_BUDGET_MS - elapsed;
        if (remaining < MULTI_TURN_MIN_REMAINING_MS) {
          console.log(`[mission] Turn ${turn}: insufficient time remaining (${remaining}ms), stopping`);
          break;
        }
        turnTimeout = Math.min(remaining, MULTI_TURN_PER_TURN_CAP_MS);
      }

      // Build prompt
      const prompt = turn === 1
        ? buildFirstTurnPrompt(request, isMultiTurn)
        : buildFollowUpTurnPrompt(request, turn, finalOutput, turn === maxIterations);

      const escapedPrompt = prompt.replace(/'/g, "'\\''");

      // Build command with optional model override
      let command = `openclaw chat --once --url ws://localhost:18789`;
      if (request.model_override) {
        command += ` --model '${request.model_override}'`;
      }
      command += ` '${escapedPrompt}'`;

      if (isMultiTurn) {
        console.log(`[mission] Turn ${turn}/${maxIterations} (timeout: ${Math.round(turnTimeout / 1000)}s)`);
      }

      // Execute turn
      const proc = execEnv
        ? await sandbox.startProcess(command, { env: execEnv })
        : await sandbox.startProcess(command);

      await waitForProcess(proc, turnTimeout);

      const logs = await proc.getLogs();
      const stdout = logs.stdout || '';
      const stderr = logs.stderr || '';
      const exitCode = proc.exitCode ?? 1;
      const turnDuration = Date.now() - turnStart;

      // Track stderr for error reporting
      if (stderr) {
        lastStderr = stderr;
      }

      // Check completion
      const completed = checkCompletion(stdout, exitCode);

      turnOutputs.push({
        turn,
        output: stdout,
        duration_ms: turnDuration,
        completed,
      });

      finalOutput = stdout;

      if (exitCode !== 0 && turn === maxIterations) {
        // Final turn failed — report failure
        console.error(`[mission] Task ${request.task_id} failed on final turn ${turn}:`, stderr);
        finalSuccess = false;
        break;
      }

      if (completed) {
        console.log(`[mission] Task ${request.task_id} completed on turn ${turn} in ${turnDuration}ms`);
        finalSuccess = true;
        break;
      }

      if (turn === maxIterations) {
        // Exhausted all turns — use last output as best effort
        console.log(`[mission] Task ${request.task_id} exhausted ${maxIterations} turns, using last output`);
        finalSuccess = exitCode === 0;
        break;
      }

      // Not completed, will continue to next turn
      console.log(`[mission] Turn ${turn} not completed (exit=${exitCode}), continuing to turn ${turn + 1}`);
    }

    const duration_ms = Date.now() - startTime;
    const turnsUsed = turnOutputs.length;

    if (isMultiTurn) {
      console.log(`[mission] Task ${request.task_id} finished: ${turnsUsed} turns, ${duration_ms}ms total, success=${finalSuccess}`);
    }

    return {
      success: finalSuccess,
      output: finalOutput,
      duration_ms,
      turns_used: turnsUsed,
      turn_outputs: isMultiTurn ? turnOutputs : undefined,
      ...(finalSuccess ? {} : {
        error: lastStderr
          ? lastStderr.slice(0, 500)
          : (turnOutputs[turnOutputs.length - 1]?.output
            ? `Task not completed after ${turnsUsed} turn(s)`
            : 'No output produced'),
      }),
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
 * Detect if a task should receive action block format instructions.
 * Triggers on: [KICKOFF] prefix, planning keywords, or Jarvis with planning context.
 */
function detectActionBlockTask(request: MissionExecuteRequest): boolean {
  const subject = request.task_subject || '';
  const description = request.task_description || '';
  const text = `${subject} ${description}`.toLowerCase();

  // [KICKOFF] prefix — always a task generation task
  if (subject.startsWith('[KICKOFF]')) {
    return true;
  }

  // Planning keywords in subject/description
  const planningKeywords = ['create tasks', 'generate tasks', 'plan tasks', 'break down', 'task plan'];
  if (planningKeywords.some(kw => text.includes(kw))) {
    return true;
  }

  // Jarvis with action block references already in description
  if (request.agent_id === 'jarvis' && text.includes('action block')) {
    return true;
  }

  return false;
}

/**
 * Build the first turn prompt with full agent context
 * For single-shot (max_iterations == 1): identical to legacy prompt (no markers)
 * For multi-turn: includes completion markers in instructions
 */
function buildFirstTurnPrompt(request: MissionExecuteRequest, isMultiTurn: boolean): string {
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

  // Detect if this task needs action block instructions
  const needsActionBlocks = detectActionBlockTask(request);
  if (needsActionBlocks) {
    sections.push(`# Action Block Format

You can create tasks and dependencies by emitting structured JSONL between markers.
Mission Control will parse and execute these on your behalf.

\`\`\`
[ACTIONS_BEGIN]
{"action":"create_task","ref":"T1","subject":"Task title","description":"Detailed description","priority":8,"assign_to":"architect"}
{"action":"create_task","ref":"T2","subject":"Another task","description":"...","priority":7,"assign_to":"backend"}
{"action":"add_dependency","task_ref":"T2","blocked_by_ref":"T1"}
[ACTIONS_END]
\`\`\`

**Rules:**
- One JSON object per line (JSONL format)
- \`ref\` is a label you assign (T1, T2, etc.) — used to wire up dependencies
- \`assign_to\` must be one of: jarvis, architect, backend, frontend, reviewer, hawk
- \`priority\` range: 1 (lowest) to 10 (highest)
- Maximum 20 actions per block
- Always include the action block BEFORE your \`[TASK_COMPLETE]\` marker`);
  }

  // Instructions — multi-turn includes completion markers
  if (isMultiTurn) {
    sections.push(`# Instructions

You are executing this task as part of the Lifebot project.

1. Read the task description carefully
2. Implement the required functionality
3. Ensure the code works and handles basic errors
4. Report what you've created or accomplished

**When you are done**, end your response with \`[TASK_COMPLETE]\`.
**If you need another pass** to refine or fix issues, end with \`[NEEDS_REFINEMENT]\`.

Begin the task now.`);
  } else {
    sections.push(`# Instructions

You are executing this task as part of the Lifebot project.

1. Read the task description carefully
2. Implement the required functionality
3. Ensure the code works and handles basic errors
4. Report what you've created or accomplished

Begin the task now.`);
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Build a follow-up turn prompt with abbreviated context
 * Includes previous output for self-correction
 */
function buildFollowUpTurnPrompt(
  request: MissionExecuteRequest,
  turn: number,
  previousOutput: string,
  isFinalTurn: boolean
): string {
  const sections: string[] = [];

  // Brief agent identity reminder
  sections.push(`# Agent: ${request.agent_id} (Turn ${turn})`);

  // Previous turn's output (truncate if too long)
  const maxPreviousLength = 8000;
  const truncatedOutput = previousOutput.length > maxPreviousLength
    ? `...(truncated)...\n${previousOutput.slice(-maxPreviousLength)}`
    : previousOutput;

  sections.push(`# Previous Turn Output

${truncatedOutput}`);

  // Task reminder (just ID + subject)
  sections.push(`# Task Reminder

**Task ID:** ${request.task_id}
**Subject:** ${request.task_subject}`);

  // Instructions
  const finalTurnNote = isFinalTurn
    ? '\n\n**This is your final turn.** Provide your best output now.'
    : '';

  sections.push(`# Instructions

Review your previous output above. Look for:
- Errors, incomplete sections, or missing details
- Improvements to make the output more complete and correct
- Any issues flagged in the previous output

Refine your work and provide the improved, complete output.

**When you are done**, end your response with \`[TASK_COMPLETE]\`.
**If you still need another pass**, end with \`[NEEDS_REFINEMENT]\`.${finalTurnNote}`);

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

  const validProviders = ['anthropic', 'openai', 'xai', 'moonshot', 'cloudflare-ai-gateway', 'openrouter', 'minimax'];
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
      max_iterations: typeof req.max_iterations === 'number'
        ? Math.max(1, Math.min(Math.floor(req.max_iterations), 5))
        : undefined,
    },
  };
}
