/**
 * Which species can be spawned as AI.
 *
 * A mirror of the pair table in the mod, minus the class paths — the bot only
 * needs the names, for autocomplete and for saying no early rather than making
 * someone wait on a round trip that was never going to work.
 *
 * These are the pairings upstream verified. Several species have no AI brain of
 * their own and only work by borrowing another's, which is why this is a fixed
 * list rather than everything `getplayables` reports.
 */
export const AI_SPECIES = {
    predators: [
        'Tyrannosaurus', 'Allosaurus', 'Carnotaurus', 'Ceratosaurus', 'Dilophosaurus',
        'Omniraptor', 'Herrerasaurus', 'Troodon', 'Deinosuchus', 'Pteranodon',
    ],
    prey: [
        'Dryosaurus', 'Hypsilophodon', 'Gallimimus', 'Tenontosaurus', 'Maiasaura',
        'Diabloceratops', 'Beipiaosaurus', 'Compsognathus', 'Triceratops',
        'Stegosaurus', 'Pachycephalosaurus',
    ],
    animals: [
        'Boar', 'Deer', 'Goat', 'Rabbit', 'Chicken', 'Crab', 'Bullfrog', 'Seaturtle',
    ],
};
export const ALL_AI_SPECIES = [
    ...AI_SPECIES.predators,
    ...AI_SPECIES.prey,
    ...AI_SPECIES.animals,
].sort((a, b) => a.localeCompare(b));
export function isSpawnableAI(species) {
    return ALL_AI_SPECIES.includes(species);
}
//# sourceMappingURL=wildlife.js.map