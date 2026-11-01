// Guesses a unit's class from the spells it casts, so bars can use class colors like Details!.

const SIGNATURES = {
  warrior: ['Heroic Strike', 'Mortal Strike', 'Bloodthirst', 'Revenge', 'Shield Slam', 'Cleave', 'Whirlwind',
    'Execute', 'Rend', 'Sunder Armor', 'Thunder Clap', 'Overpower', 'Concussion Blow', 'Shield Bash', 'Hamstring',
    'Slam', 'Intercept', 'Charge', 'Deep Wound', 'Bladestorm', 'Devastate', 'Pummel'],
  rogue: ['Sinister Strike', 'Backstab', 'Eviscerate', 'Rupture', 'Ambush', 'Garrote', 'Hemorrhage', 'Instant Poison',
    'Deadly Poison', 'Kick', 'Gouge', 'Mutilate', 'Envenom', 'Blade Flurry', 'Fan of Knives', 'Wound Poison'],
  hunter: ['Auto Shot', 'Serpent Sting', 'Arcane Shot', 'Multi-Shot', 'Aimed Shot', 'Steady Shot', 'Raptor Strike',
    'Mongoose Bite', 'Wing Clip', 'Explosive Trap', 'Immolation Trap', 'Kill Command', 'Volley', 'Chimera Shot',
    'Explosive Shot', 'Concussive Shot'],
  mage: ['Fireball', 'Frostbolt', 'Arcane Missiles', 'Fire Blast', 'Scorch', 'Pyroblast', 'Flamestrike', 'Blizzard',
    'Arcane Explosion', 'Frost Nova', 'Cone of Cold', 'Ice Lance', 'Arcane Blast', 'Living Bomb', 'Ignite', 'Frostfire Bolt'],
  warlock: ['Shadow Bolt', 'Corruption', 'Curse of Agony', 'Immolate', 'Drain Life', 'Searing Pain', 'Siphon Life',
    'Incinerate', 'Hellfire', 'Life Tap', 'Drain Soul', 'Unstable Affliction', 'Haunt', 'Chaos Bolt', 'Conflagrate',
    'Shadowburn', 'Seed of Corruption', 'Curse of Doom', 'Rain of Fire'],
  priest: ['Smite', 'Mind Blast', 'Shadow Word: Pain', 'Holy Fire', 'Mind Flay', 'Renew', 'Flash Heal', 'Greater Heal',
    'Prayer of Healing', 'Lesser Heal', 'Power Word: Shield', 'Vampiric Touch', 'Devouring Plague', 'Penance',
    'Circle of Healing', 'Prayer of Mending', 'Binding Heal', 'Shadow Word: Death', 'Holy Nova'],
  paladin: ['Seal of Righteousness', 'Judgement', 'Judgement of Righteousness', 'Holy Shock', 'Consecration', 'Holy Light',
    'Flash of Light', 'Seal of Command', 'Crusader Strike', 'Exorcism', 'Hammer of Wrath',
    'Seal of Wisdom', 'Seal of Light', 'Holy Shield', 'Divine Storm', 'Seal of Blood', 'Avenger\'s Shield',
    'Hammer of the Righteous', 'Seal of Vengeance'],
  shaman: ['Lightning Bolt', 'Chain Lightning', 'Earth Shock', 'Flame Shock', 'Frost Shock', 'Stormstrike', 'Healing Wave',
    'Lesser Healing Wave', 'Chain Heal', 'Windfury Attack', 'Searing Totem', 'Magma Totem', 'Lightning Shield',
    'Lava Burst', 'Lava Lash', 'Earth Shield', 'Riptide', 'Fire Nova'],
  druid: ['Wrath', 'Moonfire', 'Starfire', 'Insect Swarm', 'Rejuvenation', 'Regrowth', 'Healing Touch', 'Maul', 'Swipe',
    'Shred', 'Rake', 'Ferocious Bite', 'Rip', 'Lifebloom', 'Tranquility', 'Hurricane', 'Mangle', 'Wild Growth',
    'Starsurge', 'Lacerate'],
};

const SPELL_TO_CLASS = new Map();
for (const [cls, spells] of Object.entries(SIGNATURES)) for (const s of spells) SPELL_TO_CLASS.set(s, cls);

export const CLASS_COLORS = {
  warrior: '#C69B6D', paladin: '#F48CBA', hunter: '#AAD372', rogue: '#FFF468', priest: '#FFFFFF',
  shaman: '#0070DD', mage: '#3FC7EB', warlock: '#8788EE', druid: '#FF7C0A',
};

