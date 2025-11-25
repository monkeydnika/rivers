
import React, { useEffect, useRef, useState } from 'react';
import { GameState, Player, Enemy, EnemyType, Bullet, Particle, LeaderboardEntry, WeaponType, Decoration, DecorationType } from '../types';
import { supabase } from '../supabaseClient';

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
const MAX_LEADERBOARD_ENTRIES = 20;

export const RiverRaidGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // UI State
  const [uiGameState, setUiGameState] = useState<GameState>(GameState.START);
  const [inputValue, setInputValue] = useState("");
  const [loadingScores, setLoadingScores] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>(""); 
  
  // Economy & Inventory State
  const [userGold, setUserGold] = useState<number>(0);
  const [purchasedWeapon, setPurchasedWeapon] = useState<WeaponType>(WeaponType.SINGLE);
  const [inventory, setInventory] = useState({
      nukes: 0,
      hasShield: false,
      extraLives: 0 // Purchased lives logic handled in startGame
  });

  // Audio Context
  const audioCtxRef = useRef<AudioContext | null>(null);

  // User IP Cache (Simple)
  const userIpRef = useRef<string | null>(null);

  // Cheat Code Buffer
  const cheatBuffer = useRef<string>("");

  // Game State Reference (Mutable for performance)
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
      lives: 5,
      score: 0,
      gold: 0,
      isInvulnerable: false,
      invulnerableTimer: 0,
      markedForDeletion: false,
      weaponType: WeaponType.SINGLE,
      nukes: 0
    } as Player,
    bullets: [] as Bullet[],
    enemies: [] as Enemy[],
    particles: [] as Particle[],
    decorations: [] as Decoration[],
    riverSegments: [] as { y: number, centerX: number, width: number }[],
    frameCount: 0,
    scrollSpeed: BASE_SCROLL_SPEED,
    distanceTraveled: 0,
    level: 1,
    lastBridgePos: 0,
    isBossActive: false,
    bossCount: 0,
    lastShotTime: 0,
    nukeFlashTimer: 0,
    wasPlayingBeforeShop: false // Track state to resume correctly
  });

  // --- Initialization & IP Fetch ---
  useEffect(() => {
    // 1. Load Gold from LocalStorage
    const storedGold = localStorage.getItem('riverRaidGold');
    if (storedGold) {
        setUserGold(parseInt(storedGold, 10));
    }

    // 2. Simple IP Fetch
    fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => { 
            userIpRef.current = data.ip; 
        })
        .catch(() => { /* Silent fail */ });

    // 3. Init Audio
    const initAudio = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    };
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
    window.addEventListener('touchstart', initAudio, { once: true });

    // 4. Cleanup
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        if (audioCtxRef.current) audioCtxRef.current.close();
    }
  }, []);

  // --- Persist Gold ---
  const addGold = (amount: number) => {
      const newGold = userGold + amount;
      setUserGold(newGold);
      localStorage.setItem('riverRaidGold', newGold.toString());
  };

  // --- Sound Synthesis ---
  const playSound = (type: 'shoot' | 'explosion' | 'fuel' | 'coin' | 'buy' | 'nuke' | 'life' | 'boss_spawn') => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'shoot') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'explosion') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'fuel') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'coin') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.setValueAtTime(1600, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'life') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.linearRampToValueAtTime(1000, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'buy') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.2);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'nuke') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(50, now + 1.0);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.0);
        osc.start(now);
        osc.stop(now + 1.0);
    } else if (type === 'boss_spawn') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(50, now + 2.0);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 2.0);
        osc.start(now);
        osc.stop(now + 2.0);
    }
  };

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      state.current.keys[e.code] = true;
      if (uiGameState === GameState.START || uiGameState === GameState.GAME_OVER) {
         if (e.code === 'KeyR' || e.code === 'Enter') startGame();
      }
      
      // TOGGLE SHOP ANYTIME
      if (e.code === 'KeyM') {
          toggleShop();
      }

      if (uiGameState === GameState.PLAYING && (e.code === 'KeyN')) {
          activateNuke();
      }

      // CHEAT CODE: "ogg" -> Infinite Lives
      if (uiGameState === GameState.PLAYING && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
          cheatBuffer.current += e.key.toLowerCase();
          if (cheatBuffer.current.length > 3) cheatBuffer.current = cheatBuffer.current.slice(-3);
          
          if (cheatBuffer.current === "ogg") {
              state.current.player.lives = 9999;
              playSound('life');
              // Visual feedback
              for (let i = 0; i < 50; i++) {
                state.current.particles.push({
                    x: state.current.player.x + PLAYER_WIDTH/2,
                    y: state.current.player.y + PLAYER_HEIGHT/2,
                    width: 4, height: 4,
                    vx: (Math.random() - 0.5) * 15,
                    vy: (Math.random() - 0.5) * 15,
                    life: 1.5,
                    color: '#00FF00', // Lime Green
                    size: Math.random() * 5 + 2,
                    markedForDeletion: false
                });
              }
              cheatBuffer.current = ""; // Reset
              console.log("CHEAT ACTIVATED: INFINITE LIVES");
          }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [uiGameState, purchasedWeapon, inventory]); 

  // --- Touch Button Handler ---
  const handleTouchBtn = (code: string, isPressed: boolean, e: React.TouchEvent | React.MouseEvent) => {
      if (e.cancelable && e.type.startsWith('touch')) e.preventDefault(); 
      state.current.keys[code] = isPressed;
  };

  // --- Game Mechanics ---

  const activateNuke = () => {
      if (state.current.player.nukes > 0) {
          state.current.player.nukes--;
          // Sync inventory state for React
          setInventory(prev => ({ ...prev, nukes: Math.max(0, prev.nukes - 1) }));
          
          state.current.enemies.forEach(e => {
              if (e.type === EnemyType.BOSS) {
                  e.hp -= 5;
                  if (e.hp <= 0) {
                      e.markedForDeletion = true;
                      state.current.isBossActive = false;
                      createExplosion(e.x + e.width/2, e.y + e.height/2, 'purple', 50);
                      state.current.player.score += 2000; // Boss Score
                      state.current.player.gold += 25;
                  }
              } else if (e.type !== EnemyType.FUEL_DEPOT && e.type !== EnemyType.GOLD_COIN && e.type !== EnemyType.LIFE_ORB) {
                // Instantly destroy all non-pickup enemies
                e.hp = 0; 
                e.markedForDeletion = true; // FIX: Ensure they are removed
                createExplosion(e.x + e.width/2, e.y + e.height/2, 'white', 20);
                
                // Add Score for Nuke kills
                if (e.type === EnemyType.KAMIKAZE) state.current.player.score += 300;
                else state.current.player.score += 100;
              }
          });
          
          state.current.nukeFlashTimer = 10;
          playSound('nuke');
      }
  };

  const startGame = () => {
    state.current = {
      ...state.current,
      gameState: GameState.PLAYING,
      player: {
        x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
        y: CANVAS_HEIGHT - 120,
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
        vx: 0,
        vy: 0,
        speedY: 0,
        fuel: MAX_FUEL,
        lives: 5, 
        score: 0,
        gold: 0, 
        isInvulnerable: inventory.hasShield,
        invulnerableTimer: inventory.hasShield ? 900 : 0, 
        markedForDeletion: false,
        weaponType: purchasedWeapon,
        nukes: inventory.nukes
      },
      bullets: [],
      enemies: [],
      particles: [],
      riverSegments: [],
      decorations: [],
      frameCount: 0,
      scrollSpeed: BASE_SCROLL_SPEED,
      distanceTraveled: 0,
      level: 1,
      lastBridgePos: 0,
      isBossActive: false,
      bossCount: 0,
      lastShotTime: 0,
      nukeFlashTimer: 0,
      wasPlayingBeforeShop: false
    };

    // Reset single-use items after applying
    setInventory(prev => ({ ...prev, hasShield: false }));

    setUiGameState(GameState.PLAYING);
    setSaveStatus("");
    
    state.current.riverSegments = []; 
    for (let i = 0; i < CANVAS_HEIGHT / RIVER_SEGMENT_HEIGHT + 5; i++) {
        generateRiverSegment(CANVAS_HEIGHT - i * RIVER_SEGMENT_HEIGHT);
    }

    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const generateRiverSegment = (y: number) => {
    const segments = state.current.riverSegments;
    let centerX = CANVAS_WIDTH / 2;
    let width = 520; 

    if (segments.length > 0) {
        const last = segments[segments.length - 1];
        const time = state.current.frameCount * 0.005; 
        const noise = Math.sin(time) * 30 + Math.sin(time * 0.5) * 20;
        centerX = CANVAS_WIDTH / 2 + noise;
        
        width = 480 + Math.sin(time * 0.3) * 50; 
        
        centerX = Math.max(width/2 + 20, Math.min(CANVAS_WIDTH - width/2 - 20, centerX));
    }

    state.current.riverSegments.push({ y, centerX, width });

    if (Math.random() < 0.3) {
        const isLeft = Math.random() > 0.5;
        const bankX = isLeft ? (centerX - width/2 - 20) : (centerX + width/2 + 20);
        state.current.decorations.push({
            x: bankX,
            y: y,
            type: Math.random() > 0.8 ? DecorationType.HOUSE : DecorationType.TREE,
            variant: Math.floor(Math.random() * 2), 
            markedForDeletion: false
        });
    }
  };

  const spawnBoss = () => {
      if (state.current.isBossActive) return;

      state.current.isBossActive = true;
      state.current.bossCount++;
      const bossHp = 3 + (state.current.bossCount - 1) * 2; 
      
      state.current.enemies.push({
          type: EnemyType.BOSS,
          x: CANVAS_WIDTH / 2 - 40,
          y: -100, 
          width: 80,
          height: 60,
          vx: 2,
          vy: 0,
          shootTimer: 60, 
          hp: bossHp,
          maxHp: bossHp,
          markedForDeletion: false
      });
      playSound('boss_spawn');
  };

  const spawnEnemy = (y: number) => {
     if (state.current.isBossActive) return; 

     const segments = state.current.riverSegments;
     const segment = segments[segments.length - 1]; 
     if (!segment) return;
     
     const isNarrow = segment.width < 350; 

     // --- PROGRESSIVE DIFFICULTY LOGIC (UPDATED) ---
     // 15 seconds = 900 frames.
     const frames = state.current.frameCount;
     const difficultyStep = Math.floor(frames / 900); 
     
     // Start weak (5%). Every 15 seconds, increase difficulty by 10%.
     // Formula: 0.05 * (1.10 ^ difficultyStep)
     let spawnChance = 0.05 * Math.pow(1.10, difficultyStep);
     
     // Cap max spawn chance at 70% to avoid impossible walls
     if (spawnChance > 0.70) spawnChance = 0.70;

     if (Math.random() > spawnChance) return; 

     const minX = segment.centerX - segment.width / 2 + 40; 
     const maxX = segment.centerX + segment.width / 2 - 40;
     const x = minX + Math.random() * (maxX - minX);

     let type = EnemyType.SHIP;
     let hp = 1;

     const rand = Math.random();

     if (rand < 0.15) {
         type = EnemyType.FUEL_DEPOT;
         hp = 1;
     } else if (rand < 0.20) {
         type = EnemyType.GOLD_COIN;
         hp = 1;
     } else if (rand < 0.22) {
        type = EnemyType.LIFE_ORB;
        hp = 1;
     } else if (rand < 0.60) {
         return; // Empty slot
     } else if (rand < 0.80) {
         if (isNarrow) return;
         type = EnemyType.HELICOPTER;
         hp = 1; 
     } else if (rand < 0.95) {
         if (isNarrow) return;
         type = EnemyType.JET;
         hp = 1;
     } else {
         if (isNarrow) return;
         type = EnemyType.KAMIKAZE;
         hp = 1;
     }

     // Determine Velocities
     let vx = 0;
     if (type === EnemyType.HELICOPTER) {
         vx = Math.random() > 0.5 ? 2 : -2;
     } else if (type === EnemyType.JET) {
         vx = Math.random() > 0.5 ? 3 : -3; 
     }
     
     state.current.enemies.push({
         type,
         x,
         y,
         width: type === EnemyType.FUEL_DEPOT ? 24 : (type === EnemyType.LIFE_ORB ? 24 : 32),
         height: type === EnemyType.FUEL_DEPOT ? 48 : (type === EnemyType.LIFE_ORB ? 24 : (type === EnemyType.KAMIKAZE ? 40 : 32)),
         vx: vx,
         vy: type === EnemyType.KAMIKAZE ? 8 : 0, 
         // Initialize randomized shoot timer for regular enemies
         shootTimer: Math.random() * 120 + 60, // 1-3 seconds start delay
         hp,
         maxHp: hp,
         markedForDeletion: false
     });
  };

  const createExplosion = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
        state.current.particles.push({
            x, y,
            width: 4, height: 4,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color,
            size: Math.random() * 4 + 2,
            markedForDeletion: false
        });
    }
    playSound('explosion');
  };

  const update = () => {
    // If shop is open during gameplay, do NOT update game logic
    if (state.current.gameState === GameState.SHOP) return;

    const s = state.current;
    s.frameCount++;

    // --- MINI BOSS TIMER ---
    if (s.frameCount > 0 && s.frameCount % 3600 === 0) {
        spawnBoss();
    }

    if (s.nukeFlashTimer > 0) s.nukeFlashTimer--;

    // Update invulnerability
    if (s.player.isInvulnerable) {
        s.player.invulnerableTimer--;
        if (s.player.invulnerableTimer <= 0) {
            s.player.isInvulnerable = false;
        }
    }

    const keys = s.keys;
    let dx = 0;

    // Movement
    if (keys['ArrowLeft']) dx = -5;
    if (keys['ArrowRight']) dx = 5;
    
    // Speed Control
    if (keys['ArrowUp']) s.scrollSpeed = Math.min(s.scrollSpeed + 0.1, BASE_SCROLL_SPEED * 2.5);
    else if (keys['ArrowDown']) s.scrollSpeed = Math.max(s.scrollSpeed - 0.1, BASE_SCROLL_SPEED * 0.5);
    else {
            if (s.scrollSpeed > BASE_SCROLL_SPEED) s.scrollSpeed -= 0.05;
            if (s.scrollSpeed < BASE_SCROLL_SPEED) s.scrollSpeed += 0.05;
    }

    s.player.x += dx;

    // Shooting
    const now = Date.now();
    if ((keys['Space'] || keys['KeyZ']) && now - s.lastShotTime > 200) { 
       const px = s.player.x + PLAYER_WIDTH/2;
       const py = s.player.y;

       // Weapon Logic
       if (s.player.weaponType === WeaponType.SPREAD) {
            s.bullets.push({ x: px - 4, y: py, width: 8, height: 16, vx: 0, vy: -12, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
            s.bullets.push({ x: px - 4, y: py, width: 8, height: 16, vx: -2, vy: -10, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
            s.bullets.push({ x: px - 4, y: py, width: 8, height: 16, vx: 2, vy: -10, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
       } else if (s.player.weaponType === WeaponType.HELIX) {
            s.bullets.push({ x: px - 4, y: py, width: 10, height: 10, vx: 0, vy: -10, isEnemy: false, markedForDeletion: false, pattern: 'helix_left', initialX: px - 4 });
            s.bullets.push({ x: px - 4, y: py, width: 10, height: 10, vx: 0, vy: -10, isEnemy: false, markedForDeletion: false, pattern: 'helix_right', initialX: px - 4 });
       } else if (s.player.weaponType === WeaponType.DOUBLE) {
            s.bullets.push({ x: px - 12, y: py, width: 8, height: 16, vx: 0, vy: -12, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
            s.bullets.push({ x: px + 4, y: py, width: 8, height: 16, vx: 0, vy: -12, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
       } else {
            // Single
            s.bullets.push({ x: px - 4, y: py, width: 8, height: 16, vx: 0, vy: -12, isEnemy: false, markedForDeletion: false, pattern: 'straight' });
       }
       s.lastShotTime = now;
       playSound('shoot');
    }

    s.player.fuel -= FUEL_CONSUMPTION_RATE * (s.scrollSpeed / BASE_SCROLL_SPEED);
    if (s.player.fuel <= 0) {
        killPlayer("Fuel Empty");
    }

    s.distanceTraveled += s.scrollSpeed;

    // River Generation
    const lastSeg = s.riverSegments[s.riverSegments.length - 1];
    if (lastSeg.y > -RIVER_SEGMENT_HEIGHT) {
        generateRiverSegment(lastSeg.y - RIVER_SEGMENT_HEIGHT);
        spawnEnemy(lastSeg.y - RIVER_SEGMENT_HEIGHT - 50);
    }

    s.riverSegments.forEach(seg => seg.y += s.scrollSpeed);
    if (s.riverSegments[0].y > CANVAS_HEIGHT) s.riverSegments.shift();
    
    s.decorations.forEach(d => {
        d.y += s.scrollSpeed;
        if (d.y > CANVAS_HEIGHT) d.markedForDeletion = true;
    });
    s.decorations = s.decorations.filter(d => !d.markedForDeletion);

    // Collision Player vs River Banks
    const playerSeg = s.riverSegments.find(seg => 
        s.player.y + s.player.height > seg.y && s.player.y < seg.y + RIVER_SEGMENT_HEIGHT
    );
    if (playerSeg && !s.player.isInvulnerable) {
        const leftBank = playerSeg.centerX - playerSeg.width / 2;
        const rightBank = playerSeg.centerX + playerSeg.width / 2;
        if (s.player.x < leftBank || s.player.x + s.player.width > rightBank) {
            killPlayer("Crashed into land");
        }
    }

    // Check if Enemies can shoot (After 90 seconds = 5400 frames)
    const canEnemiesShoot = s.frameCount > 5400;

    // Enemies & Pickups
    s.enemies.forEach(e => {
        // --- BOSS LOGIC ---
        if (e.type === EnemyType.BOSS) {
            if (e.y < 80) {
                e.y += 2;
            } else {
                e.y = 80; 
                e.x += Math.sin(s.frameCount * 0.05) * 3;
                if (e.x < 20) e.x = 20;
                if (e.x > CANVAS_WIDTH - e.width - 20) e.x = CANVAS_WIDTH - e.width - 20;
            }

            e.shootTimer--;
            if (e.shootTimer <= 0) {
                e.shootTimer = 90; 
                const bx = e.x + e.width / 2 - 4;
                const by = e.y + e.height;
                s.bullets.push({ x: bx, y: by, width: 8, height: 16, vx: 0, vy: 6, isEnemy: true, markedForDeletion: false, pattern: 'straight' });
                s.bullets.push({ x: bx, y: by, width: 8, height: 16, vx: -3, vy: 5, isEnemy: true, markedForDeletion: false, pattern: 'straight' });
                s.bullets.push({ x: bx, y: by, width: 8, height: 16, vx: 3, vy: 5, isEnemy: true, markedForDeletion: false, pattern: 'straight' });
            }

        } else if (e.type === EnemyType.KAMIKAZE) {
             e.y += e.vy + s.scrollSpeed; 
        } else {
             // --- REGULAR ENEMY MOVEMENT ---
             e.y += s.scrollSpeed;
             
             if (e.type === EnemyType.JET) {
                 e.y += 2; 
             }
             e.x += e.vx;

             // --- REGULAR ENEMY SHOOTING ---
             if (canEnemiesShoot && (e.type === EnemyType.HELICOPTER || e.type === EnemyType.JET)) {
                 e.shootTimer--;
                 if (e.shootTimer <= 0) {
                     // Reset timer (Randomized so they don't machine gun)
                     e.shootTimer = 180 + Math.random() * 60; 
                     
                     // Shoot straight down
                     const bx = e.x + e.width / 2 - 4;
                     const by = e.y + e.height;
                     s.bullets.push({ x: bx, y: by, width: 6, height: 12, vx: 0, vy: 5, isEnemy: true, markedForDeletion: false, pattern: 'straight' });
                 }
             }
        }

        // Bouncing
        if (e.type === EnemyType.HELICOPTER || e.type === EnemyType.JET) {
             const seg = s.riverSegments.find(seg => e.y > seg.y && e.y < seg.y + RIVER_SEGMENT_HEIGHT);
             if (seg) {
                 if (e.x < seg.centerX - seg.width/2 + 20) {
                     e.x = seg.centerX - seg.width/2 + 20; 
                     e.vx = Math.abs(e.vx); 
                 }
                 if (e.x + e.width > seg.centerX + seg.width/2 - 20) {
                     e.x = seg.centerX + seg.width/2 - 20 - e.width; 
                     e.vx = -Math.abs(e.vx); 
                 }
             }
        }
        
        // Collisions
        if (e.type === EnemyType.BRIDGE && !e.markedForDeletion) {
             if (checkCollision(s.player, e) && !s.player.isInvulnerable) killPlayer("Crashed into bridge");
        } else if (e.type === EnemyType.FUEL_DEPOT) {
             if (checkCollision(s.player, e)) {
                 s.player.fuel = Math.min(s.player.fuel + FUEL_REFILL_RATE, MAX_FUEL);
                 playSound('fuel');
             }
        } else if (e.type === EnemyType.GOLD_COIN) {
            if (checkCollision(s.player, e)) {
                s.player.score += 500;
                s.player.gold += 1;
                e.markedForDeletion = true;
                playSound('coin');
            }
        } else if (e.type === EnemyType.LIFE_ORB) {
            if (checkCollision(s.player, e)) {
                s.player.lives += 1;
                e.markedForDeletion = true;
                playSound('life');
            }
        } else if (e.type !== EnemyType.BRIDGE) {
            if (checkCollision(s.player, e)) {
                if (s.player.isInvulnerable) {
                     if (e.type !== EnemyType.BOSS) {
                        e.markedForDeletion = true;
                        createExplosion(e.x, e.y, 'orange', 10);
                     }
                } else {
                    killPlayer("Crashed into enemy");
                    if (e.type !== EnemyType.BOSS) {
                        e.markedForDeletion = true;
                        createExplosion(e.x, e.y, 'orange', 10);
                    }
                }
            }
        }

        if (e.y > CANVAS_HEIGHT && e.type !== EnemyType.BOSS) {
            e.markedForDeletion = true;
        }
    });

    // Bullets
    s.bullets.forEach(b => {
        if (b.pattern === 'helix_left') {
             b.x = (b.initialX || 0) + Math.sin(b.y * 0.05) * 20;
        } else if (b.pattern === 'helix_right') {
             b.x = (b.initialX || 0) - Math.sin(b.y * 0.05) * 20;
        } else {
            b.x += b.vx;
        }
        b.y += b.vy;

        if (b.isEnemy) {
            if (!b.markedForDeletion && checkCollision(b, s.player)) {
                if (!s.player.isInvulnerable) {
                    b.markedForDeletion = true;
                    killPlayer("Shot by Enemy");
                }
            }
        } else {
            s.enemies.forEach(e => {
                if (!e.markedForDeletion && !b.markedForDeletion && checkCollision(b, e)) {
                    if (e.type === EnemyType.GOLD_COIN || e.type === EnemyType.LIFE_ORB) return; 

                    b.markedForDeletion = true;
                    e.hp--;
                    if (e.hp <= 0) {
                        e.markedForDeletion = true;
                        if (e.type === EnemyType.BRIDGE) {
                            s.player.score += 500;
                            createExplosion(e.x + e.width/2, e.y + e.height/2, 'gray', 30);
                        } else if (e.type === EnemyType.FUEL_DEPOT) {
                            s.player.score += 80;
                            createExplosion(e.x, e.y, 'red', 15);
                        } else if (e.type === EnemyType.BOSS) {
                            s.player.score += 2000;
                            s.player.gold += 25; 
                            s.isBossActive = false;
                            createExplosion(e.x + e.width/2, e.y + e.height/2, 'purple', 100);
                            playSound('explosion');
                        } else if (e.type === EnemyType.KAMIKAZE) {
                            s.player.score += 300;
                            createExplosion(e.x, e.y, 'white', 15);
                        } else {
                            s.player.score += 100;
                            createExplosion(e.x, e.y, 'orange', 10);
                        }
                    } else {
                        createExplosion(e.x + e.width/2, e.y + e.height/2, 'yellow', 2);
                    }
                }
            });
        }

        if (b.y < 0 || b.y > CANVAS_HEIGHT) b.markedForDeletion = true;
    });

    s.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) p.markedForDeletion = true;
    });

    s.enemies = s.enemies.filter(e => !e.markedForDeletion);
    s.bullets = s.bullets.filter(b => !b.markedForDeletion);
    s.particles = s.particles.filter(p => !p.markedForDeletion);
  };

  const checkCollision = (rect1: any, rect2: any) => {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
  };

  const killPlayer = (reason: string) => {
      if (state.current.player.lives > 1) {
          console.log("Life Lost:", reason);
          state.current.player.lives--;
          
          state.current.player.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
          state.current.player.y = CANVAS_HEIGHT - 120;
          state.current.player.fuel = MAX_FUEL;
          state.current.player.isInvulnerable = true;
          state.current.player.invulnerableTimer = 180; 
          
          state.current.bullets = [];
          
          createExplosion(state.current.player.x, state.current.player.y, 'yellow', 20);
          
          return;
      }

      console.log("Game Over:", reason);
      state.current.gameState = GameState.GAME_OVER;
      setUiGameState(GameState.GAME_OVER);
      
      addGold(state.current.player.gold);
      setPurchasedWeapon(WeaponType.SINGLE); 
      
      cancelAnimationFrame(requestRef.current);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#228B22'; 
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const s = state.current;

    // River
    ctx.fillStyle = '#4169E1';
    ctx.beginPath();
    if (s.riverSegments.length > 0) {
        ctx.moveTo(s.riverSegments[0].centerX - s.riverSegments[0].width / 2, s.riverSegments[0].y);
        for (const seg of s.riverSegments) {
            ctx.lineTo(seg.centerX - seg.width / 2, seg.y);
        }
        for (let i = s.riverSegments.length - 1; i >= 0; i--) {
            const seg = s.riverSegments[i];
            ctx.lineTo(seg.centerX + seg.width / 2, seg.y);
        }
    }
    ctx.fill();

    s.decorations.forEach(d => {
        if (d.type === DecorationType.TREE) {
            ctx.fillStyle = '#006400';
            ctx.beginPath();
            ctx.arc(d.x, d.y, 10, 0, Math.PI * 2);
            ctx.fill();
        } else {
             ctx.fillStyle = '#8B4513';
             ctx.fillRect(d.x - 8, d.y - 8, 16, 16);
        }
    });

    // Player
    ctx.fillStyle = s.player.isInvulnerable ? (Math.floor(Date.now() / 100) % 2 === 0 ? 'cyan' : 'yellow') : 'yellow';
    ctx.beginPath();
    ctx.moveTo(s.player.x + s.player.width/2, s.player.y);
    ctx.lineTo(s.player.x + s.player.width, s.player.y + s.player.height);
    ctx.lineTo(s.player.x + s.player.width/2, s.player.y + s.player.height - 10);
    ctx.lineTo(s.player.x, s.player.y + s.player.height);
    ctx.closePath();
    ctx.fill();

    if (s.player.isInvulnerable) {
        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.player.x + s.player.width/2, s.player.y + s.player.height/2, 25, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Enemies
    s.enemies.forEach(e => {
        if (e.type === EnemyType.SHIP) ctx.fillStyle = 'white';
        else if (e.type === EnemyType.HELICOPTER) ctx.fillStyle = 'black';
        else if (e.type === EnemyType.JET) ctx.fillStyle = 'red';
        else if (e.type === EnemyType.KAMIKAZE) ctx.fillStyle = '#2F4F4F';
        else if (e.type === EnemyType.FUEL_DEPOT) ctx.fillStyle = '#FF4500';
        else if (e.type === EnemyType.BRIDGE) ctx.fillStyle = '#333';
        else if (e.type === EnemyType.GOLD_COIN) ctx.fillStyle = 'gold';
        else if (e.type === EnemyType.LIFE_ORB) ctx.fillStyle = '#FF1493'; 
        else if (e.type === EnemyType.BOSS) ctx.fillStyle = '#800080';

        if (e.type === EnemyType.GOLD_COIN) {
            ctx.beginPath();
            ctx.arc(e.x + e.width/2, e.y + e.height/2, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#DAA520';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (e.type === EnemyType.LIFE_ORB) {
            const cx = e.x + e.width/2;
            const cy = e.y + e.height/2;
            ctx.beginPath();
            ctx.moveTo(cx, cy + 6);
            ctx.bezierCurveTo(cx - 6, cy - 6, cx - 12, cy + 2, cx, cy + 12);
            ctx.bezierCurveTo(cx + 12, cy + 2, cx + 6, cy - 6, cx, cy + 6);
            ctx.fill();
            ctx.shadowBlur = 10;
            ctx.shadowColor = "pink";
            ctx.stroke();
            ctx.shadowBlur = 0;
        } else if (e.type === EnemyType.BOSS) {
            const cx = e.x + e.width/2;
            const cy = e.y + e.height/2;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 20);
            ctx.lineTo(cx + 30, cy);
            ctx.lineTo(cx + 40, cy + 20);
            ctx.lineTo(cx, cy + 30);
            ctx.lineTo(cx - 40, cy + 20);
            ctx.lineTo(cx - 30, cy);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'red';
            ctx.fillRect(e.x, e.y - 10, e.width, 5);
            ctx.fillStyle = 'green';
            ctx.fillRect(e.x, e.y - 10, e.width * (e.hp / e.maxHp), 5);
        } else if (e.type === EnemyType.KAMIKAZE) {
            const cx = e.x + e.width/2;
            const cy = e.y + e.height/2;
            ctx.beginPath();
            ctx.moveTo(cx, e.y); 
            ctx.lineTo(e.x + e.width, e.y + e.height); 
            ctx.lineTo(cx, e.y + e.height - 10); 
            ctx.lineTo(e.x, e.y + e.height); 
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'orange';
            ctx.beginPath();
            ctx.arc(cx, e.y + e.height, 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(e.x, e.y, e.width, e.height);
        }

        if (e.type === EnemyType.FUEL_DEPOT) {
            ctx.fillStyle = 'white';
            ctx.font = '10px monospace';
            ctx.fillText('FUEL', e.x + 2, e.y + 25);
        }
    });

    // Bullets
    s.bullets.forEach(b => {
        if (b.isEnemy) {
             ctx.fillStyle = '#FF00FF'; 
             ctx.beginPath();
             ctx.arc(b.x + b.width/2, b.y + b.height/2, 6, 0, Math.PI * 2);
             ctx.fill();
        } else {
            if (b.pattern === 'helix_left' || b.pattern === 'helix_right') {
                ctx.fillStyle = '#00FF00'; 
                ctx.beginPath();
                ctx.arc(b.x + b.width/2, b.y + b.height/2, 5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = 'yellow';
                ctx.fillRect(b.x, b.y, b.width, b.height);
            }
        }
    });

    s.particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    });

    if (s.nukeFlashTimer > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${s.nukeFlashTimer / 10})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // UI Overlay (Fuel)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(10, CANVAS_HEIGHT - 40, 150, 30);
    
    ctx.fillStyle = 'white';
    ctx.font = '12px "Press Start 2P"';
    ctx.fillText(`FUEL`, 20, CANVAS_HEIGHT - 20);
    
    ctx.fillStyle = s.player.fuel < 20 ? 'red' : 'white';
    ctx.fillRect(70, CANVAS_HEIGHT - 32, (s.player.fuel / MAX_FUEL) * 80, 16);

    ctx.fillStyle = 'white';
    ctx.fillText(`SCORE: ${s.player.score}`, 10, 30);
    
    ctx.fillStyle = 'gold';
    ctx.fillText(`GOLD: ${s.player.gold} (Bank: ${userGold})`, 10, 50);

    if (s.player.nukes > 0) {
        ctx.fillStyle = 'orange';
        ctx.fillText(`NUKES: ${s.player.nukes}`, 10, 70);
    }

    ctx.fillStyle = '#FF1493';
    ctx.fillText(`LIVES: ${s.player.lives}`, 10, 90);
  };

  const gameLoop = () => {
    update();
    const canvas = canvasRef.current;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) draw(ctx);
    }
    // Loop if Playing OR Shop (to draw background while paused)
    if (state.current.gameState === GameState.PLAYING || state.current.gameState === GameState.SHOP) {
        requestRef.current = requestAnimationFrame(gameLoop);
    }
  };

  // --- Database & Leaderboard ---

  const fetchLeaderboard = async () => {
      if (!supabase) return;
      setLoadingScores(true);
      const { data, error } = await supabase
          .from('scores')
          .select('name, score')
          .order('score', { ascending: false })
          .limit(MAX_LEADERBOARD_ENTRIES);
      
      if (error) {
          console.error("Supabase fetch error:", error);
      } else {
          setLeaderboard(data || []);
      }
      setLoadingScores(false);
  };

  const saveScore = async () => {
    if (!supabase) {
        setSaveStatus("Config Error: No DB");
        return;
    }
    if (!inputValue.trim()) return;

    setSaveStatus("Saving...");
    const { error } = await supabase.from('scores').insert([{
        name: inputValue.trim(),
        score: state.current.player.score,
        ip_address: userIpRef.current 
    }]);

    if (error) {
        console.error("Supabase insert error:", error);
        setSaveStatus("Error Saving");
    } else {
        setSaveStatus("Saved!");
        setUiGameState(GameState.LEADERBOARD_INPUT); 
        fetchLeaderboard();
    }
  };

  // --- Shop Logic ---
  const toggleShop = () => {
      // CHECK IF WE ARE CURRENTLY IN SHOP (Based on UI State)
      if (uiGameState === GameState.SHOP) {
          // CLOSE SHOP
          if (state.current.wasPlayingBeforeShop) {
              state.current.gameState = GameState.PLAYING;
              state.current.wasPlayingBeforeShop = false;
              setUiGameState(GameState.PLAYING);
          } else {
              state.current.gameState = GameState.START;
              setUiGameState(GameState.START);
          }
      } else {
          // OPEN SHOP
          if (state.current.gameState === GameState.PLAYING) {
              state.current.wasPlayingBeforeShop = true;
              state.current.gameState = GameState.SHOP;
              setUiGameState(GameState.SHOP);
          } else {
              // Start or Game Over
              state.current.wasPlayingBeforeShop = false;
              state.current.gameState = GameState.SHOP; // Sync ref state!
              setUiGameState(GameState.SHOP);
          }
      }
  };

  const buyItem = (item: 'weapon_double' | 'weapon_spread' | 'weapon_helix' | 'shield' | 'nuke' | 'life' | 'fuel') => {
     // If we are mid-game (Shop opened while playing), we must apply changes to state.current.player instantly.
     const applyToGame = state.current.wasPlayingBeforeShop;

     if (item === 'weapon_double') {
         if (userGold >= 15 && purchasedWeapon !== WeaponType.DOUBLE) {
             setUserGold(prev => { const n = prev - 15; localStorage.setItem('riverRaidGold', n.toString()); return n; });
             setPurchasedWeapon(WeaponType.DOUBLE);
             if (applyToGame) state.current.player.weaponType = WeaponType.DOUBLE;
             playSound('buy');
         }
     } else if (item === 'weapon_spread') {
         if (userGold >= 30 && purchasedWeapon !== WeaponType.SPREAD) {
             setUserGold(prev => { const n = prev - 30; localStorage.setItem('riverRaidGold', n.toString()); return n; });
             setPurchasedWeapon(WeaponType.SPREAD);
             if (applyToGame) state.current.player.weaponType = WeaponType.SPREAD;
             playSound('buy');
         }
     } else if (item === 'weapon_helix') {
         if (userGold >= 25 && purchasedWeapon !== WeaponType.HELIX) {
             setUserGold(prev => { const n = prev - 25; localStorage.setItem('riverRaidGold', n.toString()); return n; });
             setPurchasedWeapon(WeaponType.HELIX);
             if (applyToGame) state.current.player.weaponType = WeaponType.HELIX;
             playSound('buy');
         }
     } else if (item === 'shield') {
         if (userGold >= 15 && !inventory.hasShield) {
             setUserGold(prev => { const n = prev - 15; localStorage.setItem('riverRaidGold', n.toString()); return n; });
             setInventory(prev => ({ ...prev, hasShield: true }));
             if (applyToGame) {
                 state.current.player.isInvulnerable = true;
                 state.current.player.invulnerableTimer = 900;
             }
             playSound('buy');
         }
     } else if (item === 'nuke') {
         if (userGold >= 20) {
             setUserGold(prev => { const n = prev - 20; localStorage.setItem('riverRaidGold', n.toString()); return n; });
             setInventory(prev => ({ ...prev, nukes: prev.nukes + 1 }));
             if (applyToGame) state.current.player.nukes++;
             playSound('buy');
         }
     } else if (item === 'life') {
         if (userGold >= 50) {
              setUserGold(prev => { const n = prev - 50; localStorage.setItem('riverRaidGold', n.toString()); return n; });
              setInventory(prev => ({ ...prev, extraLives: prev.extraLives + 1 })); 
              if (applyToGame) state.current.player.lives++;
              playSound('buy');
         }
     } else if (item === 'fuel') {
         if (userGold >= 10) {
              if (applyToGame && state.current.player.fuel < MAX_FUEL) {
                  setUserGold(prev => { const n = prev - 10; localStorage.setItem('riverRaidGold', n.toString()); return n; });
                  state.current.player.fuel = MAX_FUEL;
                  playSound('fuel');
              }
         }
     }
  };

  // --- Render ---
  return (
    <div className="relative w-full h-full bg-zinc-900 overflow-hidden flex flex-col items-center justify-center">
      
      {/* 1. TOP: Game Screen (Canvas) */}
      <div className="relative w-full max-w-[600px] bg-black border-4 border-zinc-800 rounded-t-xl overflow-hidden shadow-2xl shrink-0" style={{ height: '60%' }}>
        <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full h-full object-contain mx-auto block bg-[#228B22]"
        />

        {/* Overlay Screens */}
        {uiGameState === GameState.START && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
            <h2 className="text-4xl text-yellow-400 mb-8 animate-pulse text-center font-bold tracking-tighter">RIVER RAID</h2>
            <div className="text-yellow-200 mb-4 text-sm">BALANCE: {userGold} GOLD</div>
            <button 
                onClick={startGame}
                className="px-8 py-4 bg-red-600 text-white text-xl font-bold rounded hover:bg-red-500 transition-colors mb-4 border-4 border-red-800 shadow-[0_0_15px_rgba(255,0,0,0.5)]"
            >
                START MISSION
            </button>
            <div className="text-zinc-500 text-[10px] mt-4">LIVES: 5 {inventory.extraLives > 0 ? `+ ${inventory.extraLives} BONUS` : ''}</div>
            <div className="text-zinc-500 text-[10px] mt-1">PRESS 'M' FOR MARKET</div>
            {inventory.hasShield && <div className="text-cyan-400 text-xs mt-2">SHIELD ACTIVE</div>}
            {inventory.nukes > 0 && <div className="text-orange-400 text-xs mt-1">NUKES: {inventory.nukes}</div>}
            </div>
        )}

        {uiGameState === GameState.GAME_OVER && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 p-4">
            <h2 className="text-3xl text-red-500 mb-4 font-bold">GAME OVER</h2>
            <p className="text-white mb-2">FINAL SCORE: {state.current.player.score}</p>
            <p className="text-yellow-400 mb-6 text-sm">+ {state.current.player.gold} GOLD EARNED</p>
            
            <div className="flex flex-col gap-2 w-full max-w-xs mb-6">
                <input 
                type="text" 
                maxLength={10}
                placeholder="ENTER NAME" 
                className="bg-zinc-800 border-2 border-zinc-600 p-2 text-center text-white uppercase"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.toUpperCase())}
                />
                <button 
                onClick={saveScore}
                disabled={!inputValue || !!saveStatus}
                className="bg-green-700 hover:bg-green-600 disabled:bg-zinc-800 text-white p-2 rounded font-bold transition-colors"
                >
                {saveStatus || "SAVE RECORD"}
                </button>
            </div>

            <button 
                onClick={startGame}
                className="px-6 py-2 bg-yellow-600 text-black font-bold rounded hover:bg-yellow-500 mb-4"
            >
                TRY AGAIN
            </button>
            <button 
                onClick={toggleShop}
                className="text-xs text-blue-400 underline"
            >
                GO TO MARKET (PRESS M)
            </button>
            </div>
        )}
        
        {uiGameState === GameState.SHOP && (
             <div className="absolute inset-0 flex flex-col items-center justify-start bg-zinc-900/90 z-20 p-4 overflow-y-auto">
                <h2 className="text-2xl text-blue-400 mb-2 font-bold sticky top-0 bg-zinc-900 w-full text-center pb-2">MARKET</h2>
                <div className="text-yellow-400 mb-4 sticky top-10 bg-zinc-900 w-full text-center pb-2 border-b border-zinc-700">BALANCE: {userGold} G</div>
                
                {state.current.wasPlayingBeforeShop && (
                    <div className="text-green-400 text-xs font-bold mb-2 animate-pulse">GAME PAUSED - ITEMS APPLY INSTANTLY</div>
                )}

                <div className="w-full max-w-xs space-y-3 pb-8">
                    {/* Fuel Refill - Only show if playing because starting a new game resets fuel */}
                    {state.current.wasPlayingBeforeShop && (
                        <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                            <div>
                                <div className="text-white text-xs">FULL TANK</div>
                                <div className="text-zinc-500 text-[10px]">Refill Fuel Gauge</div>
                            </div>
                            <button 
                                onClick={() => buyItem('fuel')}
                                disabled={userGold < 10 || state.current.player.fuel >= MAX_FUEL}
                                className="px-3 py-1 rounded text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 disabled:bg-zinc-700 disabled:text-zinc-500"
                            >
                                {state.current.player.fuel >= MAX_FUEL ? 'FULL' : '10 G'}
                            </button>
                        </div>
                    )}

                    {/* Double Gun */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                        <div>
                            <div className="text-white text-xs">DOUBLE GUN</div>
                            <div className="text-zinc-500 text-[10px]">Dual parallel fire</div>
                        </div>
                        <button 
                            onClick={() => buyItem('weapon_double')}
                            disabled={purchasedWeapon === WeaponType.DOUBLE || userGold < 15}
                            className={`px-3 py-1 rounded text-xs font-bold ${purchasedWeapon === WeaponType.DOUBLE ? 'bg-green-900 text-green-200' : 'bg-yellow-600 text-black'}`}
                        >
                            {purchasedWeapon === WeaponType.DOUBLE ? 'OWNED' : '15 G'}
                        </button>
                    </div>

                    {/* Helix Gun */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                        <div>
                            <div className="text-white text-xs">HELIX GUN</div>
                            <div className="text-zinc-500 text-[10px]">Wide wave pattern</div>
                        </div>
                        <button 
                            onClick={() => buyItem('weapon_helix')}
                            disabled={purchasedWeapon === WeaponType.HELIX || userGold < 25}
                            className={`px-3 py-1 rounded text-xs font-bold ${purchasedWeapon === WeaponType.HELIX ? 'bg-green-900 text-green-200' : 'bg-yellow-600 text-black'}`}
                        >
                            {purchasedWeapon === WeaponType.HELIX ? 'OWNED' : '25 G'}
                        </button>
                    </div>

                     {/* Spread Gun */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                        <div>
                            <div className="text-white text-xs">SPREAD GUN</div>
                            <div className="text-zinc-500 text-[10px]">Triple shot power</div>
                        </div>
                        <button 
                            onClick={() => buyItem('weapon_spread')}
                            disabled={purchasedWeapon === WeaponType.SPREAD || userGold < 30}
                            className={`px-3 py-1 rounded text-xs font-bold ${purchasedWeapon === WeaponType.SPREAD ? 'bg-green-900 text-green-200' : 'bg-yellow-600 text-black'}`}
                        >
                            {purchasedWeapon === WeaponType.SPREAD ? 'OWNED' : '30 G'}
                        </button>
                    </div>

                    {/* Extra Life */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                         <div>
                            <div className="text-white text-xs">EXTRA LIFE</div>
                            <div className="text-zinc-500 text-[10px]">Add +1 to start ({inventory.extraLives})</div>
                        </div>
                         <button 
                            onClick={() => buyItem('life')}
                            disabled={userGold < 50}
                            className="px-3 py-1 rounded text-xs font-bold bg-pink-600 text-white hover:bg-pink-500"
                         >
                            50 G
                         </button>
                    </div>

                    {/* Shield */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                         <div>
                            <div className="text-white text-xs">SHIELD (15s)</div>
                            <div className="text-zinc-500 text-[10px]">Start Invincible</div>
                        </div>
                         <button 
                            onClick={() => buyItem('shield')}
                            disabled={inventory.hasShield || userGold < 15}
                            className={`px-3 py-1 rounded text-xs font-bold ${inventory.hasShield ? 'bg-green-900 text-green-200' : 'bg-yellow-600 text-black'}`}
                         >
                            {inventory.hasShield ? 'READY' : '15 G'}
                         </button>
                    </div>

                    {/* Nuke */}
                    <div className="bg-zinc-800 p-2 rounded border border-zinc-700 flex justify-between items-center">
                         <div>
                            <div className="text-white text-xs">NUKE BOMB</div>
                            <div className="text-zinc-500 text-[10px]">Clear Screen ({inventory.nukes})</div>
                        </div>
                         <button 
                            onClick={() => buyItem('nuke')}
                            disabled={userGold < 20}
                            className="px-3 py-1 rounded text-xs font-bold bg-yellow-600 text-black hover:bg-yellow-500"
                         >
                            20 G
                         </button>
                    </div>
                </div>

                <button 
                    onClick={toggleShop}
                    className={`mt-auto px-6 py-3 font-bold rounded border border-zinc-500 w-full ${state.current.wasPlayingBeforeShop ? 'bg-green-600 text-white' : 'bg-zinc-700 text-white'}`}
                >
                    {state.current.wasPlayingBeforeShop ? "RESUME MISSION (M)" : "BACK (M)"}
                </button>
             </div>
        )}

        {uiGameState === GameState.LEADERBOARD_INPUT && (
            <div className="absolute inset-0 flex flex-col items-center justify-start bg-zinc-900 z-20 p-8 overflow-y-auto">
                <h2 className="text-2xl text-yellow-400 mb-6 font-bold">TOP PILOTS</h2>
                {loadingScores ? (
                    <p className="text-zinc-500">Loading data...</p>
                ) : (
                    <table className="w-full max-w-md text-left text-sm">
                        <thead>
                            <tr className="text-zinc-500 border-b border-zinc-700">
                                <th className="pb-2">RANK</th>
                                <th className="pb-2">PILOT</th>
                                <th className="pb-2 text-right">SCORE</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono">
                            {leaderboard.map((entry, idx) => (
                                <tr key={idx} className={idx < 3 ? "text-yellow-200" : "text-zinc-300"}>
                                    <td className="py-2 text-zinc-500">#{idx + 1}</td>
                                    <td className="py-2">{entry.name}</td>
                                    <td className="py-2 text-right text-green-400">{entry.score}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <button 
                    onClick={startGame}
                    className="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded"
                >
                    NEW MISSION
                </button>
            </div>
        )}
      </div>

      {/* 2. BOTTOM: Control Panel (Totally separate div) */}
      <div className="w-full max-w-[600px] bg-zinc-800 border-x-4 border-b-4 border-zinc-800 rounded-b-xl p-2 flex flex-col shadow-2xl relative z-10 box-border" style={{ height: '40%' }}>
         {/* Decorative Lines */}
         <div className="w-full h-1 bg-black/20 mb-2"></div>
         
         <div className="flex items-center justify-between h-full px-2 pb-2">
            {/* D-PAD (LARGE) */}
            <div className="grid grid-cols-3 gap-1 w-48 h-48 bg-zinc-700/50 p-2 rounded-full shadow-inner shrink-0 scale-90 md:scale-100 origin-bottom-left">
                 {/* UP */}
                 <div className="col-start-2">
                    <button 
                    className="w-full h-full bg-zinc-900 border-2 border-zinc-600 rounded-lg hover:bg-zinc-800 active:bg-black active:scale-95 transition-all flex items-center justify-center text-zinc-500 text-2xl font-black"
                    onTouchStart={(e) => handleTouchBtn('ArrowUp', true, e)}
                    onTouchEnd={(e) => handleTouchBtn('ArrowUp', false, e)}
                    onMouseDown={(e) => handleTouchBtn('ArrowUp', true, e)}
                    onMouseUp={(e) => handleTouchBtn('ArrowUp', false, e)}
                    >▲</button>
                </div>
                {/* LEFT */}
                <div className="col-start-1 row-start-2">
                    <button 
                    className="w-full h-full bg-zinc-900 border-2 border-zinc-600 rounded-lg hover:bg-zinc-800 active:bg-black active:scale-95 transition-all flex items-center justify-center text-zinc-500 text-2xl font-black"
                    onTouchStart={(e) => handleTouchBtn('ArrowLeft', true, e)}
                    onTouchEnd={(e) => handleTouchBtn('ArrowLeft', false, e)}
                    onMouseDown={(e) => handleTouchBtn('ArrowLeft', true, e)}
                    onMouseUp={(e) => handleTouchBtn('ArrowLeft', false, e)}
                    >◀</button>
                </div>
                {/* RIGHT */}
                <div className="col-start-3 row-start-2">
                    <button 
                    className="w-full h-full bg-zinc-900 border-2 border-zinc-600 rounded-lg hover:bg-zinc-800 active:bg-black active:scale-95 transition-all flex items-center justify-center text-zinc-500 text-2xl font-black"
                    onTouchStart={(e) => handleTouchBtn('ArrowRight', true, e)}
                    onTouchEnd={(e) => handleTouchBtn('ArrowRight', false, e)}
                    onMouseDown={(e) => handleTouchBtn('ArrowRight', true, e)}
                    onMouseUp={(e) => handleTouchBtn('ArrowRight', false, e)}
                    >▶</button>
                </div>
                {/* DOWN */}
                <div className="col-start-2 row-start-3">
                    <button 
                    className="w-full h-full bg-zinc-900 border-2 border-zinc-600 rounded-lg hover:bg-zinc-800 active:bg-black active:scale-95 transition-all flex items-center justify-center text-zinc-500 text-2xl font-black"
                    onTouchStart={(e) => handleTouchBtn('ArrowDown', true, e)}
                    onTouchEnd={(e) => handleTouchBtn('ArrowDown', false, e)}
                    onMouseDown={(e) => handleTouchBtn('ArrowDown', true, e)}
                    onMouseUp={(e) => handleTouchBtn('ArrowDown', false, e)}
                    >▼</button>
                </div>
            </div>

            {/* CENTER CONSOLE */}
            <div className="flex flex-col gap-2 items-center justify-center h-full">
                <div className="text-zinc-500 font-bold text-xs tracking-widest">SYSTEM</div>
                <div className="flex flex-col gap-3">
                     {/* NUKE BUTTON (Conditional) */}
                    <button 
                        onClick={activateNuke}
                        disabled={inventory.nukes <= 0}
                        className={`w-20 h-10 rounded border-b-2 active:border-0 active:translate-y-0.5 text-[10px] text-white font-bold tracking-widest shadow transition-colors flex items-center justify-center ${inventory.nukes > 0 ? 'bg-orange-600 border-orange-800 animate-pulse' : 'bg-zinc-700 border-zinc-900 text-zinc-500'}`}
                    >
                        NUKE ({inventory.nukes})
                    </button>

                    <button 
                        onClick={toggleShop}
                        className="w-20 h-8 bg-blue-900 rounded border-b-2 border-blue-950 active:border-0 active:translate-y-0.5 text-[8px] text-white font-bold tracking-widest shadow"
                    >
                        MARKET
                    </button>
                    <button 
                        onClick={() => setUiGameState(GameState.START)}
                        className="w-20 h-8 bg-zinc-600 rounded border-b-2 border-zinc-900 active:border-0 active:translate-y-0.5 text-[8px] text-white font-bold tracking-widest shadow"
                    >
                        RESET
                    </button>
                </div>
            </div>

            {/* FIRE BTN (LARGE) */}
            <div className="flex items-center justify-center shrink-0">
                <button 
                className="w-32 h-32 md:w-36 md:h-36 bg-red-600 border-b-8 border-red-900 rounded-full active:bg-red-700 active:border-b-0 active:translate-y-2 shadow-lg flex items-center justify-center font-black text-white tracking-tighter select-none transition-all text-2xl scale-90 md:scale-100 origin-bottom-right"
                onTouchStart={(e) => handleTouchBtn('Space', true, e)}
                onTouchEnd={(e) => handleTouchBtn('Space', false, e)}
                onMouseDown={(e) => handleTouchBtn('Space', true, e)}
                onMouseUp={(e) => handleTouchBtn('Space', false, e)}
                >
                FIRE
                </button>
            </div>
         </div>
      </div>
    </div>
  );
};
