// Every third-party asset the game uses, where it comes from, and how it's prepared.
// `npm run assets` downloads the sources into .asset-cache/ and builds what the game loads into
// public/assets/. Licences: Rocketbox avatars and animations are MIT (Microsoft); Poly Haven
// textures, HDRIs and models are CC0. See public/assets/CREDITS.md.

export const ROCKETBOX = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets';

/**
 * People. src: Rocketbox avatar folder. tex: texture size per material (the head stays sharp
 * for close-ups). drop: materials to leave out of the build.
 */
export const AVATARS = {
  Military_Male_01: { src: 'Avatars/Professions/Military_Male_01' },
  Military_Male_02: { src: 'Avatars/Professions/Military_Male_02' },
  Military_Male_03: { src: 'Avatars/Professions/Military_Male_03' },
  Military_Male_04: { src: 'Avatars/Professions/Military_Male_04' },
  Military_Male_05: { src: 'Avatars/Professions/Military_Male_05' },
  Military_Male_06: { src: 'Avatars/Professions/Military_Male_06' },
  Security_Male_01: { src: 'Avatars/Professions/Security_Male_01' },
  Construction_Male_02: { src: 'Avatars/Professions/Construction_Male_02' },
  // The cartel's gunmen, in street clothes
  Delivery_Male_01: { src: 'Avatars/Professions/Delivery_Male_01' },
  Male_Adult_06: { src: 'Avatars/Adults/Male_Adult_06' },
  Male_Adult_07: { src: 'Avatars/Adults/Male_Adult_07' },
  Male_Adult_09: { src: 'Avatars/Adults/Male_Adult_09' },
  Male_Adult_10: { src: 'Avatars/Adults/Male_Adult_10' },
  Male_Adult_11: { src: 'Avatars/Adults/Male_Adult_11' },
  Male_Adult_12: { src: 'Avatars/Adults/Male_Adult_12' },
  Male_Adult_18: { src: 'Avatars/Adults/Male_Adult_18' },
  Male_Adult_20: { src: 'Avatars/Adults/Male_Adult_20' },
};

/** Motion-captured clips (Rocketbox, male). Locomotion has its root motion taken out. */
export const ANIMATIONS = {
  idle: 'all_animations_max_motextr_static/m_idle_neutral_01',
  idleLook: 'all_animations_max_motextr_static/m_idle_look_around_01',
  idleNervous: 'all_animations_max_motextr_static/m_idle_nervous_01',
  crouchIdle: 'all_animations_max_motextr_static/m_crouch_idle',
  walk: 'all_animations_max_motextr_xy/m_walk_neutral_01',
  walkFast: 'all_animations_max_motextr_xy/m_walk_fast_01',
  run: 'all_animations_max_motextr_xy/m_run_neutral_01',
  sprint: 'all_animations_max_motextr_xy/m_run_fast_01',
  injured: 'all_animations_max_motextr_xy/m_walk_bruised',
};

/** Poly Haven surfaces: id → [diffuse size, normal size, AO/rough/metal size]. */
export const TEXTURES = {
  // desert
  gravelly_sand: [2048, 2048, 1024],
  dense_sand: [1024, 1024, 1024],
  clay_plaster: [1024, 1024, 1024],
  rough_plaster_brick: [1024, 1024, 1024],
  sandstone_cracks: [1024, 1024, 1024],
  // port
  asphalt_02: [2048, 2048, 1024],
  concrete_floor_worn_001: [1024, 1024, 1024],
  container_side: [1024, 1024, 1024],
  corrugated_iron_02: [1024, 1024, 1024],
  rusty_corrugated_iron: [1024, 1024, 1024],
  rusty_metal_shutter: [1024, 1024, 1024],
  // snow
  snow_02: [2048, 2048, 1024],
  asphalt_snow: [1024, 1024, 1024],
  rock_face: [1024, 1024, 1024],
  // shared
  concrete_wall_008: [1024, 1024, 1024],
  weathered_planks: [1024, 1024, 1024],
  stained_pine: [1024, 1024, 512], // rifle furniture
  hessian_230: [1024, 1024, 1024],
  metal_plate: [1024, 1024, 1024],
  rusty_metal_02: [1024, 1024, 1024],
  // the pueblo: painted plaster, clay roofs, dirt streets, palms, tin
  white_stucco_02: [1024, 1024, 512],
  red_plaster_weathered: [1024, 1024, 512],
  blue_plaster_weathered: [1024, 1024, 512],
  yellow_plaster_02: [1024, 1024, 512],
  damaged_plaster: [1024, 1024, 512],
  clay_roof_tiles_02: [1024, 1024, 512],
  dirt: [2048, 2048, 1024],
  stony_dirt_path: [1024, 1024, 1024],
  cobblestone_floor_08: [2048, 2048, 1024],
  palm_tree_bark: [512, 512, 256],
  worn_corrugated_iron: [1024, 1024, 512],
};

