// The text combat log never says who owns a pet, so ownership is inferred, strongest evidence first:
// 1. manual mapping (settings), 2. owner-only spells cast on the pet (Mend Pet, Health Funnel),
// 3. class hints: hunter/warlock-only pet auras or demon names, matched against the party's pet classes.
import { looksLikePet } from './factions.js';

const OWNER_SPELLS = new Set(['Mend Pet', 'Health Funnel', 'Dark Pact', 'Feed Pet', 'Revive Pet']);
const HUNTER_PET_AURAS = new Set(['Bestial Wrath', 'Frenzy Effect', 'Frenzy', 'Kill Command', 'Spirit Bond', 'Feed Pet Effect']);
const WARLOCK_PET_AURAS = new Set(['Demonic Sacrifice', 'Soul Link', 'Demonic Empowerment', 'Fel Intelligence']);
const DEMON_NAMES = /\b(Imp|Voidwalker|Felhunter|Succubus|Felguard|Infernal|Doomguard)\b/i;
const PET_CLASSES = ['hunter', 'warlock'];

export class PetOwners {
  constructor() {
    this.manual = new Map();
    this.explicit = new Map(); // pet -> owner
    this.hints = new Map(); // pet -> 'hunter' | 'warlock'
  }

  setManual(mapping = {}) {
    this.manual = new Map(Object.entries(mapping));
  }

  observe(event) {
    if (event.kind === 'heal' && OWNER_SPELLS.has(event.spell) && event.source !== event.target) {
      this.explicit.set(event.target, event.source);
    } else if (event.kind === 'aura' && event.action === 'applied') {
      if (HUNTER_PET_AURAS.has(event.spell)) this.hints.set(event.target, 'hunter');
      else if (WARLOCK_PET_AURAS.has(event.spell)) this.hints.set(event.target, 'warlock');
    }
  }

  isPet(name, isFriendly) {
    return this.manual.has(name) || this.explicit.has(name) || (isFriendly(name) && looksLikePet(name));
  }

  // players: friendly non-pet unit names seen in the segment; classOf: name -> class | null
  ownerOf(name, { isFriendly, classOf, players }) {
    if (this.manual.has(name)) return this.manual.get(name);
    if (this.explicit.has(name)) return this.explicit.get(name);
    if (!this.isPet(name, isFriendly)) return null;

    const hint = this.hints.get(name) ?? (DEMON_NAMES.test(name) ? 'warlock' : null);
    const candidates = players.filter((p) => (hint ? classOf(p) === hint : PET_CLASSES.includes(classOf(p))));
    return candidates.length === 1 ? candidates[0] : null;
  }
}
