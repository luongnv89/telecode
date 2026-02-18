import type { CodingAdapter, AdapterOutputChunk, AdapterResult, AdapterSessionInfo } from '../types.js';
import type { SessionState } from '../../types/session.js';
import { parseOpencodeEvent } from './event-parser.js';

export interface OpencodeAdapterConfig {
  baseUrl?: string;
  model?: string;
  cwd?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:4096';

export function createOpencodeAdapter(config: OpencodeAdapterConfig): CodingAdapter {
  let backendSessionId: string | undefined;
  let state: SessionState = 'idle';
  let client: any = null;
  let server: { url: string; close(): void } | null = null;

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  async function ensureClient(): Promise<any> {
    if (client) return client;

    // Try to connect to an already-running server
    try {
      const { createOpencodeClient } = await import('@opencode-ai/sdk/client');
      const c = createOpencodeClient({
        baseUrl,
        ...(config.cwd ? { directory: config.cwd } : {}),
      });
      // Verify connectivity with a lightweight call
      await c.session.list({
        ...(config.cwd ? { query: { directory: config.cwd } } : {}),
      });
      client = c;
      return client;
    } catch {
      // Server not reachable — try to spawn one via the full SDK
      try {
        const { createOpencode } = await import('@opencode-ai/sdk');
        const result = await createOpencode({
          hostname: '127.0.0.1',
          timeout: 10_000,
        });
        client = result.client;
        server = result.server;
        return client;
      } catch (err) {
        throw new Error(
          `OpenCode server not reachable at ${baseUrl} and could not start one. ` +
          `Ensure 'opencode' is installed and the server is running. Error: ${err}`,
        );
      }
    }
  }

  return {
    backendType: 'opencode' as const,

    async startSession(): Promise<{ backendSessionId: string }> {
      state = 'starting';

      const c = await ensureClient();

      const response = await c.session.create({
        body: { title: config.cwd ? `telecode: ${config.cwd}` : 'telecode session' },
        ...(config.cwd ? { query: { directory: config.cwd } } : {}),
      });

      // The response format depends on responseStyle. Default "fields" returns { data, error }.
      const sessionData = response.data ?? response;
      const id = sessionData?.id;
      if (!id) {
        state = 'idle';
        throw new Error('OpenCode: failed to create session — no session ID received');
      }

      backendSessionId = id;
      state = 'active';
      return { backendSessionId: id };
    },

    async attachSession(targetId: string): Promise<{ backendSessionId: string }> {
      // OpenCode sessions persist on the server — just store the ID
      await ensureClient();
      backendSessionId = targetId;
      state = 'active';
      return { backendSessionId: targetId };
    },

    async sendPrompt(
      _sessionId: string,
      prompt: string,
      onChunk?: (chunk: AdapterOutputChunk) => void,
    ): Promise<AdapterResult> {
      if (!backendSessionId) {
        throw new Error('No active OpenCode session. Call startSession() first.');
      }

      state = 'busy';
      const startTime = Date.now();
      const c = await ensureClient();

      let finalText = '';
      let totalCost = 0;

      const modelSpec = config.model ? parseModelSpec(config.model) : undefined;

      try {
        // Subscribe to events BEFORE sending prompt for streaming
        let eventStreamDone = false;
        const eventPromise = (async () => {
          try {
            const events = await c.event.subscribe({
              ...(config.cwd ? { query: { directory: config.cwd } } : {}),
            });
            if (!events?.stream) return;

            for await (const event of events.stream) {
              const parsed = parseOpencodeEvent(event);
              if (!parsed) continue;

              if (parsed.type === 'chunk' && parsed.chunk && onChunk) {
                onChunk(parsed.chunk);
                if (parsed.chunk.type === 'text') {
                  finalText += parsed.chunk.content;
                }
              }

              if (parsed.type === 'done') {
                if (parsed.cost) totalCost = parsed.cost;
                if (parsed.finalText) finalText = parsed.finalText;
                eventStreamDone = true;
                break;
              }
            }
          } catch {
            // SSE stream errors are non-fatal
          }
        })();

        // Send prompt asynchronously (returns 204 immediately)
        await c.session.promptAsync({
          path: { id: backendSessionId },
          body: {
            parts: [{ type: 'text', text: prompt }],
            ...(modelSpec ? { model: modelSpec } : {}),
          },
          ...(config.cwd ? { query: { directory: config.cwd } } : {}),
        });

        // Wait for event stream to indicate completion, with a timeout
        await Promise.race([
          eventPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 300_000)), // 5 min max
        ]);

        // If streaming didn't capture text (e.g. SSE failed), fall back to sync prompt
        if (!eventStreamDone && !finalText) {
          try {
            const result = await c.session.prompt({
              path: { id: backendSessionId },
              body: {
                parts: [{ type: 'text', text: prompt }],
                ...(modelSpec ? { model: modelSpec } : {}),
              },
              ...(config.cwd ? { query: { directory: config.cwd } } : {}),
            });

            const data = result.data ?? result;
            if (data?.parts) {
              finalText = data.parts
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text ?? '')
                .join('');
            }
            if (data?.info?.cost) totalCost = data.info.cost;
          } catch (syncErr) {
            state = 'active';
            return {
              success: false,
              text: `OpenCode error: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
              durationMs: Date.now() - startTime,
              totalCostUsd: 0,
              numTurns: 0,
              errors: [String(syncErr)],
            };
          }
        }
      } catch (err) {
        state = 'active';
        return {
          success: false,
          text: `OpenCode error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
          totalCostUsd: 0,
          numTurns: 0,
          errors: [String(err)],
        };
      }

      state = 'active';

      return {
        success: true,
        text: finalText || '(no output)',
        durationMs: Date.now() - startTime,
        totalCostUsd: totalCost,
        numTurns: 1,
      };
    },

    async stopSession(): Promise<void> {
      if (backendSessionId && client) {
        try {
          await client.session.abort({
            path: { id: backendSessionId },
            ...(config.cwd ? { query: { directory: config.cwd } } : {}),
          });
        } catch {
          // Best-effort abort
        }
      }
      backendSessionId = undefined;
      state = 'idle';
    },

    async resetSession(): Promise<{ backendSessionId: string }> {
      await this.stopSession();
      return this.startSession();
    },

    getStatus(): AdapterSessionInfo {
      return {
        backendSessionId,
        state,
      };
    },
  };
}

/**
 * Parse a model string like "anthropic/claude-sonnet-4-20250514" into
 * the OpenCode model spec format { providerID, modelID }.
 */
function parseModelSpec(model: string): { providerID: string; modelID: string } | undefined {
  const slash = model.indexOf('/');
  if (slash > 0) {
    return {
      providerID: model.slice(0, slash),
      modelID: model.slice(slash + 1),
    };
  }
  return { providerID: '', modelID: model };
}
