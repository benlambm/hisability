// The approved movement catalog. Content only; no timer or UI logic lives here.
import lower from './lower.js';
import upper from './upper.js';
import core from './core.js';
import cardio from './cardio.js';

export const CATALOG_VERSION = 1;

export const CATALOG = Object.freeze([...lower, ...upper, ...core, ...cardio]);

export const BY_ID = new Map(CATALOG.map((m) => [m.id, m]));
