
export enum GameState {
  START,
  PLAYING,
  GAME_OVER,
  LEADERBOARD_INPUT,
  SHOP
}

export interface Point {
  x: number;
  y: number;
}

export interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  markedForDeletion: boolean;
}

export enum WeaponType {
  SINGLE,
  DOUBLE,  // Yeni
  HELIX,   // Yeni (Sarmal)
  SPREAD   // Mevcut (3'lü)
}

export interface Player extends Entity {
  vx: number;
  vy: number;
  speedY: number; 
  fuel: number;
  lives: number;
  score: number;
  gold: number;
  isInvulnerable: boolean;
  invulnerableTimer: number;
  weaponType: WeaponType;
  nukes: number;
}

export enum EnemyType {
  SHIP,
  HELICOPTER,
  JET,
  KAMIKAZE, // Yeni Hızlı Düşman
  FUEL_DEPOT,
  BRIDGE,
  LIFE_ORB, // Can toplamak için
  WEAPON_CRATE,
  GOLD_COIN,
  BOSS
}

export interface Enemy extends Entity {
  type: EnemyType;
  vx: number;
  vy: number;
  shootTimer: number; 
  hp: number;
  maxHp: number;
}

export interface Bullet extends Entity {
  vx: number;
  vy: number;
  isEnemy: boolean;
  pattern?: 'straight' | 'helix_left' | 'helix_right'; // Mermi hareket tipi
  initialX?: number; // Helix hareketi için merkez noktası
}

export interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export interface Explosion {
  x: number;
  y: number;
  particles: Particle[];
}

export interface LeaderboardEntry {
  name: string;
  score: number;
}

export enum DecorationType {
  TREE,
  HOUSE
}

export interface Decoration {
  x: number;
  y: number;
  type: DecorationType;
  variant: number;
  markedForDeletion: boolean;
}
