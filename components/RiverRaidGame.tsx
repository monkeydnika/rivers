import React, { useEffect, useRef, useState } from 'react';
import { GameState, Player, Enemy, EnemyType, Bullet, Particle, LeaderboardEntry, WeaponType, Decoration, DecorationType } from '../types';

// --- Constants ---
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 800;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 32;
const BASE_SCROLL_SPEED = 3; 
const MAX_FUEL = 100;
const FUEL_CONSUMPTION_RATE = 0.05;
const FUEL_REFILL_RATE = 0.8;
const RIVER_SEGMENT_HEIGHT = 20;
const MAX_LEADERBOARD_ENTRIES = 5;
const SHOOTING_START_FRAME = 1800; 
const BOSS_SPAWN_INTERVAL = 3600; // Every 60 seconds (60 * 60)

export const RiverRaidGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  // Re-render tetiklemek için UI state
  const [uiGameState, setUiGameState] = useState<GameState>(GameState.START);
  const [inputValue, setInputValue] = useState("");
  
  // Input Controls State - DEFAULT CHANGED TO BUTTONS
  const [controlMode, setControlMode] = useState<'JOYSTICK' | 'BUTTONS'>('BUTTONS');

  // Joystick State
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState(false);
  const joystickContainerRef = useRef<HTMLDivElement>(null);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  const state = useRef({
    gameState: GameState.START,
    keys: {} as { [key: string]: boolean },
    player: {
      x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
      y: CANVAS_HEIGHT - 120,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      vx: 0,
      vy: 0,
      speedY: 0,
      fuel: MAX_FUEL,
      lives: 3,
      score: 0,
      gold: 0,
      isInvulnerable: false,
      invulnerableTimer: 0,
      markedForDeletion: false,
      weaponType: WeaponType.SINGLE,
    } as Player,
    bullets: [] as Bullet[],
    enemies: [] as Enemy[],
    particles: [] as Particle[],
    riverSegments: [] as { y: number, centerX: number, width: number }[],
    decorations: [] as Decoration[],
    distanceCounter: 0, 
    enemySpawnTimer: 0,
    gameFrameCount: 0, 
    difficulty: 1.0,
    highScores: [] as LeaderboardEntry[],
    playerNameInput: "",
    bossActive: false,
  });

  // --- Audio System ---
  const initAudio = () => {
      if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
      }
  };

  const playShootSound = () => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      // Atari-style Pew: Square wave dropping in frequency
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
  };

  const playExplosionSound = () => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      // Atari-style Boom: Sawtooth or Square low freq rumble
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      osc.start();
      osc.stop(ctx.currentTime + 0.2);
  };

  const playCollectSound = () => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1800, ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
  };

  // --- Helpers ---
  const loadHighScores = () => {
    const stored = localStorage.getItem('riverRaidScores');
    if (stored) {
      state.current.highScores = JSON.parse(stored);
    } else {
      state.current.highScores = [
        { name: "ACE", score: 5000 },
        { name: "PIL", score: 3000 },
        { name: "CPU", score: 1000 },
      ];
    }
  };

  const saveHighScores = () => {
    localStorage.setItem('riverRaidScores', JSON.stringify(state.current.highScores));
  };

  const loadGold = (): number => {
      const stored = localStorage.getItem('riverRaidGold');
      return stored ? parseInt(stored, 10) : 0;
  };

  const saveGold = (amount: number) => {
      localStorage.setItem('riverRaidGold', amount.toString());
  };

  // --- Mobile Input Helpers ---
  const handleTouchStart = (key: string) => {
    initAudio(); // Initialize audio on first touch
    if (state.current.gameState === GameState.LEADERBOARD_INPUT) return; 

    state.current.keys[key] = true;
    
    if (key === 'KeyM') {
        if (state.current.gameState === GameState.PLAYING) {
            state.current.gameState = GameState.SHOP;
            setUiGameState(GameState.SHOP);
        } else if (state.current.gameState === GameState.SHOP) {
            state.current.gameState = GameState.PLAYING;
            setUiGameState(GameState.PLAYING);
        }
    }
    
    if (state.current.gameState === GameState.START && key === 'Space') {
        initGame(true);
    }
    
    if (state.current.gameState === GameState.GAME_OVER && key === 'KeyR') {
        initGame(true);
    }

    if (state.current.gameState === GameState.PLAYING && key === 'Space') {
        fireBullet();
    }
  };

  const handleTouchEnd = (key: string) => {
    state.current.keys[key] = false;
  };

  // Joystick Logic
  const handleJoystickStart = (e: React.TouchEvent) => {
    initAudio(); // Initialize audio
    if (state.current.gameState !== GameState.PLAYING) return;
    setIsJoystickActive(true);
    updateJoystick(e);
  };

  const handleJoystickMove = (e: React.TouchEvent) => {
    if (!isJoystickActive) return;
    updateJoystick(e);
  };

  const handleJoystickEnd = () => {
    setIsJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    state.current.keys['ArrowLeft'] = false;
    state.current.keys['ArrowRight'] = false;
    state.current.keys['ArrowUp'] = false;
    state.current.keys['ArrowDown'] = false;
  };

  const updateJoystick = (e: React.TouchEvent) => {
     if (!joystickContainerRef.current) return;
     const touch = e.touches[0];
     const rect = joystickContainerRef.current.getBoundingClientRect();
     const centerX = rect.left + rect.width / 2;
     const centerY = rect.top + rect.height / 2;
     
     const dx = touch.clientX - centerX;
     const dy = touch.clientY - centerY;
     const distance = Math.sqrt(dx*dx + dy*dy);
     const maxRadius = rect.width / 2 - 15; // Knob radius offset
     
     let clampedX = dx;
     let clampedY = dy;
     
     if (distance > maxRadius) {
         const angle = Math.atan2(dy, dx);
         clampedX = Math.cos(angle) * maxRadius;
         clampedY = Math.sin(angle) * maxRadius;
     }
     
     setJoystickPos({ x: clampedX, y: clampedY });

     // Map to keys with REDUCED SENSITIVITY (Higher Deadzone)
     const deadzone = 25; 
     state.current.keys['ArrowLeft'] = clampedX < -deadzone;
     state.current.keys['ArrowRight'] = clampedX > deadzone;
     state.current.keys['ArrowUp'] = clampedY < -deadzone;
     state.current.keys['ArrowDown'] = clampedY > deadzone;
  };

  const fireBullet = () => {
      const s = state.current;
      playShootSound(); // Sound Effect
      if (s.player.weaponType === WeaponType.SPREAD) {
        s.bullets.push(
            { x: s.player.x + s.player.width / 2 - 2, y: s.player.y, width: 4, height: 10, vx: 0, vy: 10, isEnemy: false, markedForDeletion: false },
            { x: s.player.x, y: s.player.y + 5, width: 4, height: 10, vx: -3, vy: 9, isEnemy: false, markedForDeletion: false },
            { x: s.player.x + s.player.width, y: s.player.y + 5, width: 4, height: 10, vx: 3, vy: 9, isEnemy: false, markedForDeletion: false }
        );
    } else {
        s.bullets.push({
            x: s.player.x + s.player.width / 2 - 2,
            y: s.player.y,
            width: 4,
            height: 10,
            vx: 0,
            vy: 10,
            isEnemy: false,
            markedForDeletion: false
        });
    }
  }

  // --- Game Engine Methods ---

  const initGame = (fullReset: boolean = false) => {
    initAudio(); // Ensure audio is ready
    const s = state.current;
    loadHighScores();
    s.player.gold = loadGold(); 
    
    if (fullReset) {
      s.player.lives = 3;
      s.player.score = 0;
      s.distanceCounter = 0;
      s.gameFrameCount = 0;
      s.difficulty = 1.0;
      s.playerNameInput = "";
      s.bossActive = false;
      setInputValue("");
    }

    s.player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
    s.player.y = CANVAS_HEIGHT - 120;
    s.player.fuel = MAX_FUEL;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.isInvulnerable = true;
    s.player.invulnerableTimer = 120; 
    s.player.weaponType = WeaponType.SINGLE; 
    
    s.bullets = [];
    s.enemies = [];
    s.particles = [];
    s.decorations = [];
    s.keys = {};
    s.enemySpawnTimer = 0;

    s.riverSegments = [];
    for (let y = CANVAS_HEIGHT; y > -RIVER_SEGMENT_HEIGHT * 5; y -= RIVER_SEGMENT_HEIGHT) {
      addRiverSegment(y);
    }
    
    s.gameState = GameState.PLAYING;
    setUiGameState(GameState.PLAYING);
  };

  const addRiverSegment = (yPos: number) => {
    const s = state.current;
    s.distanceCounter++; 

    const t = s.distanceCounter * 0.05; 
    const difficultyNarrowing = Math.min(40, (s.difficulty - 1) * 10);
    
    const center = (CANVAS_WIDTH / 2) + Math.sin(t) * 100 + Math.sin(t * 0.5) * 40;
    let width = 340 + Math.cos(t * 1.3) * 80 - difficultyNarrowing;
    width = Math.max(220, Math.min(width, CANVAS_WIDTH - 40));
    
    const segmentX = Math.max(width / 2 + 20, Math.min(center, CANVAS_WIDTH - width / 2 - 20));

    s.riverSegments.unshift({ 
      y: yPos, 
      centerX: segmentX,
      width: width
    });

    // Decorations
    const leftBankEnd = segmentX - width / 2;
    if (leftBankEnd > 40 && Math.random() < 0.3) {
        const type = Math.random() > 0.9 ? DecorationType.HOUSE : DecorationType.TREE;
        const variant = Math.floor(Math.random() * 3); // 0, 1, or 2
        s.decorations.push({
            x: Math.random() * (leftBankEnd - 30),
            y: yPos,
            type: type,
            variant: variant,
            markedForDeletion: false
        });
    }

    const rightBankStart = segmentX + width / 2;
    if (CANVAS_WIDTH - rightBankStart > 40 && Math.random() < 0.3) {
        const type = Math.random() > 0.9 ? DecorationType.HOUSE : DecorationType.TREE;
        const variant = Math.floor(Math.random() * 3); // 0, 1, or 2
        s.decorations.push({
            x: rightBankStart + Math.random() * (CANVAS_WIDTH - rightBankStart - 30),
            y: yPos,
            type: type,
            variant: variant,
            markedForDeletion: false
        });
    }
  };

  const spawnBoss = () => {
    const s = state.current;
    // Calculate HP: Starts at 5 (at frame 3600), increases by 2 every subsequent boss (every 3600 frames = 2 steps of 1800)
    // Frame 3600 / 1800 = 2.  3 + 2 = 5 HP.
    // Frame 7200 / 1800 = 4.  3 + 4 = 7 HP.
    const difficultyStep = Math.floor(s.gameFrameCount / 1800);
    const hp = 3 + difficultyStep;

    s.bossActive = true;
    s.enemies.push({
        type: EnemyType.BOSS,
        x: CANVAS_WIDTH / 2 - 40,
        y: -100, // Start above screen
        width: 80,
        height: 60,
        vx: 2,
        vy: 1, 
        hp: hp,
        maxHp: hp,
        shootTimer: 60,
        markedForDeletion: false
    });
    // Announcement effect
    createExplosion(CANVAS_WIDTH/2, 100, '#ef4444', 20);
  };

  const spawnEnemy = (riverSegment: { y: number, centerX: number, width: number }) => {
      const s = state.current;
      // Don't spawn normal enemies if boss is active (except powerups rarely)
      if (s.bossActive && Math.random() > 0.1) return;

      const typeRoll = Math.random();
      let type = EnemyType.SHIP;
      let width = 30;
      let height = 15;
      let speedX = 0;
      let speedY = 0; 

      if (typeRoll < 0.05) {
          type = EnemyType.LIFE_ORB; width = 20; height = 20; speedY = 0;
      }
      else if (typeRoll < 0.08) {
          type = EnemyType.WEAPON_CRATE; width = 25; height = 25; speedY = 0;
      }
      else if (typeRoll < 0.23) {
          type = EnemyType.GOLD_COIN; width = 20; height = 20; speedY = 0;
      }
      else if (typeRoll < 0.38) {
        type = EnemyType.FUEL_DEPOT; width = 25; height = 40; speedY = 0; 
      } 
      else if (typeRoll < 0.68) {
        type = EnemyType.HELICOPTER; width = 30; height = 30;
        speedX = (Math.random() - 0.5) * (3 * s.difficulty); 
        speedY = 1; 
      } 
      else {
        if (Math.random() > 0.7) {
             type = EnemyType.JET; width = 25; height = 25;
             speedX = 0; speedY = 5 * s.difficulty;
        } else {
             type = EnemyType.SHIP; width = 40; height = 20;
             speedX = (Math.random() - 0.5) * (0.8 * s.difficulty); 
             speedY = 0.5;
        }
      }

      const minX = riverSegment.centerX - riverSegment.width / 2 + 20;
      const maxX = riverSegment.centerX + riverSegment.width / 2 - 20 - width;
      
      if (maxX <= minX) return;

      const x = minX + Math.random() * (maxX - minX);

      s.enemies.push({
        type,
        x,
        y: riverSegment.y,
        width,
        height,
        vx: speedX,
        vy: speedY, 
        hp: 1,
        maxHp: 1,
        shootTimer: Math.floor(Math.random() * 60 + 60), 
        markedForDeletion: false
      });
  };

  // --- Market Logic ---
  const buyItem = (itemIndex: number) => {
      const s = state.current;
      let cost = 0;
      let success = false;

      // Prices reduced by 50%
      switch(itemIndex) {
          case 1: // Refill Fuel
              cost = 5;
              if (s.player.gold >= cost) {
                  s.player.fuel = MAX_FUEL;
                  playCollectSound();
                  success = true;
              }
              break;
          case 2: // Shield (10s)
              cost = 10;
              if (s.player.gold >= cost) {
                  s.player.isInvulnerable = true;
                  s.player.invulnerableTimer = 600;
                  playCollectSound();
                  success = true;
              }
              break;
          case 3: // Spread Gun
              cost = 15;
              if (s.player.gold >= cost) {
                  s.player.weaponType = WeaponType.SPREAD;
                  playCollectSound();
                  success = true;
              }
              break;
          case 4: // Nuke
              cost = 25;
              if (s.player.gold >= cost) {
                  s.enemies.forEach(e => {
                      if (e.type !== EnemyType.GOLD_COIN && e.type !== EnemyType.FUEL_DEPOT && e.type !== EnemyType.LIFE_ORB && e.type !== EnemyType.WEAPON_CRATE && e.type !== EnemyType.BOSS) {
                          if (e.y > 0 && e.y < CANVAS_HEIGHT) {
                              e.markedForDeletion = true;
                              createExplosion(e.x + e.width/2, e.y + e.height/2, 'orange', 15);
                              s.player.score += 50;
                          }
                      }
                      if (e.type === EnemyType.BOSS) {
                          e.hp -= 20; // Nuke damages boss
                          createExplosion(e.x + e.width/2, e.y + e.height/2, 'orange', 30);
                      }
                  });
                  s.bullets.forEach(b => b.markedForDeletion = true);
                  createExplosion(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 'white', 100);
                  success = true;
              }
              break;
      }

      if (success) {
          s.player.gold -= cost;
          saveGold(s.player.gold);
      }
  };

  // --- Update Loop ---

  const update = () => {
    const s = state.current;
    if (s.gameState !== GameState.PLAYING) return;

    s.gameFrameCount++;

    // Time Bonus & Difficulty Increase
    // CHANGED: Slowed down difficulty progression significantly (30s instead of 7.5s)
    if (s.gameFrameCount % 1800 === 0 && s.gameFrameCount > 0) {
        const difficultyStep = Math.floor(s.gameFrameCount / 1800);
        s.difficulty = 1.0 + (difficultyStep * 0.1); 
        
        s.player.score += 500;
        // Small celebration for difficulty up, but check if boss is spawning
        if (s.gameFrameCount % BOSS_SPAWN_INTERVAL !== 0) {
            createExplosion(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, '#fbbf24', 40);
        }
    }

    // Boss Spawn Logic
    if (s.gameFrameCount % BOSS_SPAWN_INTERVAL === 0 && !s.bossActive) {
        spawnBoss();
    }

    const currentScrollSpeed = BASE_SCROLL_SPEED * Math.min(2.0, s.difficulty);

    // 1. Player Controls
    // Reduced speed from 5 to 3.5
    const playerSpeed = 3.5 * Math.min(1.5, s.difficulty);
    if (s.keys['ArrowLeft']) s.player.vx = -playerSpeed;
    else if (s.keys['ArrowRight']) s.player.vx = playerSpeed;
    else s.player.vx = 0;

    if (s.keys['ArrowUp']) s.player.vy = -playerSpeed; 
    else if (s.keys['ArrowDown']) s.player.vy = playerSpeed; 
    else s.player.vy = 0;

    s.player.x += s.player.vx;
    s.player.y += s.player.vy;

    if (s.player.y < 0) s.player.y = 0;
    if (s.player.y > CANVAS_HEIGHT - s.player.height) s.player.y = CANVAS_HEIGHT - s.player.height;

    s.player.fuel -= FUEL_CONSUMPTION_RATE;
    if (s.player.fuel <= 0) {
      handleDeath("OUT OF FUEL");
      return;
    }

    if (s.player.isInvulnerable) {
      s.player.invulnerableTimer--;
      if (s.player.invulnerableTimer <= 0) s.player.isInvulnerable = false;
    }

    // 2. Map Scrolling & Decorations
    for (let i = 0; i < s.riverSegments.length; i++) {
      s.riverSegments[i].y += currentScrollSpeed;
    }
    if (s.riverSegments.length > 0 && s.riverSegments[s.riverSegments.length - 1].y > CANVAS_HEIGHT) {
      s.riverSegments.pop();
    }

    for (let i = 0; i < s.decorations.length; i++) {
        s.decorations[i].y += currentScrollSpeed;
        if (s.decorations[i].y > CANVAS_HEIGHT) {
            s.decorations[i].markedForDeletion = true;
        }
    }
    s.decorations = s.decorations.filter(d => !d.markedForDeletion);


    const topSegment = s.riverSegments[0];
    if (topSegment && topSegment.y > -RIVER_SEGMENT_HEIGHT) {
      addRiverSegment(topSegment.y - RIVER_SEGMENT_HEIGHT);
      
      s.enemySpawnTimer++;
      const spawnThreshold = Math.max(2, 5 - (s.difficulty * 0.5));
      if (s.enemySpawnTimer > spawnThreshold) { 
        if (Math.random() < Math.min(0.8, 0.3 * s.difficulty)) {
            spawnEnemy(s.riverSegments[0]);
        }
        s.enemySpawnTimer = 0;
      }
    }

    // 3. Update Entities
    s.enemies.forEach(enemy => {
      
      if (enemy.type === EnemyType.BOSS) {
          // Boss Logic:
          // Stay near top of screen (y = 80-120), oscillate X
          if (enemy.y < 80) enemy.y += 2; // Fly in
          else enemy.y = 80 + Math.sin(s.gameFrameCount / 50) * 20;

          // Move X
          enemy.x += enemy.vx;
          if (enemy.x <= 20 || enemy.x + enemy.width >= CANVAS_WIDTH - 20) {
              enemy.vx *= -1;
          }

          // Boss Shooting
          enemy.shootTimer--;
          if (enemy.shootTimer <= 0) {
             const bulletSpeed = 5 + s.difficulty;
             // Spread shot
             s.bullets.push(
                { x: enemy.x + enemy.width / 2, y: enemy.y + enemy.height, width: 8, height: 12, vx: 0, vy: -bulletSpeed, isEnemy: true, markedForDeletion: false },
                { x: enemy.x + enemy.width / 2, y: enemy.y + enemy.height, width: 8, height: 12, vx: -2, vy: -bulletSpeed * 0.9, isEnemy: true, markedForDeletion: false },
                { x: enemy.x + enemy.width / 2, y: enemy.y + enemy.height, width: 8, height: 12, vx: 2, vy: -bulletSpeed * 0.9, isEnemy: true, markedForDeletion: false }
             );
             enemy.shootTimer = Math.max(60, 100 - (s.difficulty * 10)); // Fires faster as difficulty goes up
          }
      } else {
        // Standard Enemy Movement
        enemy.y += currentScrollSpeed + (enemy.vy || 0);
        enemy.x += enemy.vx;

        if (enemy.type === EnemyType.HELICOPTER) {
           if (enemy.x <= 50 || enemy.x + enemy.width >= CANVAS_WIDTH - 50) enemy.vx *= -1;
        }

        // Standard Shooting Logic
        if (s.gameFrameCount > SHOOTING_START_FRAME) {
            if (enemy.y > 0 && enemy.y < CANVAS_HEIGHT - 100) { 
               if (enemy.type === EnemyType.SHIP || enemy.type === EnemyType.HELICOPTER || enemy.type === EnemyType.JET) {
                   enemy.shootTimer--;
                   if (enemy.shootTimer <= 0) {
                       const bulletSpeed = 4 + s.difficulty;
                       s.bullets.push({
                           x: enemy.x + enemy.width / 2 - 3,
                           y: enemy.y + enemy.height,
                           width: 6,
                           height: 6,
                           vx: 0,
                           vy: -bulletSpeed, 
                           isEnemy: true,
                           markedForDeletion: false
                       });
                       enemy.shootTimer = Math.max(30, 120 - (s.difficulty * 20));
                   }
               }
            }
        }
      }
      
      if (enemy.y > CANVAS_HEIGHT) enemy.markedForDeletion = true;
    });
    
    // Check if boss was deleted
    if (s.bossActive && !s.enemies.some(e => e.type === EnemyType.BOSS)) {
        s.bossActive = false;
    }
    
    s.enemies = s.enemies.filter(e => !e.markedForDeletion);

    // Bullets Movement
    s.bullets.forEach(bullet => {
      bullet.y -= bullet.vy; 
      bullet.x += bullet.vx || 0; 
      
      if (bullet.isEnemy) {
          if (bullet.y > CANVAS_HEIGHT) bullet.markedForDeletion = true;
      } else {
          if (bullet.y < 0 || bullet.x < 0 || bullet.x > CANVAS_WIDTH) bullet.markedForDeletion = true;
      }
    });

    // Bullet Neutralization
    for (let i = 0; i < s.bullets.length; i++) {
        const b1 = s.bullets[i];
        if (b1.markedForDeletion) continue;

        for (let j = i + 1; j < s.bullets.length; j++) {
            const b2 = s.bullets[j];
            if (b2.markedForDeletion) continue;

            if (b1.isEnemy !== b2.isEnemy) {
                if (checkCollision(b1, b2)) {
                    b1.markedForDeletion = true;
                    b2.markedForDeletion = true;
                    createExplosion((b1.x + b2.x) / 2, (b1.y + b2.y) / 2, '#9ca3af', 6);
                }
            }
        }
    }

    s.bullets = s.bullets.filter(b => !b.markedForDeletion);

    // Particles
    s.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy + currentScrollSpeed;
      p.life--;
      if (p.life <= 0) p.markedForDeletion = true;
    });
    s.particles = s.particles.filter(p => !p.markedForDeletion);


    // 4. Collision Detection

    // River Banks
    const playerSegment = s.riverSegments.find(seg => 
      s.player.y + s.player.height/2 >= seg.y && s.player.y + s.player.height/2 < seg.y + RIVER_SEGMENT_HEIGHT
    );

    if (playerSegment && !s.player.isInvulnerable) {
      const bankLeft = playerSegment.centerX - playerSegment.width / 2;
      const bankRight = playerSegment.centerX + playerSegment.width / 2;

      if (s.player.x < bankLeft || s.player.x + s.player.width > bankRight) {
        handleDeath("CRASHED INTO LAND");
        return;
      }
    }

    s.enemies.forEach(enemy => {
      if (checkCollision(s.player, enemy)) {
        if (enemy.type === EnemyType.FUEL_DEPOT) {
           s.player.fuel = Math.min(s.player.fuel + FUEL_REFILL_RATE * 30, MAX_FUEL);
           playCollectSound();
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.GOLD_COIN) {
           s.player.gold++;
           s.player.score += 50;
           saveGold(s.player.gold);
           playCollectSound();
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.LIFE_ORB) {
           s.player.lives++;
           s.player.score += 100;
           playCollectSound();
           createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, '#ec4899', 20);
           enemy.markedForDeletion = true;
        } else if (enemy.type === EnemyType.WEAPON_CRATE) {
           s.player.weaponType = WeaponType.SPREAD;
           s.player.score += 100;
           playCollectSound();
           createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, '#06b6d4', 20);
           enemy.markedForDeletion = true;
        } else if (enemy.type !== EnemyType.BRIDGE) {
           // Boss crash collision
           if (enemy.type === EnemyType.BOSS) {
               if (!s.player.isInvulnerable) handleDeath("CRASHED INTO BOSS");
           } else {
               createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2);
               enemy.markedForDeletion = true;
               if (!s.player.isInvulnerable) handleDeath("CRASHED INTO ENEMY");
           }
        }
      }
    });

    s.bullets.forEach(bullet => {
      if (bullet.markedForDeletion) return;

      if (bullet.isEnemy) {
          if (!s.player.isInvulnerable && checkCollision(bullet, s.player)) {
             bullet.markedForDeletion = true;
             handleDeath("SHOT BY ENEMY");
          }
      } else {
          s.enemies.forEach(enemy => {
            if (!bullet.markedForDeletion && !enemy.markedForDeletion && checkCollision(bullet, enemy)) {
              if (enemy.type === EnemyType.FUEL_DEPOT) {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y, 'orange');
                 s.player.score += 150; 
              } else if (enemy.type === EnemyType.LIFE_ORB || enemy.type === EnemyType.WEAPON_CRATE || enemy.type === EnemyType.GOLD_COIN) {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y, 'white');
                 s.player.score += 10; 
              } else if (enemy.type === EnemyType.BOSS) {
                 // Boss Damage Logic
                 bullet.markedForDeletion = true;
                 enemy.hp--;
                 // Small sparkle on hit
                 createExplosion(bullet.x, bullet.y, '#fff', 2);
                 if (enemy.hp <= 0) {
                     enemy.markedForDeletion = true;
                     createExplosion(enemy.x + enemy.width/2, enemy.y + enemy.height/2, '#facc15', 100);
                     playExplosionSound();
                     s.player.score += 5000;
                     s.player.gold += 50; // Big money reward
                     s.bossActive = false;
                 }
              } else {
                 bullet.markedForDeletion = true;
                 enemy.markedForDeletion = true;
                 createExplosion(enemy.x, enemy.y);
                 s.player.score += 100;
              }
            }
          });
      }
    });
  };

  const handleDeath = (reason: string) => {
    const s = state.current;
    createExplosion(s.player.x, s.player.y, 'red', 50);
    playExplosionSound(); // Boom!
    s.player.lives--;
    if (s.player.lives > 0) {
      s.player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
      s.player.y = CANVAS_HEIGHT - 120;
      s.player.vx = 0;
      s.player.vy = 0;
      s.player.isInvulnerable = true;
      s.player.invulnerableTimer = 120;
      s.player.fuel = MAX_FUEL;
      s.player.weaponType = WeaponType.SINGLE;
      // Clear bullets but maybe keep enemies
      s.bullets = []; 
    } else {
      checkHighScore();
    }
  };

  const checkHighScore = () => {
    const s = state.current;
    const lowestHigh = s.highScores.length < MAX_LEADERBOARD_ENTRIES ? 0 : s.highScores[s.highScores.length - 1].score;
    if (s.player.score > lowestHigh || s.highScores.length < MAX_LEADERBOARD_ENTRIES) {
        s.gameState = GameState.LEADERBOARD_INPUT;
        setUiGameState(GameState.LEADERBOARD_INPUT);
        s.playerNameInput = "";
        setInputValue("");
    } else {
        s.gameState = GameState.GAME_OVER;
        setUiGameState(GameState.GAME_OVER);
    }
  };

  const submitHighScore = (name: string) => {
      const s = state.current;
      const finalName = name.trim().toUpperCase() || "UNK";
      s.highScores.push({ name: finalName, score: s.player.score });
      s.highScores.sort((a, b) => b.score - a.score);
      if (s.highScores.length > MAX_LEADERBOARD_ENTRIES) {
          s.highScores.pop();
      }
      saveHighScores();
      s.gameState = GameState.GAME_OVER;
      setUiGameState(GameState.GAME_OVER);
  };

  const createExplosion = (x: number, y: number, color: string = 'white', count: number = 10) => {
     if (count > 20) playExplosionSound(); // Play sound for big explosions
     for(let i=0; i<count; i++) {
       state.current.particles.push({
         x, 
         y,
         vx: (Math.random() - 0.5) * 10,
         vy: (Math.random() - 0.5) * 10,
         life: 20 + Math.random() * 20,
         color: color,
         size: Math.random() * 4 + 2,
         width: 0, height: 0, markedForDeletion: false
       });
     }
  };

  const checkCollision = (r1: {x:number, y:number, width:number, height:number}, r2: {x:number, y:number, width:number, height:number}) => {
    return (
      r1.x < r2.x + r2.width &&
      r1.x + r1.width > r2.x &&
      r1.y < r2.y + r2.height &&
      r1.y + r1.height > r2.y
    );
  };

  // --- Rendering ---

  const draw = (ctx: CanvasRenderingContext2D) => {
    const s = state.current;

    // Background
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // River
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    if (s.riverSegments.length > 0) {
      const sortedSegments = [...s.riverSegments].sort((a, b) => a.y - b.y);
      if (sortedSegments.length > 0) {
          const top = sortedSegments[0];
          ctx.moveTo(top.centerX - top.width/2, top.y);
          for (let seg of sortedSegments) ctx.lineTo(seg.centerX - seg.width/2, seg.y);
          const last = sortedSegments[sortedSegments.length-1];
          ctx.lineTo(last.centerX - last.width/2, last.y + RIVER_SEGMENT_HEIGHT);
          ctx.lineTo(last.centerX + last.width/2, last.y + RIVER_SEGMENT_HEIGHT);
          for (let i = sortedSegments.length - 1; i >= 0; i--) {
              const seg = sortedSegments[i];
              ctx.lineTo(seg.centerX + seg.width/2, seg.y);
          }
          ctx.lineTo(top.centerX + top.width/2, top.y);
      }
    }
    ctx.closePath();
    ctx.fill();

    // Decorations
    s.decorations.forEach(d => {
        if (d.type === DecorationType.TREE) {
            ctx.fillStyle = '#064e3b'; // Dark Green
            if (d.variant === 1) ctx.fillStyle = '#166534'; // Lighter Green for Oak
            if (d.variant === 2) ctx.fillStyle = '#0f3925'; // Very Dark for Pine

            if (d.variant === 1) {
                // Round Tree (Oak)
                ctx.beginPath();
                ctx.arc(d.x + 10, d.y + 10, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#3f2c22'; // Trunk
                ctx.fillRect(d.x + 8, d.y + 20, 4, 8);
            } else if (d.variant === 2) {
                // Tall Skinny Pine
                ctx.beginPath();
                ctx.moveTo(d.x + 10, d.y - 10);
                ctx.lineTo(d.x + 18, d.y + 25);
                ctx.lineTo(d.x + 2, d.y + 25);
                ctx.fill();
            } else {
                // Standard Tree
                ctx.beginPath();
                ctx.moveTo(d.x + 10, d.y);
                ctx.lineTo(d.x + 20, d.y + 25);
                ctx.lineTo(d.x, d.y + 25);
                ctx.fill();
            }
        } else if (d.type === DecorationType.HOUSE) {
            const variant = d.variant || 0;
            
            // House Body
            if (variant === 1) ctx.fillStyle = '#e2e8f0'; // White
            else if (variant === 2) ctx.fillStyle = '#78716c'; // Stone/Grey
            else ctx.fillStyle = '#f8fafc'; // Default White
            
            ctx.fillRect(d.x, d.y + 10, 20, 15);
            
            // House Roof
            if (variant === 1) ctx.fillStyle = '#0ea5e9'; // Blue Roof
            else if (variant === 2) ctx.fillStyle = '#44403c'; // Dark Grey Roof
            else ctx.fillStyle = '#b91c1c'; // Red Roof

            ctx.beginPath();
            if (variant === 2) {
                // Flat/Slant Roof
                ctx.moveTo(d.x - 2, d.y + 5);
                ctx.lineTo(d.x + 22, d.y + 10);
                ctx.lineTo(d.x + 22, d.y + 2);
                ctx.lineTo(d.x - 2, d.y + 2);
            } else {
                // Triangle Roof
                ctx.moveTo(d.x + 10, d.y);
                ctx.lineTo(d.x + 24, d.y + 10);
                ctx.lineTo(d.x - 4, d.y + 10);
            }
            ctx.fill();
            
            // Door
            ctx.fillStyle = '#475569';
            ctx.fillRect(d.x + 8, d.y + 18, 4, 7);
        }
    });

    // Dynamic Enemy Colors based on Difficulty
    const getLevelIndex = () => Math.floor(s.difficulty - 1);
    
    // Entities
    s.enemies.forEach(e => {
      const lvl = getLevelIndex();

      if (e.type === EnemyType.SHIP) {
        const shipColors = ['#1e293b', '#7f1d1d', '#000000', '#312e81']; // Slate, Red, Black, Indigo
        const shipMain = shipColors[lvl % shipColors.length] || '#1e293b';
        
        ctx.fillStyle = shipMain;
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(e.x + 5, e.y - 5, 10, 5);
      } else if (e.type === EnemyType.HELICOPTER) {
        const heliColors = ['#be123c', '#15803d', '#1d4ed8', '#a21caf']; // Red, Green, Blue, Magenta
        const heliMain = heliColors[lvl % heliColors.length] || '#be123c';

        ctx.fillStyle = heliMain;
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#000';
        ctx.fillRect(e.x - 5, e.y, e.width + 10, 2);
        if (Math.floor(Date.now()/50)%2===0) {
            ctx.fillRect(e.x - 10, e.y - 5, e.width + 20, 2);
        } else {
            ctx.fillRect(e.x, e.y - 5, e.width, 2);
        }
      } else if (e.type === EnemyType.JET) {
        const jetColors = ['#7c3aed', '#c2410c', '#0ea5e9', '#4d7c0f']; // Purple, Orange, Sky, Green
        const jetMain = jetColors[lvl % jetColors.length] || '#7c3aed';

        ctx.fillStyle = jetMain;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.width, e.y); ctx.lineTo(e.x + e.width/2, e.y + e.height);
        ctx.fill();
      } else if (e.type === EnemyType.BOSS) {
        // Draw BOSS
        ctx.fillStyle = '#1e1b4b'; // Dark Indigo
        ctx.beginPath();
        // Big Wings
        ctx.moveTo(e.x, e.y + 20);
        ctx.lineTo(e.x + e.width, e.y + 20);
        ctx.lineTo(e.x + e.width/2, e.y + e.height);
        ctx.fill();
        // Body
        ctx.fillStyle = '#4c1d95';
        ctx.fillRect(e.x + e.width/2 - 15, e.y, 30, e.height - 10);
        // Cockpit
        ctx.fillStyle = '#facc15';
        ctx.fillRect(e.x + e.width/2 - 5, e.y + 40, 10, 10);

        // HP Bar
        const hpPct = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'red';
        ctx.fillRect(e.x, e.y - 10, e.width, 5);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(e.x, e.y - 10, e.width * hpPct, 5);

      } else if (e.type === EnemyType.FUEL_DEPOT) {
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.fillText("FUEL", e.x, e.y + 12);
      } else if (e.type === EnemyType.WEAPON_CRATE) {
        ctx.fillStyle = '#06b6d4';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.fillText("W", e.x + 5, e.y + 18);
      } else if (e.type === EnemyType.LIFE_ORB) {
        ctx.fillStyle = '#ec4899';
        ctx.beginPath();
        ctx.arc(e.x + e.width/2, e.y + e.height/2, e.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.fillText("♥", e.x + 5, e.y + 15);
      } else if (e.type === EnemyType.GOLD_COIN) {
        ctx.fillStyle = '#facc15'; 
        ctx.beginPath();
        ctx.arc(e.x + e.width/2, e.y + e.height/2, e.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#b45309';
        ctx.font = '12px sans-serif';
        ctx.fillText("$", e.x + 6, e.y + 14);
      } else if (e.type === EnemyType.BRIDGE) {
        ctx.fillStyle = '#57534e';
        ctx.fillRect(e.x, e.y, e.width, e.height);
        ctx.strokeStyle = '#292524';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.x, e.y, e.width, e.height);
        ctx.fillStyle = '#facc15';
        for(let i=0; i<e.width; i+=40) ctx.fillRect(e.x + i, e.y + 13, 20, 4);
      }
    });

    // Player
    if (!s.player.isInvulnerable || Math.floor(Date.now() / 100) % 2 === 0) {
        // Change color every minute (approx 3600 frames at 60fps)
        const planeColors = [
            '#fbbf24', // Amber (Default)
            '#ffffff', // White (Visible on river)
            '#ef4444', // Red
            '#4ade80', // Bright Green
            '#a855f7', // Purple
            '#ec4899', // Pink
            '#22d3ee', // Cyan
            '#f97316', // Orange
        ];
        const colorIndex = Math.floor(s.gameFrameCount / 3600) % planeColors.length;
        ctx.fillStyle = planeColors[colorIndex];

        ctx.beginPath();
        ctx.moveTo(s.player.x + s.player.width/2, s.player.y);
        ctx.lineTo(s.player.x + s.player.width, s.player.y + s.player.height);
        ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height - 10);
        ctx.lineTo(s.player.x, s.player.y + s.player.height);
        ctx.closePath();
        ctx.fill();
        
        if (s.keys['ArrowUp']) {
             ctx.fillStyle = `rgba(255, 150, 0, ${Math.random()})`;
             ctx.beginPath();
             ctx.moveTo(s.player.x + s.player.width/2 - 5, s.player.y + s.player.height - 5);
             ctx.lineTo(s.player.x + s.player.width/2 + 5, s.player.y + s.player.height - 5);
             ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height + 25);
             ctx.fill();
        }
    }

    // Bullets
    s.bullets.forEach(b => {
      if (b.isEnemy) {
          ctx.fillStyle = '#f97316'; 
          ctx.fillRect(b.x, b.y, b.width, b.height);
      } else {
          ctx.fillStyle = '#fff';
          ctx.fillRect(b.x, b.y, b.width, b.height);
      }
    });

    // Particles
    s.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });

    // UI - Fuel Bar (Moved to Top)
    const barWidth = CANVAS_WIDTH - 40;
    const barHeight = 10;
    const barX = 20;
    const barY = 10; // Very Top
    
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    
    const fuelPct = Math.max(0, s.player.fuel / MAX_FUEL);
    ctx.fillStyle = fuelPct < 0.2 ? '#ef4444' : '#22c55e';
    ctx.fillRect(barX + 2, barY + 2, (barWidth - 4) * fuelPct, barHeight - 4);
    
    ctx.fillStyle = '#fff';
    ctx.font = '8px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText("FUEL", CANVAS_WIDTH/2, barY + 8);
    ctx.textAlign = 'left';

    // UI - Stats (Below Fuel Bar)
    ctx.fillStyle = '#fff';
    ctx.font = '12px "Press Start 2P"';
    ctx.fillText(`SCORE:${s.player.score}`, 20, 40);
    ctx.textAlign = 'right';
    ctx.fillText(`LIVES:${s.player.lives}`, CANVAS_WIDTH - 20, 40);
    ctx.textAlign = 'left';
    
    ctx.fillStyle = '#facc15';
    ctx.fillText(`GOLD:${s.player.gold}`, 20, 60);
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.fillText(`LVL:${s.difficulty.toFixed(1)}`, CANVAS_WIDTH - 20, 60);
    ctx.textAlign = 'left';

    // BOSS WARNING
    if (s.bossActive) {
        ctx.fillStyle = `rgba(255, 0, 0, ${0.5 + Math.sin(Date.now() / 100) * 0.5})`;
        ctx.font = '20px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText("BOSS BATTLE!", CANVAS_WIDTH/2, 100);
        ctx.textAlign = 'left';
    }

    // --- Screens ---
    if (s.gameState === GameState.SHOP) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4;
        ctx.strokeRect(50, 100, CANVAS_WIDTH - 100, CANVAS_HEIGHT - 200);
        ctx.fillStyle = '#facc15';
        ctx.font = '30px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText("MARKET", CANVAS_WIDTH/2, 160);
        ctx.font = '14px "Press Start 2P"';
        ctx.fillStyle = '#fff';
        ctx.fillText(`YOUR GOLD: ${s.player.gold}`, CANVAS_WIDTH/2, 200);
        const items = [
            { key: '1', name: 'FULL FUEL', cost: 5 },
            { key: '2', name: 'SHIELD (10s)', cost: 10 },
            { key: '3', name: 'SPREAD GUN', cost: 15 },
            { key: '4', name: 'NUKE BOMB', cost: 25 },
        ];
        let yPos = 280;
        items.forEach(item => {
            ctx.textAlign = 'left';
            ctx.fillStyle = s.player.gold >= item.cost ? '#4ade80' : '#9ca3af';
            ctx.fillText(`[${item.key}] ${item.name}`, 80, yPos);
            ctx.textAlign = 'right';
            ctx.fillText(`${item.cost} G`, CANVAS_WIDTH - 80, yPos);
            yPos += 60;
        });
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.font = '12px "Press Start 2P"';
        ctx.fillText("PRESS 'M' TO RESUME", CANVAS_WIDTH/2, CANVAS_HEIGHT - 140);
        ctx.textAlign = 'left';
    }
    else if (s.gameState === GameState.GAME_OVER) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.textAlign = 'center';
      
      ctx.fillStyle = '#ef4444';
      ctx.font = '40px "Press Start 2P"';
      ctx.fillText("GAME OVER", CANVAS_WIDTH/2, 150);
      ctx.fillStyle = '#fff';
      ctx.font = '20px "Press Start 2P"';
      ctx.fillText(`FINAL SCORE: ${s.player.score}`, CANVAS_WIDTH/2, 200);
      ctx.fillStyle = '#facc15';
      ctx.fillText("TOP SCORES", CANVAS_WIDTH/2, 280);
      ctx.font = '16px "Press Start 2P"';
      ctx.fillStyle = '#fff';
      let yOff = 320;
      s.highScores.forEach((entry, idx) => {
          ctx.textAlign = 'left';
          ctx.fillText(`${idx+1}. ${entry.name}`, CANVAS_WIDTH/2 - 100, yOff);
          ctx.textAlign = 'right';
          ctx.fillText(`${entry.score}`, CANVAS_WIDTH/2 + 100, yOff);
          yOff += 30;
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24'; 
      ctx.font = '15px "Press Start 2P"';
      ctx.fillText("PRESS 'R' TO RESTART", CANVAS_WIDTH/2, CANVAS_HEIGHT - 100);
      
      ctx.textAlign = 'left';
    } 
    // Draw Leaderboard Input Background (But text is handled by HTML overlay now)
    else if (s.gameState === GameState.LEADERBOARD_INPUT) {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#facc15';
        ctx.font = '30px "Press Start 2P"';
        ctx.fillText("NEW HIGH SCORE!", CANVAS_WIDTH/2, 200);
    }
    else if (s.gameState === GameState.START) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '20px "Press Start 2P"';
      ctx.textAlign = 'center';
      ctx.fillText("PRESS SPACE TO START", CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
      ctx.font = '12px "Press Start 2P"';
      ctx.fillStyle = '#fff';
      ctx.fillText("COLLECT GOLD [$], PRESS [M] FOR MARKET", CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 35);
      ctx.fillText("BUY SHIELDS, GUNS AND BOMBS!", CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 60);
      ctx.textAlign = 'left';
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      initAudio(); // Initialize audio on key press
      const s = state.current;
      // Disable game key input when typing name
      if (s.gameState === GameState.LEADERBOARD_INPUT) {
          // Handled by HTML input
          return;
      }

      s.keys[e.code] = true;
      
      if (s.gameState === GameState.START && e.code === 'Space') {
        initGame(true);
      }
      else if (s.gameState === GameState.GAME_OVER && e.code === 'KeyR') {
        initGame(true);
      }
      else if (e.code === 'KeyM') {
          if (s.gameState === GameState.PLAYING) {
              s.gameState = GameState.SHOP;
              setUiGameState(GameState.SHOP);
          } else if (s.gameState === GameState.SHOP) {
              s.gameState = GameState.PLAYING;
              setUiGameState(GameState.PLAYING);
          }
      }
      else if (s.gameState === GameState.SHOP) {
          if (e.key === '1') buyItem(1);
          if (e.key === '2') buyItem(2);
          if (e.key === '3') buyItem(3);
          if (e.key === '4') buyItem(4);
      }
      else if (s.gameState === GameState.PLAYING && e.code === 'Space') {
        fireBullet();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    initGame(); 
    state.current.gameState = GameState.START;
    setUiGameState(GameState.START);

    const loop = () => {
      update();
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
           ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
           draw(ctx);
        }
      }
      requestRef.current = requestAnimationFrame(loop);
    };
    
    requestRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center w-full relative">
        <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="block bg-black w-full object-contain"
            style={{ maxHeight: '60vh' }}
        />

        {/* Name Input Overlay */}
        {uiGameState === GameState.LEADERBOARD_INPUT && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
            <div className="bg-zinc-900 border-4 border-yellow-500 p-6 rounded-lg flex flex-col items-center gap-4 shadow-2xl">
              <h2 className="text-yellow-400 font-bold text-center text-sm md:text-xl font-press-start">TOP PILOT!</h2>
              <div className="text-white text-xs md:text-sm font-press-start">SCORE: {state.current.player.score}</div>
              <input
                autoFocus
                type="text"
                value={inputValue}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  if (val.length <= 12) setInputValue(val);
                }}
                className="bg-black text-white border-2 border-white p-2 font-press-start text-center text-sm md:text-lg w-48 uppercase outline-none focus:border-yellow-400"
                placeholder="NAME"
              />
              <button
                onClick={() => submitHighScore(inputValue)}
                className="bg-yellow-600 text-white font-press-start py-3 px-6 rounded text-xs hover:bg-yellow-500 active:scale-95 transition-transform"
              >
                SAVE RECORD
              </button>
            </div>
          </div>
        )}
        
        {/* Mobile Controls */}
        <div className="w-full max-w-[600px] grid grid-cols-3 gap-2 p-2 mt-auto select-none touch-none bg-zinc-900 border-t border-zinc-700">
            
            {/* LEFT SIDE: JOYSTICK OR BUTTONS */}
            <div className="relative flex items-center justify-center h-32">
                {controlMode === 'JOYSTICK' ? (
                    <div 
                        className="flex flex-col items-center justify-center w-full h-full"
                        ref={joystickContainerRef}
                        onTouchStart={handleJoystickStart}
                        onTouchMove={handleJoystickMove}
                        onTouchEnd={handleJoystickEnd}
                    >
                        <div className="w-24 h-24 bg-zinc-800 rounded-full border-2 border-zinc-600 flex items-center justify-center">
                            <div 
                                className="w-10 h-10 bg-zinc-500 rounded-full shadow-lg border border-zinc-400"
                                style={{
                                    transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
                                    transition: isJoystickActive ? 'none' : 'transform 0.1s ease-out'
                                }}
                            ></div>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-1 w-24 h-24">
                        <div></div>
                        <button 
                             className="bg-zinc-700 rounded active:bg-zinc-600 flex items-center justify-center text-white"
                             onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowUp'); }}
                             onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowUp'); }}
                        >▲</button>
                        <div></div>
                        
                        <button 
                             className="bg-zinc-700 rounded active:bg-zinc-600 flex items-center justify-center text-white"
                             onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowLeft'); }}
                             onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowLeft'); }}
                        >◄</button>
                        <div></div>
                        <button 
                             className="bg-zinc-700 rounded active:bg-zinc-600 flex items-center justify-center text-white"
                             onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowRight'); }}
                             onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowRight'); }}
                        >►</button>

                        <div></div>
                        <button 
                             className="bg-zinc-700 rounded active:bg-zinc-600 flex items-center justify-center text-white"
                             onTouchStart={(e) => { e.preventDefault(); handleTouchStart('ArrowDown'); }}
                             onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('ArrowDown'); }}
                        >▼</button>
                        <div></div>
                    </div>
                )}
                
                {/* Mode Toggle Button (Floating in corner of this cell) */}
                <button 
                    onClick={() => setControlMode(prev => prev === 'JOYSTICK' ? 'BUTTONS' : 'JOYSTICK')}
                    className="absolute bottom-0 left-0 text-[8px] bg-zinc-800 text-zinc-400 px-1 rounded border border-zinc-600 opacity-75"
                >
                    SWAP
                </button>
            </div>

            {/* Center Area (Market / Restart) - Small Buttons */}
            <div className="flex flex-col items-center justify-center gap-2">
                 <button 
                    className="w-full py-2 bg-yellow-600 rounded text-[10px] font-bold text-white shadow shadow-yellow-900 active:bg-yellow-500 active:translate-y-0.5"
                    onClick={() => handleTouchStart('KeyM')}
                 >
                    MARKET
                 </button>
                 
                 {/* Shop Controls - Only visible when in shop */}
                 {uiGameState === GameState.SHOP && (
                     <div className="grid grid-cols-2 gap-1 w-full">
                         {[1, 2, 3, 4].map(num => (
                             <button
                                key={num}
                                className="bg-blue-600 text-white text-[10px] p-2 rounded active:bg-blue-400"
                                onClick={() => buyItem(num)}
                             >
                                 {num}
                             </button>
                         ))}
                     </div>
                 )}

                 {/* Restart Button - Only visible on Game Over */}
                 {uiGameState === GameState.GAME_OVER && (
                     <button 
                        className="w-full py-2 bg-blue-600 rounded text-[10px] font-bold text-white shadow shadow-blue-900 active:bg-blue-500 active:translate-y-0.5 animate-pulse"
                        onClick={() => handleTouchStart('KeyR')}
                     >
                        RESTART
                     </button>
                 )}
            </div>

            {/* Action Area */}
            <div className="flex items-center justify-center h-32">
                 <button 
                    className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-red-600 border-4 border-red-800 shadow-lg active:bg-red-500 active:scale-95 flex items-center justify-center"
                    onTouchStart={(e) => { e.preventDefault(); handleTouchStart('Space'); }}
                    onTouchEnd={(e) => { e.preventDefault(); handleTouchEnd('Space'); }}
                >
                    <div className="text-white font-bold text-xs md:text-sm">FIRE</div>
                </button>
            </div>
        </div>
    </div>
  );
};
