// Icon resolution for the UI. Images are served by the main process through `wowicon://icon/<name>`
// (downloaded once from Wowhead's CDN, then cached on disk).
import { SPECS, classIcon } from '../domain/class-detect.js';

let spellIcons = {};

// Abilities the game table lacks or maps to its "Temp" placeholder.
const FALLBACK_SPELL_ICONS = {
  Melee: 'ability_meleedamage',
  'Auto Shot': 'ability_whirlwind',
  Shoot: 'ability_shootwand',
  Renew: 'spell_holy_renew',
  'First Aid': 'spell_holy_sealofsacrifice',
  'Damage Shield': 'spell_holy_devotionaura',
  Falling: 'ability_rogue_quickrecovery',
  'Judgement of Wisdom': 'spell_holy_righteousnessaura',
  'Judgement of Light': 'spell_holy_healingaura',
};

export const ICONS = {
  unknown: 'inv_misc_questionmark',
  pet: 'ability_hunter_beastcall',
  enemy: 'inv_misc_bone_humanskull_01',
  death: 'ability_rogue_feigndeath',
  segment: 'spell_holy_borrowedtime',
  groups: { Damage: 'inv_sword_04', Heal: 'spell_holy_flashheal', Misc: 'inv_misc_bone_humanskull_01' },
  categories: {
    'damage-done': 'inv_sword_04',
    dps: 'ability_warrior_innerrage',
    'damage-taken': 'ability_warrior_defensivestance',
    'damage-taken-by-spell': 'spell_shadow_shadowbolt',
    enemies: 'inv_misc_bone_humanskull_01',
    'healing-done': 'spell_holy_flashheal',
    hps: 'spell_holy_renew',
    'healing-taken': 'spell_holy_heal02',
    deaths: 'ability_rogue_feigndeath',
    resources: 'inv_potion_76',
  },
};

export function setSpellIcons(map) {
  spellIcons = map ?? {};
}

export const iconUrl = (name) => `wowicon://icon/${encodeURIComponent(name)}`;

export function spellIcon(spellName) {
  if (!spellName) return ICONS.unknown;
  const direct = FALLBACK_SPELL_ICONS[spellName] ?? spellIcons[spellName];
  if (direct) return direct;
  // "Claw (Grizzled Thistle Bear)" / "Seal of Wisdom (Mana)" -> look up the bare ability name
  const bare = spellName.replace(/\s*\([^)]*\)\s*$/, '');
  return FALLBACK_SPELL_ICONS[bare] ?? spellIcons[bare] ?? ICONS.unknown;
}

// Details! shows the spec icon when known, otherwise the class icon.
export function unitIcon({ spec, cls, isPet }) {
  if (spec && SPECS[spec]) return SPECS[spec].icon;
  if (cls) return classIcon(cls);
  if (isPet) return ICONS.pet;
  return ICONS.unknown;
}

export function unitDescription({ spec, cls, isPet }) {
  const clsLabel = cls ? cls[0].toUpperCase() + cls.slice(1) : null;
  if (spec && SPECS[spec]) return `${SPECS[spec].label} ${clsLabel}`;
  if (clsLabel) return clsLabel;
  return isPet ? 'Pet' : null;
}

// <img> that degrades to an empty dark square when offline or missing.
export function iconImg(name, className = 'icon') {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.draggable = false;
  img.loading = 'lazy';
  img.src = iconUrl(name);
  img.addEventListener('error', () => img.classList.add('missing'), { once: true });
  return img;
}
