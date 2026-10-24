// Worker pool with cancellation (plan 12.1: all in-flight work is cancellable; plan 6: cancellation
// latency is benchmarked in phase 4). WASM calls are synchronous inside a worker, so cancelling a
// running task terminates that worker and spawns a replacement; queued tasks are simply dropped.

export interface PoolWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface TaskMessage {
  id: number;
  type: string;
  payload: unknown;
}
export type ReplyMessage = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export class TaskCancelledError extends Error {
  constructor() {
    super('task cancelled');
    this.name = 'AbortError';
  }
}

interface Pending {
  msg: TaskMessage;
  transfer: Transferable[];
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

interface Slot {
  worker: PoolWorker;
  task: Pending | null;
}

export interface WorkerPool {
  run<T>(type: string, payload: unknown, opts?: { signal?: AbortSignal; transfer?: Transferable[] }): Promise<T>;
  readonly size: number;
  /** Tasks waiting for a free worker. */
  readonly queued: number;
  destroy(): void;
}

export function createWorkerPool(spawn: () => PoolWorker, size: number): WorkerPool {
  if (!(size >= 1)) throw new RangeError('pool size must be >= 1');
  let nextId = 1;
  let destroyed = false;
  const queue: Pending[] = [];
  const slots: Slot[] = [];

  const settle = (p: Pending) => {
    if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
  };

  const attach = (slot: Slot) => {
    slot.worker.onmessage = (ev) => {
      const r = ev.data as ReplyMessage;
      const t = slot.task;
      if (!t || t.msg.id !== r.id) return;
      slot.task = null;
      settle(t);
      if (r.ok) t.resolve(r.result);
      else t.reject(new Error(r.error));
      pump();
    };
    slot.worker.onerror = (ev) => {
      const t = slot.task;
      replace(slot);
      if (t) {
        settle(t);
        t.reject(ev instanceof Error ? ev : new Error('worker error'));
      }
      pump();
    };
  };

  const replace = (slot: Slot) => {
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    slot.worker = spawn();
    slot.task = null;
    attach(slot);
  };

  for (let i = 0; i < size; i++) {
    const slot: Slot = { worker: spawn(), task: null };
    attach(slot);
    slots.push(slot);
  }

  const pump = () => {
    for (const slot of slots) {
      if (slot.task || queue.length === 0) continue;
      const t = queue.shift()!;
      slot.task = t;
      slot.worker.postMessage(t.msg, t.transfer);
    }
  };

  return {
    get size() { return slots.length; },
    get queued() { return queue.length; },
    run<T>(type: string, payload: unknown, opts: { signal?: AbortSignal; transfer?: Transferable[] } = {}) {
      if (destroyed) return Promise.reject(new Error('pool destroyed'));
      if (opts.signal?.aborted) return Promise.reject(new TaskCancelledError());
      return new Promise<T>((resolve, reject) => {
        const p: Pending = { msg: { id: nextId++, type, payload }, transfer: opts.transfer ?? [], resolve: resolve as (v: unknown) => void, reject, signal: opts.signal, onAbort: undefined };
        if (opts.signal) {
          p.onAbort = () => {
            const qi = queue.indexOf(p);
            if (qi >= 0) queue.splice(qi, 1);
            const slot = slots.find((s) => s.task === p);
            if (slot) replace(slot); // hard cancel of a running synchronous task
            settle(p);
            reject(new TaskCancelledError());
            pump();
          };
          opts.signal.addEventListener('abort', p.onAbort, { once: true });
        }
        queue.push(p);
        pump();
      });
    },
    destroy() {
      destroyed = true;
      for (const s of slots) {
        s.worker.terminate();
        if (s.task) { settle(s.task); s.task.reject(new TaskCancelledError()); }
      }
      for (const q of queue.splice(0)) { settle(q); q.reject(new TaskCancelledError()); }
    },
  };
}
