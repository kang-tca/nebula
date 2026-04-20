/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { 
  Rocket, 
  Trophy, 
  Play, 
  RotateCcw, 
  Gamepad2, 
  Settings2,
  Info
} from "lucide-react";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { db, type ScoreEntry as FirestoreScoreEntry } from "./lib/firebase";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  orderBy, 
  limit, 
  onSnapshot 
} from "firebase/firestore";

// --- Types ---

interface Entity {
  x: number;
  y: number;
  radius: number;
}

interface Meteor extends Entity {
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  level: number; // 4: Giant, 3: Large, 2: Medium, 1: Small
  hp: number;
  maxHp: number;
}

interface Missile extends Entity {
  speed: number;
  vx?: number;
  vy?: number;
  isHoming?: boolean;
}

interface Item extends Entity {
  type: "SPEED" | "POWER" | "FAST" | "SHIELD";
  vx: number;
  vy: number;
}

interface Boss extends Entity {
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  width: number;
  height: number;
  lastShot: number;
  phase: number;
  type: "CORE" | "FLARE" | "ORBITER";
}

interface BossBullet extends Entity {
  vx: number;
  vy: number;
}

interface Particle extends Entity {
  vx: number;
  vy: number;
  life: number;
  color: string;
}

type GameStatus = "MENU" | "PLAYING" | "REST" | "GAMEOVER";

interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
}

interface Upgrades {
  drones: number;
  laser: boolean;
  bombs: number;
  hull: number;
  homing: boolean;
}

// --- Constants ---

const PLAYER_RADIUS = 15;
const INITIAL_SPEED = 1.2;
const SPEED_INCREMENT = 0.00012; // 3x faster difficulty scaling
const SPAWN_RATE = 0.02;

const FIRE_RATE_BASE = 30; 
const MISSILE_SPEED = 12;
const ITEM_SPAWN_CHANCE = 0.2; 

const SHIELD_DURATION = 300; // frames (~5 seconds)
const METEOR_HP_MAP = [0, 1, 2, 4, 8]; // hp per level
const METEOR_SIZE_MAP = [0, 15, 28, 45, 75];

const BOSS_TRIGGER_SCORE = 2500;
const CLIMATE_FACTS = [
  "전 세계 평균 기온은 산업화 이전보다 약 1.1도 상승했습니다.",
  "해수면은 지난 100년간 약 20cm 상승했습니다.",
  "북극의 빙하는 10년마다 약 13%씩 감소하고 있습니다.",
  "육류 소비를 줄이는 것만으로도 탄소 배출을 크게 줄일 수 있습니다.",
  "플라스틱은 분해되는 데 500년 이상이 걸립니다.",
  "나무 한 그루는 연간 약 22kg의 이산화탄소를 흡수합니다."
];

const CLIMATE_QUIZZES: QuizQuestion[] = [
  { question: "지구 온난화의 가장 큰 원인인 온실가스는?", options: ["산소", "이산화탄소", "질소", "아르곤"], correct: 1 },
  { question: "해수면 상승으로 사라질 위기에 처한 섬나라는?", options: ["몰디브", "일본", "영국", "제주도"], correct: 0 },
  { question: "태양광, 풍력 등 자연에서 얻는 에너지를 무엇이라 하나요?", options: ["화석 연료", "재생 에너지", "원자력", "화학 에너지"], correct: 1 },
  { question: "지구를 자외선으로부터 보호해주는 층의 이름은?", options: ["오존층", "대기권", "성층권", "열권"], correct: 0 },
  { question: "북극곰의 서식지가 줄어드는 주된 이유는?", options: ["먹이 증가", "해빙 감소", "화산 폭발", "해류 변화"], correct: 1 },
  { question: "재활용 분리배출 시 페트병에서 반드시 제거해야 하는 것은?", options: ["라벨과 뚜껑", "내부 잔여물만", "바닥 부분", "입구 부분"], correct: 0 },
  { question: "탄소 발자국을 줄이기 위한 올바른 행동은?", options: ["가까운 거리 차 타기", "일회용품 쓰기", "육류 섭취 줄이기", "전등 켜두기"], correct: 2 },
  { question: "미세먼지 농도가 높은 날 외출 시 필수품은?", options: ["선글라스", "식약처 인증 마스크", "우산", "면장갑"], correct: 1 },
  { question: "에너지 효율 등급이 몇 등급일수록 전기가 적게 드나요?", options: ["1등급", "3등급", "5등급", "9등급"], correct: 0 },
  { question: "플라스틱이 바다로 흘러가 잘게 부서진 것을 무엇이라 하나요?", options: ["나노 플라스틱", "마이크로 플라스틱", "바이오 플라스틱", "폐플라스틱"], correct: 1 },
  { question: "나무 한 그루가 1년 동안 흡수하는 이산화탄소 양은 약 얼마인가요?", options: ["약 2.2kg", "약 22kg", "약 220kg", "약 2200kg"], correct: 1 },
  { question: "여름철 실내 적정 냉방 온도는 몇 도인가요?", options: ["18~20도", "22~24도", "26~28도", "30~32도"], correct: 2 },
  { question: "친환경 자동차가 아닌 것은?", options: ["전기차", "수소차", "하이브리드차", "경유차"], correct: 3 },
  { question: "지구의 날(Earth Day)은 매년 몇 월 몇 일인가요?", options: ["3월 22일", "4월 5일", "4월 22일", "6월 5일"], correct: 2 },
  { question: "음식물 쓰레기를 줄이는 가장 좋은 방법은?", options: ["먹을 만큼만 조리하기", "건조기 사용하기", "종량제 봉투 쓰기", "분쇄기 설치하기"], correct: 0 },
  { question: "전자제품을 쓰지 않을 때 대기전력을 차단하는 방법은?", options: ["전원 끄기", "코드 뽑기", "절전 모드 사용", "덮개 씌우기"], correct: 1 },
  { question: "에너지 절약을 위해 커튼을 사용하는 이유는?", options: ["단열 효과", "미관상 좋음", "먼지 차단", "소음 방지"], correct: 0 },
  { question: "물 부족 현상을 해결하기 위한 행동이 아닌 것은?", options: ["양치컵 사용", "샤워 시간 단축", "설거지통 사용", "물 틀어놓고 씻기"], correct: 3 },
  { question: "종이를 아껴 쓰는 것이 환경에 좋은 이유는?", options: ["나무를 살릴 수 있어서", "공간이 넓어져서", "가벼워져서", "값이 싸서"], correct: 0 },
  { question: "기후 변화로 인해 발생하는 자연재해가 아닌 것은?", options: ["강력한 태풍", "대규모 산불", "극심한 가뭄", "지각 변동"], correct: 3 }
];

