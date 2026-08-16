/**
 * What each mutation actually does, so the picker reads like the in-game list
 * rather than forty bits of Latin.
 *
 * Sourced from the Evrima Quick Guide rather than invented. Keyed loosely
 * because the stock Game.ini spells them inconsistently — "Enlarged meniscus"
 * with a small m, "Hydroregenerative" without the hyphen — so lookup strips
 * everything that is not a letter.
 */

const key = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '');

const DESCRIPTIONS: Record<string, string> = {
  acceleratedpreydrive: 'More damage to targets below 35% health',
  advancedgestation: 'Faster egg gestation and incubation',
  augmentedtapetum: 'Better night vision',
  barometricsensitivity: 'Warns you before storms and droughts',
  cannibalistic: 'Can eat your own species',
  cellularregeneration: 'Health recovers faster',
  cochlearsensitivity: 'Detect sound traps from a distance',
  congenitalhypoalgesia: 'Less damage from larger species',
  efficientdigestion: 'Food drains slower',
  enhanceddigestion: 'Nutrients decay slower',
  enlargedmeniscus: 'Fall damage hits stamina before health',
  epidermalfibrosis: 'More bleed resistance',
  featherweight: 'Footprints fade much faster',
  gastronomicregeneration: 'Eating restores health',
  heightenedghrelin: 'Can overeat much further',
  hematophagy: 'Corpses restore thirst',
  hemomania: 'More damage to bleeding targets',
  hydrodynamic: 'Swim faster',
  hydroregenerative: 'Heal faster in the rain',
  hypermetabolicinanition: 'More damage when starving',
  hypervigilance: 'Wider view while eating, hear others further off',
  increasedinspiratorycapacity: 'More oxygen',
  infrasoundcommunication: 'Your calls carry less far to others',
  multichamberedlungs: 'Stamina starts regenerating sooner',
  nocturnal: 'Heal faster at night',
  osteophagic: 'Eat bones to mend fractures',
  osteosclerosis: 'Resists fracture damage',
  parathrepsis: 'Fake a fracture',
  paratrepsis: 'Fake a fracture',
  parthenogenesis: 'Nest without a mate; not inherited',
  photosyntheticregeneration: 'Stamina regenerates faster in daylight',
  photosynthetictissue: 'Heal faster during the day',
  pitorgan: 'Detect infrared light sources',
  prolificreproduction: 'Offspring are stronger and grow faster',
  reabsorption: 'Slowly regain water in rain or while in water',
  reinforcedtendons: 'Jumping costs less stamina',
  reniculatekidneys: 'Can drink saltwater',
  sequentialhermaphroditism: 'Changes sex; not inherited',
  socialbehavior: 'Larger group size, for leaders only',
  submergedopticalretention: 'See further underwater',
  sustainedhydration: 'Thirst drains slower',
  tactileendurance: 'Converts incoming damage to stamina',
  truculency: 'Buck latched attackers off more easily',
  wader: 'Moves more easily through shallow water',
  xerocoleadaptation: 'Plants give water',
};

/**
 * Mutations the game has dropped but the stock config still lists. Gifting one
 * would write something the engine ignores, so the picker says so.
 */
const REMOVED: Record<string, string> = {
  traumaticthrombosis: 'Removed from the game in 0.21.720',
  intraspecificaggression: 'Removed from the game in 0.15.116',
};

export function describeMutation(name: string): string | null {
  const k = key(name);
  return REMOVED[k] ?? DESCRIPTIONS[k] ?? null;
}

export function isRemoved(name: string): boolean {
  return key(name) in REMOVED;
}

/** Discord caps a choice label at 100 characters. */
const LABEL_LIMIT = 100;

function label(name: string): string {
  const description = describeMutation(name);
  if (!description) return name.slice(0, LABEL_LIMIT);

  const full = `${isRemoved(name) ? '⚠️ ' : ''}${name} — ${description}`;
  return full.length <= LABEL_LIMIT ? full : `${full.slice(0, LABEL_LIMIT - 1)}…`;
}

/**
 * Choices for the picker, searching the description as well as the name —
 * people look for "heal", not "cellular".
 */
export function mutationChoices(
  all: string[],
  typed: string,
): Array<{ name: string; value: string }> {
  const needle = typed.trim().toLowerCase();

  const matches = needle
    ? all.filter((m) =>
        m.toLowerCase().includes(needle) ||
        (describeMutation(m) ?? '').toLowerCase().includes(needle))
    : all;

  // Removed ones sink to the bottom rather than vanishing: an admin looking for
  // one deserves to be told why it is not worth giving.
  return matches
    .sort((a, b) => Number(isRemoved(a)) - Number(isRemoved(b)))
    .slice(0, 25)
    .map((m) => ({ name: label(m), value: m }));
}
