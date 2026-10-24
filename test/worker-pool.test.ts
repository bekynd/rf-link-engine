import { describe, expect, it } from 'vitest';
import { createWorkerPool, type PoolWorker, type TaskMessage } from '../src/worker-pool.ts';
import { handle } from '../src/worker.ts';
import { DEFAULT_VARIABILITY } from '../src/labels.ts';
import { hill } from './helpers.ts';

/** In-process fake worker: replies after `delay` ms via the real handler (or an echo). */
function fakeSpawner(delay = 20, real = false) {
  const stats = { spawned: 0, terminated: 0 };
  const spawn = (): PoolWorker => {
    stats.spawned++;
    let alive = true;
    const w: PoolWorker = {
      onmessage: null,
      onerror: null,
      postMessage(m) {
        const msg = m as TaskMessage;
        setTimeout(async () => {
          if (!alive) return;
          const reply = real ? await handle(msg) : { id: msg.id, ok: true, result: msg.payload };
          if (alive) w.onmessage?.({ data: reply });
        }, delay);
      },
      terminate() { alive = false; stats.terminated++; },
    };
    return w;
  };
  return { spawn, stats };
}

describe('worker pool', () => {
  it('runs tasks across workers', async () => {
    const { spawn } = fakeSpawner(5);
    const pool = createWorkerPool(spawn, 2);
    const r = await Promise.all([1, 2, 3, 4, 5].map((n) => pool.run<number>('echo', n)));
    expect(r).toEqual([1, 2, 3, 4, 5]);
    pool.destroy();
  });

  it('cancelling a queued task removes it without touching workers', async () => {
    const { spawn, stats } = fakeSpawner(30);
    const pool = createWorkerPool(spawn, 1);
    const first = pool.run('echo', 'a');
    const ctl = new AbortController();
    const second = pool.run('echo', 'b', { signal: ctl.signal });
    expect(pool.queued).toBe(1);
    ctl.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.queued).toBe(0);
    expect(await first).toBe('a');
    expect(stats.terminated).toBe(0);
    pool.destroy();
  });

  it('cancelling a running task terminates and replaces its worker; the pool keeps working', async () => {
    const { spawn, stats } = fakeSpawner(50);
    const pool = createWorkerPool(spawn, 1);
    const ctl = new AbortController();
    const running = pool.run('echo', 'x', { signal: ctl.signal });
    const t0 = performance.now();
    ctl.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - t0).toBeLessThan(20); // rejected immediately, not after the task's 50 ms
    expect(stats.terminated).toBe(1);
    expect(stats.spawned).toBe(2);
    expect(await pool.run('echo', 'y')).toBe('y');
    pool.destroy();
  });

  it('worker handler computes path loss with the engine', async () => {
    const { spawn } = fakeSpawner(0, true);
    const pool = createWorkerPool(spawn, 1);
    const r = await pool.run<{ status: string; columns: unknown[] }>('pathLoss', {
      profile: hill(15000, 100), f_mhz: 146, heights: { a_m: 2, b_m: 10 }, environment: { option: 'A' },
      climate: 5, N_0: 301, polarization: 1, ground: { epsilon: 15, sigma: 0.005 }, variability: DEFAULT_VARIABILITY,
    });
    expect(r.status).toBe('ok');
    expect(r.columns).toHaveLength(2);
    pool.destroy();
  });
});