const SHOP_ITEMS = [
  { id: "drone", name: "보조 비행기 (Drone)", price: 800, desc: "함께 사격하는 드론을 추가합니다. (최대 2대)" },
  { id: "laser", name: "고출력 레이저 (Laser)", price: 1500, desc: "관통하는 레이저포로 주무기를 교체합니다." },
  { id: "homing", name: "유도 미사일 (Homing)", price: 1200, desc: "적을 추적하는 소형 유탄을 추가로 발사합니다." },
  { id: "bomb", name: "플라즈마 폭탄 (Bomb)", price: 600, desc: "화면의 모든 위협을 제거합니다. (단축키: Space)" },
  { id: "repair", name: "긴급 수리 (Repair)", price: 300, desc: "선체 내구도를 1 회복합니다. (최대치 초과 불가)" },
  { id: "hull", name: "선체 확장 (Hull Max)", price: 1000, desc: "최대 내구도 한도를 1 늘립니다." }
];

// --- Sound Manager ---
const createSoundManager = () => {
  if (typeof window === "undefined") return null;
  
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  const playPulse = (freq: number, duration: number, volume: number = 0.5, type: OscillatorType = "sine") => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  const playNoise = (duration: number, volume: number = 0.5) => {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    noise.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start();
    noise.stop(ctx.currentTime + duration);
  };

  return {
    laser: () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    },
    explosion: (scale: number = 1) => {
      playNoise(0.2 * scale, 0.4);
      playPulse(100, 0.2 * scale, 0.3, "square");
    },
    hit: () => {
      playPulse(150, 0.3, 0.4, "sawtooth");
    },
    item: () => {
      playPulse(523.25, 0.1, 0.2); // C5
      setTimeout(() => playPulse(659.25, 0.1, 0.2), 50); // E5
      setTimeout(() => playPulse(783.99, 0.2, 0.2), 100); // G5
    },
    bomb: () => {
      playNoise(1.5, 0.6);
      playPulse(60, 1.5, 0.5, "square");
    },
    click: () => {
      playPulse(440, 0.05, 0.1);
    },
    correct: () => {
      playPulse(880, 0.1, 0.3);
      setTimeout(() => playPulse(1108.73, 0.1, 0.3), 100);
      setTimeout(() => playPulse(1318.51, 0.3, 0.3), 200);
    },
    incorrect: () => {
      playPulse(220, 0.2, 0.4, "sawtooth");
      setTimeout(() => playPulse(110, 0.4, 0.4, "sawtooth"), 150);
    },
    bossHit: () => {
      playNoise(0.05, 0.2);
    }
  };
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<ReturnType<typeof createSoundManager>>(null);
  const [status, setStatus] = useState<GameStatus>("MENU");
  const [score, setScore] = useState(0);
  const [stage, setStage] = useState(1);
  const [currency, setCurrency] = useState(0);
  const [upgrades, setUpgrades] = useState<Upgrades>({
    drones: 0,
    laser: false,
    bombs: 0,
    hull: 3,
    homing: false
  });
  const [playerHp, setPlayerHp] = useState(3);
  const [activeFact, setActiveFact] = useState<string | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<"CORRECT" | "INCORRECT" | null>(null);
  const [powerUps, setPowerUps] = useState({ 
    speed: 1, 
    powerLevel: 1, 
    fireRate: 1,
    shield: 0 
  });
  const [currentQuiz, setCurrentQuiz] = useState<QuizQuestion | null>(null);
  const [usedQuizzes, setUsedQuizzes] = useState<number[]>([]);
  const [quizResolved, setQuizResolved] = useState(false);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("astro-dodge-highscore") || "0");
    }
    return 0;
  });

  useEffect(() => {
    soundRef.current = createSoundManager();
  }, []);

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<FirestoreScoreEntry[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);

  // Mutable game state
  const gameState = useRef({
    player: { 
      x: 0, 
      y: 0, 
      targetX: 0, 
      targetY: 0
    },
    meteors: [] as Meteor[],
    missiles: [] as Missile[],
    bosses: [] as Boss[],
    bossBullets: [] as BossBullet[],
    items: [] as Item[],
    particles: [] as Particle[],
    stars: [] as { x: number; y: number; size: number; alpha: number }[],
    frameCount: 0,
    speedMultiplier: 1,
    screenShake: 0,
    nextBossScore: BOSS_TRIGGER_SCORE,
    bossPhase: 1,
    droneOffsets: [{x: -30, y: 10}, {x: 30, y: 10}],
    isBossMode: false
  });

  // --- Game Logic ---

  const initGame = useCallback((isNewGame: boolean = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isNewGame) {
      setScore(0);
      setCurrency(0);
      setStage(1);
      setPlayerHp(3);
      setUpgrades({ drones: 0, laser: false, bombs: 0, hull: 3, homing: false });
      setPowerUps({ speed: 1, powerLevel: 1, fireRate: 1, shield: 0 });
      setUsedQuizzes([]);
    } else {
      setPlayerHp(upgrades.hull); 
    }

    gameState.current = {
      ...gameState.current,
      player: { 
        x: canvas.width / 2, 
        y: canvas.height * 0.8,
        targetX: canvas.width / 2,
        targetY: canvas.height * 0.8
      },
      meteors: [],
      missiles: [],
      bosses: [],
      bossBullets: [],
      items: [],
      particles: [],
      frameCount: 0,
      speedMultiplier: 1 + (stage - 1) * 0.25,
      screenShake: 0,
      nextBossScore: score + BOSS_TRIGGER_SCORE + (stage * 1000),
      bossPhase: stage,
      isBossMode: false
    };
    setActiveFact(null);
  }, [stage, score, upgrades, powerUps]);

  const spawnBoss = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const phase = gameState.current.bossPhase;
    gameState.current.isBossMode = true;

    // Boss 1: Main Core
    const coreHp = 200 + phase * 200;
    gameState.current.bosses.push({
      x: canvas.width / 2,
      y: -200,
      radius: 80,
      width: 160,
      height: 160,
      vx: 1.5 + phase * 0.4,
      vy: 1,
      hp: coreHp,
      maxHp: coreHp,
      lastShot: 0,
      phase,
      type: "CORE"
    });

    // Boss 2: Side Orbiters (Stage 3+)
    if (phase >= 3) {
       const orbHp = 100 + phase * 50;
       gameState.current.bosses.push({
          x: canvas.width * 0.2, y: -400, radius: 40, width: 80, height: 80,
          vx: 3, vy: 0.5, hp: orbHp, maxHp: orbHp, lastShot: 0, phase, type: "ORBITER"
       });
       gameState.current.bosses.push({
          x: canvas.width * 0.8, y: -400, radius: 40, width: 80, height: 80,
          vx: -3, vy: 0.5, hp: orbHp, maxHp: orbHp, lastShot: 0, phase, type: "ORBITER"
       });
    }

    setActiveFact(phase >= 3 ? "경고: 다수의 고에너지 반응 감지! 태양계 포식군이 접근합니다." : "경고: 태양 이상 활동 극심! 거대 플레어 코어가 접근 중입니다.");
    setTimeout(() => setActiveFact(null), 4000);
  }, []);

  const spawnMeteor = useCallback((x?: number, y?: number, level: number = 3) => {
    const { isBossMode, bossPhase } = gameState.current;
    // Allow meteors during boss in later stages (stage 4+)
    if (isBossMode && bossPhase < 4) return; 
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = METEOR_SIZE_MAP[level];
    const hp = METEOR_HP_MAP[level];
    
    gameState.current.meteors.push({
      x: x !== undefined ? x : Math.random() * canvas.width,
      y: y !== undefined ? y : -size,
      vx: (Math.random() - 0.5) * 2 * gameState.current.speedMultiplier,
      vy: (INITIAL_SPEED + Math.random() * 0.8) * gameState.current.speedMultiplier * (1 + (4 - level) * 0.1),
      radius: size * 0.85,
      size,
      level,
      hp,
      maxHp: hp,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.08,
    });
  }, []);

  const spawnItem = useCallback((x: number, y: number) => {
    const types: ("SPEED" | "POWER" | "FAST" | "SHIELD")[] = ["SPEED", "POWER", "FAST", "SHIELD"];
    const type = types[Math.floor(Math.random() * types.length)];
    gameState.current.items.push({
      x,
      y,
      radius: 15,
      type,
      vx: (Math.random() - 0.5) * 3,
      vy: 1.5,
    });
  }, []);

  const fireMissile = useCallback(() => {
    const { player, missiles } = gameState.current;
    const level = powerUps.powerLevel;

    const spawn = (x: number, y: number, r: number = 4, isHoming: boolean = false) => {
      missiles.push({ x, y, radius: r, speed: MISSILE_SPEED, isHoming });
    };

    if (upgrades.laser) {
       spawn(player.x, player.y - 30, 8); 
    }

    if (level === 1) {
      spawn(player.x, player.y - 15, 5);
    } else if (level === 2) {
      spawn(player.x - 10, player.y - 10);
      spawn(player.x + 10, player.y - 10);
    } else if (level === 3) {
      spawn(player.x, player.y - 20, 5);
      spawn(player.x - 15, player.y - 5);
      spawn(player.x + 15, player.y - 5);
    } else {
      spawn(player.x - 8, player.y - 20);
      spawn(player.x + 8, player.y - 20);
      spawn(player.x - 20, player.y - 5);
      spawn(player.x + 20, player.y - 5);
    }

    // Drone shots
    for(let i=0; i<upgrades.drones; i++) {
        const offset = gameState.current.droneOffsets[i];
        spawn(player.x + offset.x, player.y + offset.y, 3);
    }

    // Guided Missiles (Small Homing Volley)
    if (upgrades.homing && gameState.current.frameCount % 60 === 0) {
       spawn(player.x - 25, player.y, 3, true);
       spawn(player.x + 25, player.y, 3, true);
    }
  }, [powerUps, upgrades]);

  const createParticles = useCallback((x: number, y: number, color: string) => {
    for (let i = 0; i < 10; i++) {
      gameState.current.particles.push({
        x,
        y,
        radius: Math.random() * 3,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 1.0,
        color,
      });
    }
  }, []);

  const update = useCallback(() => {
    if (status !== "PLAYING") return;

    const { player, meteors, missiles, items, particles, stars } = gameState.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    gameState.current.frameCount++;
    gameState.current.speedMultiplier += SPEED_INCREMENT;

    // Movement smoothing
    const moveSpeed = 0.15 * powerUps.speed;
    player.x += (player.targetX - player.x) * moveSpeed;
    player.y += (player.targetY - player.y) * moveSpeed;

    // Constrain player
    player.x = Math.max(PLAYER_RADIUS, Math.min(canvas.width - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(canvas.height - PLAYER_RADIUS, player.y));

    // Boss Trigger
    if (!gameState.current.isBossMode && score >= gameState.current.nextBossScore) {
      spawnBoss();
    }

    // Update Bosses
    if (gameState.current.bosses.length > 0) {
      gameState.current.bosses.forEach((b, bIndex) => {
        // Entry
        if (b.y < 150) b.y += b.vy;
        
        // Movement
        b.x += b.vx;
        if (b.x < b.width / 2 || b.x > canvas.width - b.width / 2) b.vx *= -1;

        // Pattern logic
        const shotInterval = Math.max(15, 50 - b.phase * 5);
        if (gameState.current.frameCount % shotInterval === 0) {
          if (b.type === "CORE") {
             // Spiral pattern
             const angles = 8;
             for(let i=0; i<angles; i++) {
               const ang = (i / angles) * Math.PI * 2 + (gameState.current.frameCount * 0.01);
               gameState.current.bossBullets.push({ 
                  x: b.x, y: b.y, radius: 5, 
                  vx: Math.cos(ang) * (4 + b.phase * 0.5), 
                  vy: Math.sin(ang) * (4 + b.phase * 0.5) 
               });
             }
          } else {
             // Tracking shot
             const dx = player.x - b.x;
             const dy = player.y - b.y;
             const dist = Math.sqrt(dx*dx + dy*dy);
             gameState.current.bossBullets.push({
                x: b.x, y: b.y, radius: 4,
                vx: (dx / dist) * 7,
                vy: (dy / dist) * 7
             });
          }
        }

        // Check collision with missiles
        for (let j = missiles.length - 1; j >= 0; j--) {
          const ms = missiles[j];
          if (ms.x > b.x - b.width/2 && ms.x < b.x + b.width/2 &&
              ms.y > b.y - b.height/2 && ms.y < b.y + b.height/2) {
            missiles.splice(j, 1);
            b.hp -= 1;
            soundRef.current?.bossHit();
            createParticles(ms.x, ms.y, "#00f2ff");
            if (b.hp <= 0) {
              soundRef.current?.explosion(2);
              createParticles(b.x, b.y, "#ff0055");
              gameState.current.screenShake = 20;
              gameState.current.bosses.splice(bIndex, 1);
              setScore(prev => prev + 500);
              setCurrency(prev => prev + 250);
              spawnItem(b.x, b.y);
            }
          }
        }

        // Transition check
        if (gameState.current.bosses.length === 0) {
           gameState.current.speedMultiplier += 0.2;
           // Delay for rest screen - keep isBossMode true while transitioning
           setTimeout(() => {
             gameState.current.isBossMode = false;
             // Pick unique quiz
             let qIndex = Math.floor(Math.random() * CLIMATE_QUIZZES.length);
             while (usedQuizzes.includes(qIndex) && usedQuizzes.length < CLIMATE_QUIZZES.length) {
                qIndex = Math.floor(Math.random() * CLIMATE_QUIZZES.length);
             }
             setUsedQuizzes(prev => [...prev, qIndex]);
             setCurrentQuiz(CLIMATE_QUIZZES[qIndex]);
             setQuizResolved(false);
             setStatus("REST");
           }, 2000);
        }
      });
    }

    // Update Boss Bullets
    for (let i = gameState.current.bossBullets.length - 1; i >= 0; i--) {
      const bb = gameState.current.bossBullets[i];
      bb.x += bb.vx;
      bb.y += bb.vy;
      
      const dx = bb.x - player.x;
      const dy = bb.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bb.radius + PLAYER_RADIUS) {
        if (powerUps.shield > 0) {
          gameState.current.bossBullets.splice(i, 1);
          createParticles(bb.x, bb.y, "#00f2ff");
        } else {
          soundRef.current?.hit();
          gameState.current.bossBullets.splice(i, 1);
          setPlayerHp(prev => {
            const next = prev - 1;
            if (next <= 0) setStatus("GAMEOVER");
            return Math.max(0, next);
          });
          createParticles(player.x, player.y, "#ff0055");
        }
      }
      
      if (bb.y > canvas.height + 100 || bb.y < -100 || bb.x < -100 || bb.x > canvas.width + 100) {
         gameState.current.bossBullets.splice(i, 1);
      }
    }

    // Auto Firing
    const currentFireRate = Math.max(8, FIRE_RATE_BASE / powerUps.fireRate);
    if (gameState.current.frameCount % Math.floor(currentFireRate) === 0) {
      soundRef.current?.laser();
      fireMissile();
    }

    // Shield Timer
    if (powerUps.shield > 0) {
      setPowerUps(prev => ({ ...prev, shield: prev.shield - 1 }));
    }

    // Spawn meteors (Block during boss transition unless stage is high)
    if (!gameState.current.isBossMode || gameState.current.bossPhase >= 4) {
      const adjustedSpawnRate = SPAWN_RATE * (1 + (gameState.current.speedMultiplier - 1) * 1.5);
      if (Math.random() < adjustedSpawnRate) {
        const level = Math.random() < 0.15 ? 4 : Math.random() < 0.4 ? 3 : 2;
        spawnMeteor(undefined, undefined, level);
      }
    }

    // Update Missiles (including Homing)
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (m.isHoming) {
         // Find nearest target
         let closest: (Boss | Meteor | null) = null;
         let minDist = 1000;
         gameState.current.bosses.forEach(b => {
            const d = Math.sqrt((b.x-m.x)**2 + (b.y-m.y)**2);
            if (d < minDist) { minDist = d; closest = b; }
         });
         meteors.forEach(met => {
            const d = Math.sqrt((met.x-m.x)**2 + (met.y-m.y)**2);
            if (d < minDist) { minDist = d; closest = met; }
         });

         if (closest) {
            const dx = closest.x - m.x;
            const dy = closest.y - m.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const vx = (dx / dist) * 8;
            const vy = (dy / dist) * 8;
            m.x += vx;
            m.y += vy;
         } else {
            m.y -= 10;
         }
      } else {
         m.y -= m.speed;
      }

      if (m.y < -20 || m.x < -20 || m.x > canvas.width + 20) {
        missiles.splice(i, 1);
      }
    }

    // Update Items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.x += it.vx;
      it.y += it.vy;
      
      const dx = it.x - player.x;
      const dy = it.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < it.radius + PLAYER_RADIUS) {
        // Collect!
        soundRef.current?.item();
        setPowerUps(prev => ({
          speed: it.type === "SPEED" ? prev.speed + 0.15 : prev.speed,
          powerLevel: it.type === "POWER" ? Math.min(4, prev.powerLevel + 1) : prev.powerLevel,
          fireRate: it.type === "FAST" ? prev.fireRate + 0.4 : prev.fireRate,
          shield: it.type === "SHIELD" ? SHIELD_DURATION : prev.shield
        }));
        items.splice(i, 1);
        setScore(prev => prev + 100);
        
        // Educational fact trigger
        if (Math.random() < 0.2) {
          setActiveFact(CLIMATE_FACTS[Math.floor(Math.random() * CLIMATE_FACTS.length)]);
          setTimeout(() => setActiveFact(null), 4000);
        }
        continue;
      }

      if (it.y > canvas.height + 20) items.splice(i, 1);
    }

    // Update meteors
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx;
      m.y += m.vy;
      m.rotation += m.rotationSpeed;

      // Bounce off walls
      if (m.x < m.size || m.x > canvas.width - m.size) {
        m.vx *= -1;
      }

      // Collision check with player
      const dxP = m.x - player.x;
      const dyP = m.y - player.y;
      const distP = Math.sqrt(dxP * dxP + dyP * dyP);

      if (distP < m.radius + PLAYER_RADIUS) {
        if (powerUps.shield > 0) {
          // Shield absorbs!
          soundRef.current?.bossHit();
          createParticles(m.x, m.y, "#00f2ff");
          m.hp -= 2; // Damage meteor
          gameState.current.screenShake = 5;
          if (m.hp <= 0) {
            soundRef.current?.explosion(m.level/2);
            createParticles(m.x, m.y, "#475569");
            
            // Drop item probability from ANY level (Higher for low levels, but possible for all)
            const dropChance = (4 - m.level) * 0.1 + 0.1; // Level 1: 0.4, Level 4: 0.1
            if (Math.random() < dropChance) {
              spawnItem(m.x, m.y);
            }

            if (m.level > 1) {
              spawnMeteor(m.x - 15, m.y, m.level - 1);
              spawnMeteor(m.x + 15, m.y, m.level - 1);
            }
            meteors.splice(i, 1);
            setScore(prev => prev + (m.level * 25));
          }
          continue;
        } else {
          soundRef.current?.hit();
          createParticles(player.x, player.y, "#ff0055");
          createParticles(m.x, m.y, "#475569");
          gameState.current.screenShake = 15;
          setPlayerHp(prev => {
             const next = prev - 1;
             if (next <= 0) setStatus("GAMEOVER");
             return Math.max(0, next);
          });
          meteors.splice(i, 1); // Remove the meteor that hit us
          continue;
        }
      }

      // Collision check with missiles
      for (let j = missiles.length - 1; j >= 0; j--) {
        const ms = missiles[j];
        const dxM = m.x - ms.x;
        const dyM = m.y - ms.y;
        const distM = Math.sqrt(dxM * dxM + dyM * dyM);

        if (distM < m.radius + ms.radius) {
          missiles.splice(j, 1);
          m.hp -= 1;
          createParticles(ms.x, ms.y, "#00f2ff");
          
          if (m.hp <= 0) {
            createParticles(m.x, m.y, "#475569");

            // Probability to drop items from any meteor level
            const dropChance = (4 - m.level) * 0.1 + 0.1; 
            if (Math.random() < dropChance) {
              spawnItem(m.x, m.y);
            }

            if (m.level > 1) {
              spawnMeteor(m.x - 12, m.y, m.level - 1);
              spawnMeteor(m.x + 12, m.y, m.level - 1);
            }
            meteors.splice(i, 1);
            setScore(prev => prev + (m.level * 25));
            break;
          }
        }
      }

      // Remove off-screen
      if (m.y > canvas.height + m.size * 2) {
        meteors.splice(i, 1);
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Update stars (slow scroll)
    stars.forEach(s => {
      s.y += 0.5 * gameState.current.speedMultiplier;
      if (s.y > canvas.height) {
        s.y = 0;
        s.x = Math.random() * canvas.width;
      }
    });

    if (gameState.current.screenShake > 0) {
      gameState.current.screenShake *= 0.9;
    }
  }, [status, spawnMeteor, spawnItem, fireMissile, createParticles, powerUps]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Screen Shake
    ctx.save();
    if (gameState.current.screenShake > 0) {
      const sx = (Math.random() - 0.5) * gameState.current.screenShake;
      const sy = (Math.random() - 0.5) * gameState.current.screenShake;
      ctx.translate(sx, sy);
    }

    // Draw Stars
    ctx.fillStyle = "white";
    gameState.current.stars.forEach(s => {
      ctx.globalAlpha = s.alpha * (0.5 + Math.sin(gameState.current.frameCount * 0.05) * 0.5);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw Missiles
    gameState.current.missiles.forEach(m => {
      ctx.save();
      ctx.fillStyle = m.isHoming ? "#fbbf24" : "#00f2ff";
      ctx.shadowBlur = 10;
      ctx.shadowColor = m.isHoming ? "#fbbf24" : "#00f2ff";
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();
      
      if (m.isHoming) {
        // Simple trail or flare for homing missiles
        ctx.fillStyle = "#ff5500";
        ctx.beginPath();
        ctx.arc(m.x, m.y + 5, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    ctx.shadowBlur = 0;

    // Draw Items
    gameState.current.items.forEach(it => {
      ctx.save();
      ctx.translate(it.x, it.y);
      
      const config = {
        SPEED: { char: "S", color: "#fbbf24" },
        POWER: { char: "P", color: "#a855f7" },
        FAST: { char: "F", color: "#22c55e" },
        SHIELD: { char: "B", color: "#00f2ff" }
      };
      
      const { char, color } = config[it.type];
      
      ctx.fillStyle = color;
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      
      ctx.font = "bold 20px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      // Pulsing effect
      const scale = 1 + Math.sin(gameState.current.frameCount * 0.1) * 0.2;
      ctx.scale(scale, scale);
      
      ctx.fillText(char, 0, 0);
      
      // Outer ring
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
    });
    ctx.shadowBlur = 0;

    // Draw Bosses
    gameState.current.bosses.forEach(b => {
      ctx.save();
      ctx.translate(b.x, b.y);
      
      // Boss Body
      ctx.fillStyle = b.type === "CORE" ? "#1e1b4b" : "#450a0a";
      ctx.strokeStyle = "#ff0055";
      ctx.lineWidth = 3;
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#ff0055";
      
      ctx.beginPath();
      if (b.type === "CORE") {
          ctx.moveTo(-b.width/2, -b.height/4); ctx.lineTo(-b.width/4, -b.height/2);
          ctx.lineTo(b.width/4, -b.height/2); ctx.lineTo(b.width/2, -b.height/4);
          ctx.lineTo(b.width/2, b.height/4); ctx.lineTo(0, b.height/2);
          ctx.lineTo(-b.width/2, b.height/4);
      } else {
          // Orbiter shape
          ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Core Eye
      ctx.fillStyle = "#ff0055";
      const eyePantry = Math.sin(gameState.current.frameCount * 0.1) * 7;
      ctx.beginPath();
      ctx.arc(0, 0, (b.type === "CORE" ? 15 : 10) + eyePantry, 0, Math.PI * 2);
      ctx.fill();

      // Sun flare effects
      ctx.strokeStyle = "#fbbf24";
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, b.radius + 20 + eyePantry, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Boss Label
      ctx.rotate(0);
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(`${b.type === "CORE" ? "플레어 코어" : "궤도 탐사체"}`, 0, -b.height/2 - 25);
      
      // Mini HP bar
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(-b.width/2, b.height/2 + 10, b.width, 5);
      ctx.fillStyle = "#ff0055";
      ctx.fillRect(-b.width/2, b.height/2 + 10, b.width * (b.hp/b.maxHp), 5);

      ctx.restore();
      ctx.shadowBlur = 0;
    });

    // Draw Boss Bullets
    ctx.fillStyle = "#ff0055";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#ff0055";
    gameState.current.bossBullets.forEach(bb => {
      ctx.beginPath();
      ctx.arc(bb.x, bb.y, bb.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Draw Meteors
    meteorsBody: {
      gameState.current.meteors.forEach(m => {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.rotation);
        
        ctx.fillStyle = 
           m.level === 4 ? "#1e293b" : 
           m.level === 3 ? "#475569" : 
           m.level === 2 ? "#64748b" : "#94a3b8";
        
        ctx.strokeStyle = m.hp < m.maxHp ? "#ff0055" : "#94a3b8";
        ctx.lineWidth = 1.5 + (m.level * 0.5);
        
        ctx.beginPath();
        const sides = 5 + m.level;
        for (let i = 0; i < sides; i++) {
          const angle = (i / sides) * Math.PI * 2;
          const px = Math.cos(angle) * m.size;
          const py = Math.sin(angle) * m.size;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Health bar for large/giant
        if (m.level >= 3 && m.hp < m.maxHp) {
           ctx.rotate(-m.rotation); // un-rotate for text/bar
           ctx.fillStyle = "rgba(255,0,85,0.5)";
           ctx.fillRect(-20, -m.size - 10, 40, 4);
           ctx.fillStyle = "#ff0055";
           ctx.fillRect(-20, -m.size - 10, 40 * (m.hp/m.maxHp), 4);
        }
        
        ctx.restore();
      });
    }

    // Draw Particles
    gameState.current.particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw Player Ship
    const { player } = gameState.current;
    
    // Draw Drones
    for(let i=0; i<upgrades.drones; i++) {
        const offset = gameState.current.droneOffsets[i];
        ctx.save();
        ctx.translate(player.x + offset.x, player.y + offset.y);
        ctx.fillStyle = "#00f2ff";
        ctx.beginPath();
        ctx.moveTo(0, -10); ctx.lineTo(8, 5); ctx.lineTo(-8, 5); ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    ctx.save();
    ctx.translate(player.x, player.y);
    
    // Tilt based on horizontal speed
    const tilt = (player.targetX - player.x) * 0.05;
    ctx.rotate(tilt);

    // Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#00f2ff";
    
    // Ship Body
    ctx.fillStyle = "#fff"; // White ship body with cyan glow looks very "high-tech"
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(15, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-15, 10);
    ctx.closePath();
    ctx.fill();

    // cockpit
    ctx.fillStyle = "#00f2ff";
    ctx.beginPath();
    ctx.arc(0, -5, 5, 0, Math.PI * 2);
    ctx.fill();

    // engine flare
    if (status === "PLAYING") {
      ctx.fillStyle = "#00f2ff";
      const engineSize = 5 + Math.sin(gameState.current.frameCount * 0.5) * 5;
      ctx.beginPath();
      ctx.moveTo(-5, 10);
      ctx.lineTo(5, 10);
      ctx.lineTo(0, 10 + engineSize);
      ctx.fill();
    }

    // Shield Effect
    if (powerUps.shield > 0) {
      ctx.strokeStyle = "#00f2ff";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3 + Math.sin(gameState.current.frameCount * 0.2) * 0.2;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 10, 0, Math.PI * 2);
      ctx.stroke();
      
      // Progress bar around shield
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 12, -Math.PI/2, (-Math.PI/2) + (Math.PI * 2 * (powerUps.shield / SHIELD_DURATION)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.restore(); // for screen shake
  }, [status]);

  // --- Helpers ---

  const handlePointer = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (status !== "PLAYING") return;
    gameState.current.player.targetX = e.clientX;
    gameState.current.player.targetY = e.clientY;
  }, [status]);

  const useBomb = useCallback(() => {
    if (upgrades.bombs <= 0 || status !== "PLAYING") return;
    
    soundRef.current?.bomb();
    setUpgrades(prev => ({ ...prev, bombs: prev.bombs - 1 }));
    gameState.current.screenShake = 30;
    
    // Clear all meteors and boss bullets
    gameState.current.meteors.forEach(m => {
      createParticles(m.x, m.y, "#475569");
      setScore(prev => prev + 50);
    });
    gameState.current.meteors = [];
    
    gameState.current.bossBullets.forEach(bb => {
      createParticles(bb.x, bb.y, "#ff0055");
    });
    gameState.current.bossBullets = [];

    // Damage boss if present
    if (gameState.current.boss) {
      gameState.current.boss.hp -= 20;
      createParticles(gameState.current.boss.x, gameState.current.boss.y, "#ff0055");
    }

    setActiveFact("플라즈마 폭탄 투하! 위협 요소가 일시적으로 제거되었습니다.");
    setTimeout(() => setActiveFact(null), 2000);
  }, [upgrades.bombs, status, createParticles]);

  // --- Effects ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        useBomb();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [useBomb]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
        // Re-init stars on resize
        gameState.current.stars = Array.from({ length: 100 }, () => ({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          size: Math.random() * 2,
          alpha: Math.random(),
        }));
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let frameId: number;
    const loop = () => {
      update();
      draw();
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [update, draw]);

  useEffect(() => {
    if (status === "GAMEOVER") {
      setShowNameInput(true);
      if (score > highScore) {
        setHighScore(score);
        localStorage.setItem("astro-dodge-highscore", score.toString());
      }
    } else {
      setShowNameInput(false);
    }
  }, [status, score, highScore]);

  // Real-time leaderboard subscription
  useEffect(() => {
    const q = query(
      collection(db, "leaderboard"),
      orderBy("score", "desc"),
      limit(10)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const scores: FirestoreScoreEntry[] = [];
      snapshot.forEach((doc) => {
        scores.push(doc.data() as FirestoreScoreEntry);
      });
      setLeaderboard(scores);
    });

    return () => unsubscribe();
  }, []);

  // --- Handlers ---

  const saveScore = async () => {
    if (!playerName.trim() || isSaving) return;
    
    setIsSaving(true);
    try {
      await addDoc(collection(db, "leaderboard"), {
        playerName: playerName.trim().substring(0, 20),
        score: score,
        createdAt: serverTimestamp(),
      });
      setShowNameInput(false);
    } catch (error) {
      console.error("Error saving score:", error);
      alert("Failed to save score. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const startGame = () => {
    soundRef.current?.click();
    initGame(true);
    setStatus("PLAYING");
  };

  const startNextStage = () => {
    soundRef.current?.click();
    setStage(prev => prev + 1);
    initGame(false);
    setStatus("PLAYING");
  };

  const handleQuizAnswer = (index: number) => {
    if (quizResolved || !currentQuiz) return;
    if (index === currentQuiz.correct) {
      soundRef.current?.correct();
      setQuizFeedback("CORRECT");
      setCurrency(prev => prev + 500);
      setActiveFact("정답입니다! 정비 포인트 500을 획득했습니다.");
    } else {
       soundRef.current?.incorrect();
       setQuizFeedback("INCORRECT");
       setCurrency(prev => Math.max(0, prev - 200));
       setActiveFact("오답입니다. 정비 포인트 200이 삭감되었습니다.");
    }
    setQuizResolved(true);
    setTimeout(() => {
      setActiveFact(null);
      setQuizFeedback(null);
    }, 3000);
  };

  const buyItem = (item: typeof SHOP_ITEMS[0]) => {
     if (currency < item.price) return;
     
     soundRef.current?.click();
     if (item.id === "drone" && upgrades.drones < 2) {
        setUpgrades(prev => ({ ...prev, drones: prev.drones + 1 }));
        setCurrency(prev => prev - item.price);
     } else if (item.id === "laser" && !upgrades.laser) {
        setUpgrades(prev => ({ ...prev, laser: true }));
        setCurrency(prev => prev - item.price);
     } else if (item.id === "homing" && !upgrades.homing) {
        setUpgrades(prev => ({ ...prev, homing: true }));
        setCurrency(prev => prev - item.price);
     } else if (item.id === "bomb") {
        setUpgrades(prev => ({ ...prev, bombs: prev.bombs + 1 }));
        setCurrency(prev => prev - item.price);
     } else if (item.id === "repair") {
        if (playerHp >= upgrades.hull) {
           setActiveFact("이미 선체가 최상 상태입니다.");
           setTimeout(() => setActiveFact(null), 2000);
        } else {
           setPlayerHp(prev => prev + 1);
           setCurrency(prev => prev - item.price);
        }
     } else if (item.id === "hull") {
        setUpgrades(prev => ({ ...prev, hull: prev.hull + 1 }));
        setPlayerHp(prev => prev + 1);
        setCurrency(prev => prev - item.price);
     }
  };

  return (
    <div 
      className="relative w-full h-screen bg-[#05050a] overflow-hidden font-mono text-white select-none cursor-crosshair overflow-hidden"
      onPointerMove={handlePointer}
      style={{
        background: "radial-gradient(circle at 50% 50%, #1a1a3a 0%, #05050a 100%)"
      }}
    >
      <div className="scanlines" />
      
      {/* Background Stars (Static Layer) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full opacity-60"
      />

      {/* HUD Layer */}
      <div className="absolute top-10 left-10 right-10 flex justify-between items-start pointer-events-none z-50">
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-[rgba(10,10,20,0.8)] border border-[#00f2ff] p-4 shadow-[0_0_15px_rgba(0,242,255,0.2)] min-w-[200px]"
        >
          <div className="text-[10px] text-[#00f2ff] uppercase tracking-[2px] mb-1 font-bold">SHIP HULL INTEGRITY</div>
          <div className="text-2xl font-bold text-white [text-shadow:0_0_10px_#00f2ff] mb-2 uppercase flex gap-1">
             {Array.from({ length: upgrades.hull }).map((_, i) => (
               <div key={i} className={`w-3 h-5 border ${i < playerHp ? 'bg-[#00f2ff] border-[#00f2ff]' : 'bg-transparent border-white/20'}`} />
             ))}
          </div>
          <div className="text-[10px] text-white/50 uppercase">Stage {stage} {gameState.current.isBossMode ? " - BOSS ALERT" : ""}</div>
        </motion.div>

        <motion.div 
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-[rgba(10,10,20,0.8)] border border-[#00f2ff] p-4 shadow-[0_0_15px_rgba(0,242,255,0.2)] text-right min-w-[200px]"
        >
          <div className="text-[10px] text-[#00f2ff] uppercase tracking-[2px] mb-1 font-bold">NEBULA DEPTH</div>
          <motion.div 
            key={score}
            className="text-3xl font-bold text-white [text-shadow:0_0_10px_#00f2ff]"
          >
            {score.toLocaleString()} <span className="text-xs ml-1">KM</span>
          </motion.div>
          <div className="mt-2 text-[10px] text-white/40 uppercase tracking-widest">
            Best: {highScore.toLocaleString()}
          </div>
          
          {/* Power Up Indicators */}
          <div className="flex gap-2 justify-end mt-4">
            {powerUps.speed > 1 && (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border border-[#fbbf24] flex items-center justify-center text-[10px] text-[#fbbf24] font-bold">S</div>
                <div className="text-[8px] text-[#fbbf24] mt-1">x{Math.floor((powerUps.speed - 1) * 5) + 1}</div>
              </div>
            )}
            {powerUps.powerLevel > 1 && (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border border-[#a855f7] flex items-center justify-center text-[10px] text-[#a855f7] font-bold">P</div>
                <div className="text-[8px] text-[#a855f7] mt-1">x{powerUps.powerLevel}</div>
              </div>
            )}
            {powerUps.fireRate > 1 && (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border border-[#22c55e] flex items-center justify-center text-[10px] text-[#22c55e] font-bold">F</div>
                <div className="text-[8px] text-[#22c55e] mt-1">x{Math.floor((powerUps.fireRate - 1) * 2.5) + 1}</div>
              </div>
            )}
            {powerUps.shield > 0 && (
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 border border-[#00f2ff] flex items-center justify-center text-[10px] text-[#00f2ff] font-bold">B</div>
                <div className="w-6 h-1 bg-white/10 mt-1 overflow-hidden">
                   <div className="h-full bg-[#00f2ff]" style={{ width: `${(powerUps.shield/SHIELD_DURATION)*100}%` }} />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Cosmic Fact Overlay */}
      <AnimatePresence>
        {activeFact && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="absolute bottom-32 left-10 right-10 flex justify-center z-50 pointer-events-none"
          >
            <div className="bg-black/80 border-l-4 border-l-[#00f2ff] p-6 max-w-2xl backdrop-blur-md shadow-[20px_0_30px_rgba(0,242,255,0.1)]">
              <div className="text-[#00f2ff] text-[10px] uppercase tracking-[4px] mb-2 font-bold">Terminal Data Stream</div>
              <div className="text-white text-sm leading-relaxed font-mono italic">
                {activeFact}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlays */}
      <AnimatePresence>
        {/* Quiz Feedback Overlay */}
        {quizFeedback && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1.2 }}
            exit={{ opacity: 0, scale: 2 }}
            className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none"
          >
            <div className={`px-12 py-6 rounded-full border-4 font-black text-6xl tracking-tighter ${
              quizFeedback === "CORRECT" 
                ? "bg-green-500/20 border-green-500 text-green-400 shadow-[0_0_50px_rgba(34,197,94,0.5)]" 
                : "bg-red-500/20 border-red-500 text-red-400 shadow-[0_0_50px_rgba(239,68,68,0.5)]"
            }`}>
              {quizFeedback === "CORRECT" ? "PERFECT!" : "FAILED"}
            </div>
          </motion.div>
        )}

        {status === "MENU" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-[#05050a]/90 backdrop-blur-sm z-40"
          >
            <div className="max-w-4xl w-full p-12 flex flex-col md:flex-row gap-12 items-center">
              <div className="flex-1 text-center md:text-left space-y-12">
                <motion.div
                  initial={{ y: -20 }}
                  animate={{ y: 0 }}
                  className="space-y-4"
                >
                  <h1 className="text-7xl font-bold tracking-[-0.05em] uppercase text-white [text-shadow:0_0_30px_#00f2ff]">
                    EARTH ESCAPE
                  </h1>
                  <p className="text-[#00f2ff] text-sm uppercase tracking-[2px] font-bold max-w-md">
                    20XX년, 지구 온난화로 인해 인류는 거주 불가능한 환경에 직면했습니다. 당신은 새로운 행성을 찾아 떠나는 마지막 탈출함 '아크-1'의 파일럿입니다. 격렬한 태양 폭풍과 운석 지대를 뚫고 인류의 새 시대를 여세요.
                  </p>
                  <div className="h-0.5 w-32 bg-[#00f2ff] md:mx-0 mx-auto shadow-[0_0_10px_#00f2ff]" />
                  <p className="text-[#00f2ff]/60 uppercase tracking-[4px] text-xs">
                    Escape the impending collapse
                  </p>
                </motion.div>

                <div className="flex flex-col items-center md:items-start gap-6">
                  <motion.button
                    whileHover={{ scale: 1.05, boxShadow: "0 0 30px #00f2ff" }}
                    whileTap={{ scale: 0.95 }}
                    onMouseEnter={() => soundRef.current?.click()}
                    onClick={startGame}
                    className="px-16 py-6 border-2 border-[#00f2ff] bg-transparent text-[#00f2ff] font-bold text-2xl uppercase tracking-[4px] transition-all hover:bg-[#00f2ff] hover:text-black"
                  >
                    Initiate Launch
                  </motion.button>
                  <div className="text-[10px] text-white/40 uppercase tracking-[3px]">
                    [ Mouse / Touch ] To Navigate <br />
                    [ Space ] To Use Plasma Bomb
                  </div>
                </div>
              </div>

              {/* Leaderboard */}
              <div className="flex-1 w-full max-w-sm bg-black/40 border border-[#00f2ff]/20 p-6 backdrop-blur-md">
                <div className="text-xs text-[#00f2ff] font-bold uppercase tracking-[4px] mb-4 border-b border-[#00f2ff]/20 pb-2">Top Pilots</div>
                <div className="space-y-3">
                  {leaderboard.length === 0 ? (
                    <div className="text-[10px] text-white/20 uppercase tracking-widest text-center py-8 italic">No records found...</div>
                  ) : (
                    leaderboard.map((entry, i) => (
                      <div key={i} className="flex justify-between items-center text-[11px]">
                        <div className="flex gap-3 items-center">
                          <span className="text-[#00f2ff]/40 font-bold w-4">{i + 1}</span>
                          <span className="font-bold uppercase tracking-wider">{entry.playerName}</span>
                        </div>
                        <span className="text-[#00f2ff] font-bold">{entry.score.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {status === "REST" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-[#05050a]/95 backdrop-blur-md z-[70]"
          >
            <div className="max-w-5xl w-full p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Side: Shop & Quiz */}
              <div className="space-y-6">
                <div className="bg-black/60 border-2 border-[#00f2ff] p-6 shadow-[0_0_20px_rgba(0,242,255,0.2)]">
                   <h2 className="text-[#00f2ff] font-bold uppercase tracking-widest mb-4 border-b border-[#00f2ff]/20 pb-2 flex justify-between">
                     Ship Maintenance <span className="text-white">Credits: {currency}</span>
                   </h2>
                   <div className="grid gap-3">
                     {SHOP_ITEMS.map(item => {
                       const ownedDrone = item.id === "drone" && upgrades.drones >= 2;
                       const ownedLaser = item.id === "laser" && upgrades.laser;
                       const ownedHoming = item.id === "homing" && upgrades.homing;
                       const disabled = currency < item.price || ownedDrone || ownedLaser || ownedHoming;
                       return (
                        <button
                          key={item.id}
                          onMouseEnter={() => !disabled && soundRef.current?.click()}
                          onClick={() => buyItem(item)}
                          disabled={disabled}
                          className="flex justify-between items-center bg-white/5 border border-white/10 p-3 hover:bg-white/10 transition-colors disabled:opacity-30 text-left"
                        >
                          <div>
                            <div className="text-sm font-bold">{item.name} {(ownedDrone || ownedLaser || ownedHoming) && " (MAX)"}</div>
                            <div className="text-[10px] text-white/40">{item.desc}</div>
                          </div>
                          <div className={currency >= item.price ? "text-[#00f2ff] font-bold" : "text-[#ff0055] font-bold"}>{item.price}</div>
                        </button>
                       );
                     })}
                   </div>
                </div>

                {!quizResolved && currentQuiz && (
                  <div className="bg-white/5 border border-[#fbbf24] p-6">
                     <div className="text-[#fbbf24] text-[10px] font-bold uppercase tracking-[2px] mb-2">Bonus Credits Quiz</div>
                     <div className="text-sm mb-4">{currentQuiz.question}</div>
                     <div className="grid grid-cols-2 gap-2">
                       {currentQuiz.options.map((opt, i) => (
                         <button 
                           key={i} 
                           onClick={() => handleQuizAnswer(i)}
                           className="bg-black/40 border border-white/10 p-2 text-[11px] hover:border-[#fbbf24] transition-colors"
                         >
                           {opt}
                         </button>
                       ))}
                     </div>
                  </div>
                )}
              </div>

              {/* Right Side: Status & Continue */}
              <div className="flex flex-col justify-between p-6 bg-black/60 border border-white/10">
                <div className="space-y-6">
                    <div className="space-y-2">
                        <div className="text-[50px] font-bold text-white tracking-tighter uppercase leading-none">Safe Zone <span className="text-[#00f2ff]">Reached</span></div>
                        <div className="text-sm text-white/40 uppercase tracking-[4px]">Mission Phase {stage} Complete</div>
                    </div>
                    
                    <div className="py-6 border-y border-white/10">
                        <div className="text-[10px] text-white/40 uppercase mb-4">Ship stats</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-[10px] uppercase text-white/20">Drones</div>
                                <div className="text-xl font-bold">{upgrades.drones} / 2</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase text-white/20">Laser System</div>
                                <div className="text-xl font-bold">{upgrades.laser ? "ACTIVE" : "OFFLINE"}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase text-white/20">Guided Missile</div>
                                <div className="text-xl font-bold">{upgrades.homing ? "ACTIVE" : "OFFLINE"}</div>
                            </div>
                            <div className="mt-2 text-right w-full col-span-2">
                                <div className="text-[10px] uppercase text-white/20">Plasma Bombs</div>
                                <div className="text-xl font-bold text-[#ff0055]">{upgrades.bombs} REMAINING</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8">
                  <motion.button
                    whileHover={{ scale: 1.05, backgroundColor: "#00f2ff", color: "#000" }}
                    whileTap={{ scale: 0.95 }}
                    onMouseEnter={() => soundRef.current?.click()}
                    onClick={startNextStage}
                    className="w-full py-6 border-2 border-[#00f2ff] text-[#00f2ff] font-bold text-xl uppercase tracking-[10px] transition-all"
                  >
                    Departure
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {status === "GAMEOVER" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-[#05050a]/95 backdrop-blur-md z-[60]"
          >
            <div className="max-w-4xl w-full p-10 flex flex-col md:flex-row gap-8">
              <div className="flex-1 text-center space-y-8 border-2 border-[#ff0055] bg-[rgba(10,10,20,0.9)] shadow-[0_0_50px_rgba(255,0,85,0.3)] p-10">
                <div className="space-y-2">
                  <div className="text-[#ff0055] font-bold text-5xl uppercase tracking-tighter [text-shadow:0_0_20px_#ff0055]">
                    HULL BREACH
                  </div>
                  <div className="text-[#ff0055] text-xs uppercase tracking-[5px] animate-pulse">Critical Failure</div>
                </div>

                <div className="py-8 border-y border-[#ff0055]/30">
                  <div className="text-xs text-white/40 uppercase tracking-widest mb-2">Distance Recovered</div>
                  <div className="text-5xl font-bold text-white font-mono tracking-tighter mb-4">
                    {score.toLocaleString()} <span className="text-xl">KM</span>
                  </div>
                </div>

                {showNameInput ? (
                  <div className="space-y-4">
                    <input
                      type="text"
                      maxLength={20}
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="ENTER PILOT NAME"
                      className="w-full bg-black/50 border border-[#ff0055]/50 px-4 py-3 text-center text-white focus:outline-none focus:border-[#ff0055] placeholder:text-white/20 uppercase text-sm tracking-widest"
                    />
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onMouseEnter={() => !isSaving && soundRef.current?.click()}
                      onClick={saveScore}
                      disabled={!playerName.trim() || isSaving}
                      className="w-full py-4 bg-[#ff0055] text-white font-bold text-sm uppercase tracking-[4px] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSaving ? "TRANSMITTING..." : "SUBMIT LOG DATA"}
                    </motion.button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <motion.button
                      whileHover={{ scale: 1.05, backgroundColor: "#ff0055", color: "#fff" }}
                      whileTap={{ scale: 0.95 }}
                      onMouseEnter={() => soundRef.current?.click()}
                      onClick={startGame}
                      className="w-full py-5 border border-[#ff0055] text-[#ff0055] font-bold text-lg uppercase tracking-[3px] transition-all"
                    >
                      Restart Mission
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05, color: "#fff" }}
                      whileTap={{ scale: 0.95 }}
                      onMouseEnter={() => soundRef.current?.click()}
                      onClick={() => setStatus("MENU")}
                      className="w-full py-4 text-white/40 font-bold text-[10px] uppercase tracking-[3px] hover:text-white"
                    >
                      Return to Hangar
                    </motion.button>
                  </div>
                )}
              </div>

              <div className="w-full md:w-72 bg-black/60 border border-white/5 p-6 space-y-4">
                <div className="text-[10px] text-white/40 font-bold uppercase tracking-[4px] border-b border-white/10 pb-2">Global Standings</div>
                <div className="space-y-3">
                  {leaderboard.map((entry, i) => (
                    <div key={i} className="flex justify-between items-center text-[10px]">
                      <div className="flex gap-2 items-center">
                        <span className={i < 3 ? "text-[#00f2ff] font-bold" : "text-white/20"}>{i + 1}</span>
                        <span className="font-bold uppercase tracking-tighter truncate w-24 text-white/60">{entry.playerName}</span>
                      </div>
                      <span className="text-white/80 font-mono">{entry.score.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warning Border (Only visible during play) */}
      <motion.div 
        animate={{ 
          opacity: status === "PLAYING" ? [0, 0.2, 0] : 0 
        }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute inset-0 border-4 border-[#ff0055] pointer-events-none z-30"
      />

      {/* Decorative HUD Elements */}
      <div className="absolute bottom-10 left-10 text-[10px] text-white/20 uppercase tracking-[3px] vertical-rl rotate-180 z-20">
        Nebula Sector 7-G // Void Protocol Enabled
      </div>
      <div className="absolute bottom-10 right-10 text-[10px] text-white/20 uppercase tracking-[3px] text-right z-20">
        Core Sync: OK <br />
        Thrusters: MAX <br />
        Signal: NOMINAL
      </div>
    </div>
  );

}