// Talent-only abilities reveal the spec. icon = Wowhead icon name used for the spec badge.
export const SPECS = {
  'warrior:arms': { label: 'Arms', icon: 'ability_warrior_savageblow', spells: ['Mortal Strike', 'Sweeping Strikes', 'Bladestorm'] },
  'warrior:fury': { label: 'Fury', icon: 'ability_warrior_innerrage', spells: ['Bloodthirst', 'Rampage', 'Flurry'] },
  'warrior:protection': { label: 'Protection', icon: 'ability_warrior_defensivestance', spells: ['Shield Slam', 'Devastate', 'Concussion Blow', 'Shockwave'] },
  'rogue:assassination': { label: 'Assassination', icon: 'ability_rogue_eviscerate', spells: ['Mutilate', 'Cold Blood', 'Envenom'] },
  'rogue:combat': { label: 'Combat', icon: 'ability_backstab', spells: ['Blade Flurry', 'Adrenaline Rush', 'Riposte', 'Killing Spree'] },
  'rogue:subtlety': { label: 'Subtlety', icon: 'ability_stealth', spells: ['Hemorrhage', 'Ghostly Strike', 'Shadowstep', 'Premeditation'] },
  'hunter:beastmastery': { label: 'Beast Mastery', icon: 'ability_hunter_beasttaming', spells: ['Intimidation', 'Bestial Wrath'] },
  'hunter:marksmanship': { label: 'Marksmanship', icon: 'ability_marksmanship', spells: ['Aimed Shot', 'Scatter Shot', 'Chimera Shot', 'Silencing Shot'] },
  'hunter:survival': { label: 'Survival', icon: 'ability_hunter_swiftstrike', spells: ['Wyvern Sting', 'Counterattack', 'Explosive Shot', 'Black Arrow'] },
  'mage:arcane': { label: 'Arcane', icon: 'spell_holy_magicalsentry', spells: ['Arcane Barrage', 'Arcane Power', 'Presence of Mind'] },
  'mage:fire': { label: 'Fire', icon: 'spell_fire_firebolt02', spells: ['Pyroblast', 'Blast Wave', "Dragon's Breath", 'Living Bomb', 'Combustion'] },
  'mage:frost': { label: 'Frost', icon: 'spell_frost_frostbolt02', spells: ['Ice Barrier', 'Deep Freeze', 'Waterbolt'] },
  'warlock:affliction': { label: 'Affliction', icon: 'spell_shadow_deathcoil', spells: ['Unstable Affliction', 'Haunt', 'Siphon Life'] },
  'warlock:demonology': { label: 'Demonology', icon: 'spell_shadow_metamorphosis', spells: ['Metamorphosis', 'Demonic Empowerment'] },
  'warlock:destruction': { label: 'Destruction', icon: 'spell_shadow_rainoffire', spells: ['Conflagrate', 'Shadowburn', 'Chaos Bolt', 'Shadowfury'] },
  'priest:discipline': { label: 'Discipline', icon: 'spell_holy_wordfortitude', spells: ['Penance', 'Power Infusion', 'Pain Suppression'] },
  'priest:holy': { label: 'Holy', icon: 'spell_holy_guardianspirit', spells: ['Circle of Healing', 'Lightwell', 'Guardian Spirit'] },
  'priest:shadow': { label: 'Shadow', icon: 'spell_shadow_shadowwordpain', spells: ['Mind Flay', 'Vampiric Touch', 'Vampiric Embrace', 'Dispersion'] },
  'paladin:holy': { label: 'Holy', icon: 'spell_holy_holybolt', spells: ['Holy Shock', 'Beacon of Light'] },
  'paladin:protection': { label: 'Protection', icon: 'spell_holy_devotionaura', spells: ['Holy Shield', "Avenger's Shield", 'Hammer of the Righteous'] },
  'paladin:retribution': { label: 'Retribution', icon: 'spell_holy_auraoflight', spells: ['Crusader Strike', 'Divine Storm', 'Seal of Command', 'Repentance'] },
  'shaman:elemental': { label: 'Elemental', icon: 'spell_nature_lightning', spells: ['Elemental Mastery', 'Thunderstorm', 'Totem of Wrath'] },
  'shaman:enhancement': { label: 'Enhancement', icon: 'spell_nature_lightningshield', spells: ['Stormstrike', 'Lava Lash', 'Shamanistic Rage'] },
  'shaman:restoration': { label: 'Restoration', icon: 'spell_nature_magicimmunity', spells: ['Earth Shield', 'Riptide', 'Mana Tide Totem'] },
  'druid:balance': { label: 'Balance', icon: 'spell_nature_starfall', spells: ['Insect Swarm', 'Starfall', 'Force of Nature'] },
  'druid:feral': { label: 'Feral', icon: 'ability_racial_bearform', spells: ['Mangle', 'Mangle (Bear)', 'Mangle (Cat)', 'Feral Charge'] },
  'druid:restoration': { label: 'Restoration', icon: 'spell_nature_healingtouch', spells: ['Swiftmend', 'Wild Growth', "Nature's Swiftness"] },
};

const SPELL_TO_SPEC = new Map();
for (const [spec, def] of Object.entries(SPECS)) for (const s of def.spells) SPELL_TO_SPEC.set(s, spec);

export const classIcon = (cls) => (cls ? `classicon_${cls}` : null);

function vote(store, unit, key) {
  let v = store.get(unit);
  if (!v) store.set(unit, (v = new Map()));
  v.set(key, (v.get(key) ?? 0) + 1);
}

function winner(store, unit) {
  const v = store.get(unit);
  if (!v) return null;
  let best = null;
  let bestCount = 0;
  for (const [key, n] of v) if (n > bestCount) [best, bestCount] = [key, n];
  return best;
}

export class ClassDetector {
  constructor() {
    this.votes = new Map(); // unit -> Map(class -> count)
    this.specVotes = new Map(); // unit -> Map(spec -> count)
  }

  observe(event) {
    if (!event.source || !event.spell) return;
    if (!['damage', 'heal', 'miss'].includes(event.kind)) return;
    const spec = SPELL_TO_SPEC.get(event.spell);
    const cls = SPELL_TO_CLASS.get(event.spell) ?? spec?.split(':')[0];
    if (cls) vote(this.votes, event.source, cls);
    if (spec) vote(this.specVotes, event.source, spec);
  }

  classOf(unit) {
    return winner(this.votes, unit);
  }

  // Spec only counts when it agrees with the detected class.
  specOf(unit) {
    const cls = this.classOf(unit);
    const v = this.specVotes.get(unit);
    if (!cls || !v) return null;
    let best = null;
    let bestCount = 0;
    for (const [spec, n] of v) if (spec.startsWith(`${cls}:`) && n > bestCount) [best, bestCount] = [spec, n];
    return best;
  }
}