/** Skies: sky-only HDRIs, used for lighting (small HDR) and as the backdrop (large LDR). */
export const SKIES = {
  desert: 'kloofendal_43d_clear_puresky',
  port: 'kloppenheim_02_puresky',
  snow: 'snow_field_puresky',
  menu: 'industrial_sunset_02_puresky',
};

/**
 * Props: id → { tris: triangle budget after simplification, tex: texture size }.
 * Anything heavier than its budget is decimated at build time.
 */
export const PROPS = {
  wooden_military_crate: { tris: 1600, tex: 1024 },
  old_military_crate: { tris: 1600, tex: 1024 },
  wooden_crate_01: { tris: 900, tex: 1024 },
  wooden_crate_02: { tris: 900, tex: 1024 },
  Barrel_01: { tris: 1200, tex: 1024 },
  Barrel_02: { tris: 1200, tex: 1024 },
  barrel_03: { tris: 1000, tex: 512 },
  concrete_road_barrier: { tris: 1200, tex: 1024 },
  concrete_road_barrier_02: { tris: 1200, tex: 1024 },
  metal_jerrycan: { tris: 600, tex: 512 },
  metal_jerrycan_green: { tris: 600, tex: 512 },
  old_tyre: { tris: 900, tex: 512 },
  propane_tank: { tris: 800, tex: 512 },
  cardboard_box_01: { tris: 300, tex: 512 },
  ammo_box: { tris: 600, tex: 512 },
  exterior_aircon_unit: { tris: 1600, tex: 1024 },
  street_lamp_01: { tris: 1500, tex: 512 },
  street_lamp_02: { tris: 1500, tex: 512 },
  quiver_tree_02: { tris: 4000, tex: 1024 },
  dead_quiver_trunk: { tris: 1500, tex: 1024 },
  shrub_02: { tris: 2500, tex: 1024 },
  shrub_03: { tris: 1800, tex: 1024 },
  shrub_04: { tris: 2500, tex: 1024 },
  dry_branches_medium_01: { tris: 1500, tex: 1024 },
  namaqualand_boulder_02: { tris: 2500, tex: 1024 },
  namaqualand_boulder_03: { tris: 2500, tex: 1024 },
  boulder_01: { tris: 2500, tex: 1024 },
  rock_07: { tris: 1200, tex: 1024 },
  rock_09: { tris: 800, tex: 1024 },
  dead_tree_trunk: { tris: 2000, tex: 1024 },
  plastic_crate_01: { tris: 900, tex: 512 },
  industrial_pastic_container: { tris: 700, tex: 1024 },
  metal_trash_can: { tris: 1200, tex: 512 },
  trashbag: { tris: 700, tex: 512 },
  fire_hydrant: { tris: 1200, tex: 512 },
  utility_box_01: { tris: 800, tex: 512 },
  power_box_01: { tris: 1200, tex: 512 },
  security_light: { tris: 700, tex: 512 },
  portable_generator: { tris: 2000, tex: 1024 },
  small_lpg_tank: { tris: 900, tex: 512 },
  old_military_compressor: { tris: 2500, tex: 1024 },
  portable_searchlight: { tris: 1200, tex: 512 },
  covered_car: { tris: 4000, tex: 1024 },
  hand_truck: { tris: 1500, tex: 512 },
  lifebuoy: { tris: 800, tex: 512 },
  service_pistol: { tris: 4000, tex: 1024 },
  bolt_action_rifle_7_62: { tris: 6000, tex: 1024 },
  old_gas_mask: { tris: 4000, tex: 1024 },
};

/** Only the textures of these models are used: needle and leaf cards for procedural trees. */
export const PROP_TEXTURES_ONLY = ['fir_sapling'];
