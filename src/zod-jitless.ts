// Imported first by the worker entry: zod reads this setting when schemas are created (at import
// time), so it must run before any module that defines one. No string evaluation (zod's JIT uses
// new Function), so the worker runs under a strict CSP without 'unsafe-eval'.
import { config } from 'zod';

config({ jitless: true });
