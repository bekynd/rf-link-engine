// Model build version (plan 4.1, 15): part of every result's canonical inputs and stored inputs.
export const MODEL_BUILD = {
  engine: '0.1.0',
  itm: { repo: 'https://github.com/NTIA/itm', commit: '183ad95bd813a8be11009df396e1c631356864b2', modified: true },
  p2108: { repo: 'https://github.com/NTIA/p2108', commit: 'eadb58f7daa5f077b7bd67fc30daf49f0ae037e6', version: '1.1', modified: false },
  recommendations: { P2108: 'ITU-R P.2108-1 (09/2021)', P833: 'ITU-R P.833-10 (09/2021)', P372: 'ITU-R P.372-18 (09/2026)', P453: 'ITU-R P.453-14 (08/2019)' },
  emscripten: '4.0.10',
} as const;
export type ModelBuild = typeof MODEL_BUILD;
