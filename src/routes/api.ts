import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import {
  ensureMoltbotGateway,
  findExistingMoltbotProcess,
  mountR2Storage,
  syncToR2,
  waitForProcess,
} from '../gateway';
import { executeMissionTask, validateMissionRequest } from '../gateway/mission';
import { R2_MOUNT_PATH } from '../config';

// CLI commands can take 10-15 seconds to complete due to WebSocket connection overhead
const CLI_TIMEOUT_MS = 20000;

/**
 * API routes
 * - /api/admin/* - Protected admin API routes (Cloudflare Access required)
 *
 * Note: /api/status is now handled by publicRoutes (no auth required)
 */
const api = new Hono<AppEnv>();

/**
 * Admin API routes - all protected by Cloudflare Access
 */
const adminApi = new Hono<AppEnv>();

// Middleware: Verify Cloudflare Access JWT for all admin routes
adminApi.use('*', createAccessMiddleware({ type: 'json' }));

// GET /api/admin/devices - List pending and paired devices
adminApi.get('/devices', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run OpenClaw CLI to list devices
    // Must specify --url and --token (OpenClaw v2026.2.3 requires explicit credentials with --url)
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const proc = await sandbox.startProcess(
      `openclaw devices list --json --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Try to parse JSON output
    try {
      // Find JSON in output (may have other log lines)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return c.json(data);
      }

      // If no JSON found, return raw output for debugging
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
      });
    } catch {
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
        parseError: 'Failed to parse CLI output',
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/:requestId/approve - Approve a pending device
adminApi.post('/devices/:requestId/approve', async (c) => {
  const sandbox = c.get('sandbox');
  const requestId = c.req.param('requestId');

  if (!requestId) {
    return c.json({ error: 'requestId is required' }, 400);
  }

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run OpenClaw CLI to approve the device
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const proc = await sandbox.startProcess(
      `openclaw devices approve ${requestId} --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Check for success indicators (case-insensitive, CLI outputs "Approved ...")
    const success = stdout.toLowerCase().includes('approved') || proc.exitCode === 0;

    return c.json({
      success,
      requestId,
      message: success ? 'Device approved' : 'Approval may have failed',
      stdout,
      stderr,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/approve-all - Approve all pending devices
adminApi.post('/devices/approve-all', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // First, get the list of pending devices
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const listProc = await sandbox.startProcess(
      `openclaw devices list --json --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(listProc, CLI_TIMEOUT_MS);

    const listLogs = await listProc.getLogs();
    const stdout = listLogs.stdout || '';

    // Parse pending devices
    let pending: Array<{ requestId: string }> = [];
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        pending = data.pending || [];
      }
    } catch {
      return c.json({ error: 'Failed to parse device list', raw: stdout }, 500);
    }

    if (pending.length === 0) {
      return c.json({ approved: [], message: 'No pending devices to approve' });
    }

    // Approve each pending device
    const results: Array<{ requestId: string; success: boolean; error?: string }> = [];

    for (const device of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential device approval required
        const approveProc = await sandbox.startProcess(
          `openclaw devices approve ${device.requestId} --url ws://localhost:18789${tokenArg}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await waitForProcess(approveProc, CLI_TIMEOUT_MS);

        // eslint-disable-next-line no-await-in-loop
        const approveLogs = await approveProc.getLogs();
        const success =
          approveLogs.stdout?.toLowerCase().includes('approved') || approveProc.exitCode === 0;

        results.push({ requestId: device.requestId, success });
      } catch (err) {
        results.push({
          requestId: device.requestId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const approvedCount = results.filter((r) => r.success).length;
    return c.json({
      approved: results.filter((r) => r.success).map((r) => r.requestId),
      failed: results.filter((r) => !r.success),
      message: `Approved ${approvedCount} of ${pending.length} device(s)`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/storage - Get R2 storage status and last sync time
adminApi.get('/storage', async (c) => {
  const sandbox = c.get('sandbox');
  const hasCredentials = !!(
    c.env.R2_ACCESS_KEY_ID &&
    c.env.R2_SECRET_ACCESS_KEY &&
    c.env.CF_ACCOUNT_ID
  );

  // Check which credentials are missing
  const missing: string[] = [];
  if (!c.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!c.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!c.env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID');

  let lastSync: string | null = null;

  // If R2 is configured, check for last sync timestamp
  if (hasCredentials) {
    try {
      // Mount R2 if not already mounted
      await mountR2Storage(sandbox, c.env);

      // Check for sync marker file
      const proc = await sandbox.startProcess(
        `cat ${R2_MOUNT_PATH}/.last-sync 2>/dev/null || echo ""`,
      );
      await waitForProcess(proc, 5000);
      const logs = await proc.getLogs();
      const timestamp = logs.stdout?.trim();
      if (timestamp && timestamp !== '') {
        lastSync = timestamp;
      }
    } catch {
      // Ignore errors checking sync status
    }
  }

  return c.json({
    configured: hasCredentials,
    missing: missing.length > 0 ? missing : undefined,
    lastSync,
    message: hasCredentials
      ? 'R2 storage is configured. Your data will persist across container restarts.'
      : 'R2 storage is not configured. Paired devices and conversations will be lost when the container restarts.',
  });
});

// POST /api/admin/storage/sync - Trigger a manual sync to R2
adminApi.post('/storage/sync', async (c) => {
  const sandbox = c.get('sandbox');

  const result = await syncToR2(sandbox, c.env);

  if (result.success) {
    return c.json({
      success: true,
      message: 'Sync completed successfully',
      lastSync: result.lastSync,
    });
  } else {
    const status = result.error?.includes('not configured') ? 400 : 500;
    return c.json(
      {
        success: false,
        error: result.error,
        details: result.details,
      },
      status,
    );
  }
});

// POST /api/admin/gateway/restart - Kill the current gateway and start a new one
adminApi.post('/gateway/restart', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Find and kill the existing gateway process
    const existingProcess = await findExistingMoltbotProcess(sandbox);

    if (existingProcess) {
      console.log('Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('Error killing process:', killErr);
      }
      // Wait a moment for the process to die
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Start a new gateway in the background
    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('Gateway restart failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      success: true,
      message: existingProcess
        ? 'Gateway process killed, new instance starting...'
        : 'No existing process found, starting new instance...',
      previousProcessId: existingProcess?.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// Mount admin API routes under /admin
api.route('/admin', adminApi);

// =============================================================================
// MISSION CONTROL ROUTES
// =============================================================================

/**
 * Mission API routes - protected by Cloudflare Access
 * Used by Mission Control to execute tasks via this MoltWorker
 */
const missionApi = new Hono<AppEnv>();

// Middleware: Verify Cloudflare Access JWT for mission routes
missionApi.use('*', createAccessMiddleware({ type: 'json' }));

/**
 * POST /api/mission/execute - Execute a task for Mission Control
 *
 * This endpoint receives a task from Mission Control and executes it
 * using the agent's soul content as context.
 */
missionApi.post('/execute', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const body = await c.req.json();
    const validation = validateMissionRequest(body);

    if (!validation.valid) {
      return c.json({ success: false, error: validation.error }, 400);
    }

    console.log(`[mission] Received task ${validation.request.task_id} for agent ${validation.request.agent_id}`);

    const result = await executeMissionTask(sandbox, c.env, validation.request);

    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mission] Execute error:', error);
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

/**
 * GET /api/mission/status - Get MoltWorker status for Mission Control
 */
missionApi.get('/status', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const existingProcess = await findExistingMoltbotProcess(sandbox);

    return c.json({
      gateway_running: existingProcess !== null && existingProcess.status === 'running',
      gateway_process_id: existingProcess?.id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /api/mission/agents - List available openclaw agents
 * Used by Mission Control to check which models have configured agents
 */
missionApi.get('/agents', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure gateway is running
    await ensureMoltbotGateway(sandbox, c.env);

    // Read the openclaw config to get agent list
    const proc = await sandbox.startProcess('cat /root/.openclaw/openclaw.json');
    await waitForProcess(proc, 5000);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '{}';

    try {
      const config = JSON.parse(stdout);
      const agents = (config.agents?.list || []).map((a: { id: string; model: string | { primary: string } }) => ({
        id: a.id,
        model: typeof a.model === 'object' ? a.model.primary : a.model,
      }));
      return c.json({ agents });
    } catch {
      return c.json({ agents: [], error: 'Failed to parse agent config' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mission] Failed to read agents:', errorMessage);
    return c.json({ agents: [], error: 'Failed to read agent config' });
  }
});

// Mount mission API routes under /mission
api.route('/mission', missionApi);

// =============================================================================
// ADMIN SYNC ROUTES
// =============================================================================

/**
 * POST /api/admin/sync-models - Sync models from Mission Control
 * Accepts a model list, patches openclaw config, and restarts gateway
 */
adminApi.post('/sync-models', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    const { models } = await c.req.json<{
      models: Array<{ id: string; provider_name: string }>;
    }>();

    if (!models || !Array.isArray(models)) {
      return c.json({ error: 'models array is required' }, 400);
    }

    // Ensure gateway is running so config exists
    await ensureMoltbotGateway(sandbox, c.env);

    // 1. Read current config
    const readProc = await sandbox.startProcess('cat /root/.openclaw/openclaw.json');
    await waitForProcess(readProc, 5000);
    const readLogs = await readProc.getLogs();
    const config = JSON.parse(readLogs.stdout || '{}');

    // 2. Add new models to provider + create agents
    for (const model of models) {
      const providerName = model.provider_name;
      const provider = config.models?.providers?.[providerName];
      if (!provider) continue;

      // Add model to provider if not exists
      provider.models = provider.models || [];
      const existingIds = new Set(provider.models.map((m: { id: string }) => m.id));
      if (!existingIds.has(model.id)) {
        provider.models.push({ id: model.id, name: model.id, contextWindow: 131072, maxTokens: 8192 });
      }

      // Add agent if not exists
      config.agents = config.agents || { list: [] };
      config.agents.list = config.agents.list || [];
      const existingAgentIds = new Set(config.agents.list.map((a: { id: string }) => a.id));
      if (!existingAgentIds.has(model.id)) {
        config.agents.list.push({
          id: model.id,
          model: { primary: providerName + '/' + model.id },
          workspace: '/root/clawd',
        });
      }
    }

    // 3. Write config back — use a temp file to avoid quoting issues
    const configJson = JSON.stringify(config, null, 2);
    // Write via node for safe escaping
    const writeScript = `node -e "require('fs').writeFileSync('/root/.openclaw/openclaw.json', ${JSON.stringify(configJson)})"`;
    const writeProc = await sandbox.startProcess(writeScript);
    await waitForProcess(writeProc, 5000);

    // 4. Restart gateway (kill process, ensureMoltbotGateway will restart on next request)
    try {
      const killProc = await sandbox.startProcess('pkill -f "openclaw gateway" || true');
      await waitForProcess(killProc, 5000);
    } catch {
      // Process may not exist, that's fine
    }

    // 5. Return new agent list
    const agents = (config.agents?.list || []).map((a: { id: string; model: string | { primary: string } }) => ({
      id: a.id,
      model: typeof a.model === 'object' ? a.model.primary : a.model,
    }));

    return c.json({ success: true, agents });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[admin] sync-models error:', errorMessage);
    return c.json({ error: errorMessage }, 500);
  }
});

export { api };
