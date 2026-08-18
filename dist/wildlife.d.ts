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
export declare const AI_SPECIES: {
    readonly predators: readonly ["Tyrannosaurus", "Allosaurus", "Carnotaurus", "Ceratosaurus", "Dilophosaurus", "Omniraptor", "Herrerasaurus", "Troodon", "Deinosuchus", "Pteranodon"];
    readonly prey: readonly ["Dryosaurus", "Hypsilophodon", "Gallimimus", "Tenontosaurus", "Maiasaura", "Diabloceratops", "Beipiaosaurus", "Compsognathus", "Triceratops", "Stegosaurus", "Pachycephalosaurus"];
    readonly animals: readonly ["Boar", "Deer", "Goat", "Rabbit", "Chicken", "Crab", "Bullfrog", "Seaturtle"];
};
export declare const ALL_AI_SPECIES: string[];
export declare function isSpawnableAI(species: string): boolean;
