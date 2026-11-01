// The text combat log has no unit flags, so friend/foe is inferred:
// damage links two units as opposite sides, healing/energize links them as the same side.
// A union-find with parity keeps those relations; "You" anchors the friendly side.
import { SELF, ENVIRONMENT } from './combat-log-parser.js';

export const FRIENDLY = 'friendly';
export const HOSTILE = 'hostile';
export const UNKNOWN = 'unknown';

export class Factions {
  constructor() {
    this.parent = new Map();
    this.parity = new Map(); // parity relative to parent: 0 same side, 1 opposite
  }

  #ensure(name) {
    if (!this.parent.has(name)) {
      this.parent.set(name, name);
      this.parity.set(name, 0);
    }
  }

  #find(name) {
    this.#ensure(name);
    const p = this.parent.get(name);
    if (p === name) return { root: name, parity: 0 };
    const up = this.#find(p);
    this.parent.set(name, up.root);
    this.parity.set(name, this.parity.get(name) ^ up.parity);
    return { root: up.root, parity: this.parity.get(name) };
  }

  #link(a, b, opposite) {
    if (!a || !b || a === b || a === ENVIRONMENT || b === ENVIRONMENT) return;
    const ra = this.#find(a);
    const rb = this.#find(b);
    if (ra.root === rb.root) return; // first evidence wins (mind control, duels...)
    this.parent.set(rb.root, ra.root);
    this.parity.set(rb.root, ra.parity ^ rb.parity ^ (opposite ? 1 : 0));
  }

  observe(event) {
    if (event.kind === 'damage' || event.kind === 'miss') this.#link(event.source, event.target, true);
    else if (event.kind === 'heal' || event.kind === 'energize') this.#link(event.source, event.target, false);
  }

  sideOf(name) {
    if (name === SELF) return FRIENDLY;
    if (!this.parent.has(name) || !this.parent.has(SELF)) return UNKNOWN;
    const me = this.#find(SELF);
    const other = this.#find(name);
    if (me.root !== other.root) return UNKNOWN;
    return me.parity === other.parity ? FRIENDLY : HOSTILE;
  }

  isFriendly(name) {
    return this.sideOf(name) === FRIENDLY;
  }

  isHostile(name) {
    return this.sideOf(name) === HOSTILE;
  }
}

// Players have single-word names; multi-word friendly units are pets/totems/guardians.
export const looksLikePet = (name) => name !== SELF && /\s/.test(name);
