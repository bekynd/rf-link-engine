// Worker entry: `new Worker(new URL('@rflp/engine/src/worker.ts', import.meta.url), { type: 'module' })`.
// Handles task messages from worker-pool.ts with the engine loaded once per worker.
import './zod-jitless.ts'; // first: before any module that defines a schema
import { radialPrefixLosses, type RadialRequest } from './coverage.ts';
import { predictPathLoss, type PathRequest } from './path.ts';
import { loadEngineWasm } from './wasm.ts';
import type { ReplyMessage, TaskMessage } from './worker-pool.ts';

const ready = loadEngineWasm();

export async function handle(msg: TaskMessage): Promise<ReplyMessage> {
  try {
    const wasm = await ready;
    switch (msg.type) {
      case 'pathLoss':
        return { id: msg.id, ok: true, result: predictPathLoss(wasm, msg.payload as PathRequest) };
      case 'coverageRadial':
        return { id: msg.id, ok: true, result: radialPrefixLosses(wasm, msg.payload as RadialRequest) };
      default:
        return { id: msg.id, ok: false, error: `unknown task type ${msg.type}` };
    }
  } catch (e) {
    return { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

declare const self: { onmessage: ((ev: MessageEvent<TaskMessage>) => void) | null; postMessage(m: unknown): void } | undefined;
if (typeof self !== 'undefined' && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  self.onmessage = (ev) => { void handle(ev.data).then((r) => self.postMessage(r)); };
}
