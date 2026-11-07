export const GAME_CONFIG = {
  LOGICAL_HEIGHT: 270,
  TILE: 16,
  WORLD_WIDTH: 960,
  WORLD_HEIGHT: 544,
  PLAYER_SPEED: 104,
  PLAYER_RADIUS: 9,
  MAX_HEARTS: 3,
  ABILITY_COOLDOWN: 0.52,
  MAX_ENEMIES: 8,
  MAX_PROJECTILES: 48,
  MAX_PARTICLES: 160,
  CAMERA_LERP: 0.12,
  CONCERT_DURATION: 60,
  SAVE_VERSION: 1,
} as const;

export const INPUT_CONFIG = {
  JOYSTICK_DEAD_ZONE: 8,
  JOYSTICK_RANGE: 42,
  MOUSE_SENS_X: 0,
  MOUSE_SENS_Y: 0,
  INVERT_X: false,
  INVERT_Y: false,
} as const;

export const QUALITY = {
  PARTICLES_HIGH: 160,
  PARTICLES_LOW: 70,
  DEGRADE_FPS: 42,
} as const;

export const PALETTE = {
  ink: "#1c1323",
  deep: "#291a31",
  panel: "#35213e",
  cream: "#fff0df",
  pink: "#f06aa9",
  hotPink: "#ff91c8",
  purple: "#6c3f78",
  yellow: "#ffd166",
  green: "#82d9a5",
  red: "#ef5d73",
} as const;
