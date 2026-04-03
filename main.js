(function () {
  // Cache the DOM and canvas handles once so the game loop can reuse them cheaply.
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const buildPanelEl = document.getElementById("build-panel");
  const lifePanelEl = document.getElementById("life-panel");
  const economyPanelEl = document.getElementById("economy-panel");
  const wavePanelEl = document.getElementById("wave-panel");
  const towerInfoEl = document.getElementById("tower-info");
  const startBtn = document.getElementById("start-btn");

  // Core rules and balancing values live together at the top for quick tuning.
  const TILE_SIZE = 64;
  const GRID_COLS = 12;
  const GRID_ROWS = 9;
  const STARTING_GOLD = 65;
  const STARTING_LIVES = 3;
  const TOWER_MAX_LEVEL = 3;
  const TOWER_SELECT_RADIUS = 28;
  const FIXED_DT = 1 / 60;
  const ENEMY_RADIUS = 14;
  const DEFAULT_MESSAGE = "按開始後，把塔放在草地格上。";

  const TOWER_TYPES = {
    basic: {
      label: "特務魚",
      cost: 28,
      range: TILE_SIZE * 1.9,
      damage: 9,
      cooldown: 0.58,
      upgradeCosts: [36, 58],
      upgradeDamage: 3,
      upgradeRange: 12,
      upgradeCooldownStep: 0.04,
      markerColor: "rgba(201, 111, 59, 0.18)",
    },
    sniper: {
      label: "狙擊魚",
      cost: 55,
      range: TILE_SIZE * 3.0,
      damage: 24,
      cooldown: 1.3,
      upgradeCosts: [70, 95],
      upgradeDamage: 6,
      upgradeRange: 14,
      upgradeCooldownStep: 0.06,
      markerColor: "rgba(52, 115, 106, 0.18)",
    },
  };

  const ENEMY_TYPES = {
    scout: {
      label: "斥候怪",
      roleText: "高速突進",
      fallbackColor: "#8b5cf6",
      accentColor: "#f0abfc",
      trailColor: "rgba(192, 132, 252, 0.4)",
      healthColor: "#7dd3fc",
      healthBack: "rgba(15, 23, 42, 0.22)",
      priorityColor: "rgba(233, 213, 255, 0.95)",
      warningColor: "rgba(168, 85, 247, 0.22)",
    },
    brute: {
      label: "重裝怪",
      roleText: "高血前排",
      fallbackColor: "#8a3b2e",
      accentColor: "#ffd6a5",
      trailColor: "rgba(251, 146, 60, 0.28)",
      healthColor: "#fb923c",
      healthBack: "rgba(41, 37, 36, 0.3)",
      priorityColor: "rgba(254, 215, 170, 0.95)",
      warningColor: "rgba(249, 115, 22, 0.24)",
    },
  };

  // The map is grid-based: each cell tells us whether a tile is buildable terrain or blocked.
  const mapLayout = [
    ["grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "grass"],
    ["path", "path", "path", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "grass", "grass"],
    ["grass", "grass", "path", "grass", "grass", "grass", "grass", "rock", "grass", "rock", "grass", "grass"],
    ["grass", "grass", "path", "path", "path", "path", "grass", "grass", "grass", "rock", "grass", "grass"],
    ["grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "path", "path", "path"],
    ["grass", "grass", "rock", "grass", "grass", "path", "grass", "rock", "grass", "path", "grass", "grass"],
    ["grass", "grass", "rock", "grass", "grass", "path", "path", "path", "path", "path", "grass", "grass"],
    ["grass", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass"],
    ["grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass"],
  ];

  const pathCells = [
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 },
    { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 },
    { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 },
    { x: 9, y: 5 }, { x: 9, y: 4 }, { x: 10, y: 4 }, { x: 11, y: 4 },
  ];

  const pathPoints = pathCells.map((cell) => ({
    x: cell.x * TILE_SIZE + TILE_SIZE / 2,
    y: cell.y * TILE_SIZE + TILE_SIZE / 2,
  }));

  // Waves describe what to spawn and how quickly enemies appear.
  const waves = [
    { count: 5, type: "scout", spacing: 1.05, name: "斥候突襲", note: "高速敵人正在測試你的防線覆蓋。" },
    { count: 8, type: "scout", spacing: 0.82, name: "斥候急襲", note: "路線節奏加快了，先攔下快漏掉的敵人。" },
    { count: 4, type: "brute", spacing: 1.3, name: "重裝推進", note: "慢速高血敵人正在吃火力，記得持續輸出。" },
    {
      count: 10,
      type: "mix",
      spacing: 0.9,
      name: "斥候佯攻",
      note: "斥候會先拉走火力，重裝怪接著頂上前線。",
      sequence: ["scout", "scout", "scout", "brute", "scout", "scout", "brute", "brute", "scout", "brute"],
    },
    { count: 6, type: "brute", spacing: 1.05, name: "重裝防線", note: "這一波更考驗穩定輸出，不是爆發時機。" },
    {
      count: 12,
      type: "mix",
      spacing: 0.78,
      name: "分線壓力",
      note: "斥候會往前偷跑，重裝怪則穩穩卡住中段。",
      sequence: ["scout", "scout", "brute", "scout", "brute", "scout", "scout", "brute", "brute", "scout", "brute", "brute"],
    },
    {
      count: 14,
      type: "mix",
      spacing: 0.7,
      name: "交錯壓力",
      note: "現在同時考驗防線覆蓋與持續火力。",
      sequence: ["scout", "scout", "scout", "brute", "scout", "brute", "scout", "brute", "scout", "brute", "brute", "scout", "brute", "brute"],
    },
    {
      count: 16,
      type: "mix",
      spacing: 0.62,
      name: "最終猛攻",
      note: "快怪會替最後的重裝線掩護，撐住整條路線。",
      sequence: ["scout", "scout", "brute", "scout", "scout", "brute", "scout", "brute", "scout", "brute", "brute", "scout", "brute", "scout", "brute", "brute"],
    },
  ];

  const enemySpriteConfig = {
    scout: { src: "./assets/enemies/scout.png", maxWidth: 34, maxHeight: 42 },
    brute: { src: "./assets/enemies/brute.png", maxWidth: 46, maxHeight: 56 },
  };
  const towerSpriteConfig = {
    basic: {
      src: "./assets/towers/basic.png",
      maxWidth: 42,
      maxHeight: 48,
    },
    sniper: {
      src: "./assets/towers/sniper.png",
      maxWidth: 64,
      maxHeight: 60,
    },
  };

  const enemySprites = {
    scout: { image: null, loaded: false, failed: false },
    brute: { image: null, loaded: false, failed: false },
  };
  const towerSprites = {
    basic: { image: null, loaded: false, failed: false },
    sniper: { image: null, loaded: false, failed: false },
  };

  // Image loading is async, so each sprite tracks loaded/failed state for graceful fallbacks.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image: " + src));
      image.src = src;
    });
  }

  function loadEnemySprites() {
    Object.entries(enemySpriteConfig).forEach(([type, config]) => {
      loadImage(config.src)
        .then((image) => {
          enemySprites[type] = { image, loaded: true, failed: false };
          draw();
        })
        .catch(() => {
          enemySprites[type] = { image: null, loaded: false, failed: true };
        });
    });
  }

  function loadTowerSprites() {
    Object.entries(towerSpriteConfig).forEach(([type, config]) => {
      loadImage(config.src)
        .then((image) => {
          towerSprites[type] = { image, loaded: true, failed: false };
          draw();
        })
        .catch(() => {
          towerSprites[type] = { image: null, loaded: false, failed: true };
        });
    });
  }

  function makeEnemy(type) {
    if (type === "brute") {
      return {
        id: state.nextEnemyId++,
        type,
        x: pathPoints[0].x,
        y: pathPoints[0].y,
        hp: 88,
        maxHp: 88,
        speed: 40,
        reward: 10,
        pathIndex: 0,
        radius: ENEMY_RADIUS + 4,
        hitFlash: 0,
      };
    }

    return {
      id: state.nextEnemyId++,
      type: "scout",
      x: pathPoints[0].x,
      y: pathPoints[0].y,
      hp: 22,
      maxHp: 22,
      speed: 64,
      reward: 5,
      pathIndex: 0,
      radius: ENEMY_RADIUS,
      hitFlash: 0,
    };
  }

  function createTower(gridX, gridY, id, type) {
    const towerType = TOWER_TYPES[type];
    const centerX = gridX * TILE_SIZE + TILE_SIZE / 2;
    const centerY = gridY * TILE_SIZE + TILE_SIZE / 2;
    return {
      id,
      gridX,
      gridY,
      type,
      level: 1,
      totalSpent: towerType.cost,
      x: centerX,
      y: centerY,
      range: towerType.range,
      damage: towerType.damage,
      cooldown: towerType.cooldown,
      cooldownLeft: 0,
      angle: 0,
      targetEnemyId: null,
    };
  }

  function resetState() {
    // Keep all mutable game data in one place so restart logic stays simple.
    return {
      mode: "ready",
      gold: STARTING_GOLD,
      lives: STARTING_LIVES,
      waveIndex: 0,
      towers: [],
      selectedBuildType: "basic",
      selectedTowerId: null,
      nextTowerId: 1,
      nextEnemyId: 1,
      enemies: [],
      effects: [],
      hoveredCell: null,
      spawnTimer: 0,
      spawnedInWave: 0,
      queuedWaveDelay: 0.6,
      visualTime: 0,
      bannerText: "",
      bannerTimer: 0,
      message: DEFAULT_MESSAGE,
    };
  }

  let state = resetState();
  let lastTimestamp = 0;
  let rafId = 0;
  let lastBuildPanelMarkup = "";
  let lastLifeMarkup = "";
  let lastEconomyMarkup = "";
  let lastWaveMarkup = "";
  let lastTowerInfoMarkup = "";

  function isPathCell(x, y) {
    return mapLayout[y] && mapLayout[y][x] === "path";
  }

  function isRockCell(x, y) {
    return mapLayout[y] && mapLayout[y][x] === "rock";
  }

  function isTowerAt(x, y) {
    return state.towers.some((tower) => tower.gridX === x && tower.gridY === y);
  }

  function getTowerAttacksPerSecond(tower) {
    return 1 / tower.cooldown;
  }

  function getTowerType(type) {
    return TOWER_TYPES[type];
  }

  function getEnemyType(type) {
    return ENEMY_TYPES[type] || ENEMY_TYPES.scout;
  }

  function getWaveAnnouncement(index) {
    const wave = waves[index];
    if (!wave) {
      return "";
    }
    return "第 " + (index + 1) + " 波：" + wave.note;
  }

  function getWaveBannerText(index) {
    const wave = waves[index];
    if (!wave) {
      return "";
    }
    return "第 " + (index + 1) + " 波 - " + wave.name;
  }

  function showBattleBanner(text, duration) {
    state.bannerText = text;
    state.bannerTimer = duration ?? 1.5;
  }

  function announceWave(index) {
    const message = getWaveAnnouncement(index);
    if (!message) {
      return;
    }
    state.message = message;
    showBattleBanner(getWaveBannerText(index), 1.6);
  }

  function getSelectedBuildType() {
    return getTowerType(state.selectedBuildType);
  }

  function getTowerUpgradeCost(tower) {
    const towerType = getTowerType(tower.type);
    if (!towerType || tower.level >= TOWER_MAX_LEVEL) {
      return null;
    }
    return towerType.upgradeCosts[tower.level - 1] ?? null;
  }

  function getTowerSellValue(tower) {
    return Math.round(tower.totalSpent * 0.7);
  }

  function canUpgradeTower(tower) {
    const upgradeCost = getTowerUpgradeCost(tower);
    return upgradeCost !== null && state.gold >= upgradeCost;
  }

  function canAffordTowerType(type) {
    const towerType = getTowerType(type);
    return !!towerType && state.gold >= towerType.cost;
  }

  function getSelectedTower() {
    return state.towers.find((tower) => tower.id === state.selectedTowerId) || null;
  }

  function setSelectedBuildType(type) {
    if (!getTowerType(type)) {
      return;
    }
    state.selectedBuildType = type;
    state.message = getTowerType(type).label + " 已準備放置。";
  }

  function selectTowerById(towerId) {
    state.selectedTowerId = towerId;
  }

  function clearTowerSelection() {
    state.selectedTowerId = null;
  }

  function upgradeSelectedTower() {
    const tower = getSelectedTower();
    if (!tower) {
      state.message = "請先選一座塔。";
      return;
    }

    const upgradeCost = getTowerUpgradeCost(tower);
    if (upgradeCost === null) {
      state.message = "這座塔已滿級。";
      return;
    }

    if (state.gold < upgradeCost) {
      state.message = "金錢不夠，無法升級。";
      return;
    }

    state.gold -= upgradeCost;
    tower.totalSpent += upgradeCost;
    tower.level += 1;
    const towerType = getTowerType(tower.type);
    tower.damage += towerType.upgradeDamage;
    tower.range += towerType.upgradeRange;
    tower.cooldown = Math.max(0.28, tower.cooldown - towerType.upgradeCooldownStep);
    tower.cooldownLeft = Math.min(tower.cooldownLeft, tower.cooldown);
    state.message = "塔已升到 " + tower.level + " 級。";
  }

  function sellSelectedTower() {
    const tower = getSelectedTower();
    if (!tower) {
      state.message = "請先選一座塔。";
      return;
    }

    const sellValue = getTowerSellValue(tower);
    state.gold += sellValue;
    state.towers = state.towers.filter((candidate) => candidate.id !== tower.id);
    clearTowerSelection();
    state.message = "已賣出塔，獲得 " + sellValue + " 金。";
  }

  function canBuildAt(x, y) {
    if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) {
      return false;
    }
    return !isPathCell(x, y) && !isRockCell(x, y) && !isTowerAt(x, y);
  }

  function getBuildPreview(gridX, gridY) {
    const selectedType = state.selectedBuildType;
    const towerType = getTowerType(selectedType);
    const preview = {
      status: "hidden",
      reason: null,
      gridX,
      gridY,
      selectedType,
      shortage: 0,
      towerType,
    };

    if (gridX === null || gridY === null || gridX === undefined || gridY === undefined) {
      return preview;
    }

    preview.status = "blocked";

    if (gridX < 0 || gridY < 0 || gridX >= GRID_COLS || gridY >= GRID_ROWS) {
      preview.reason = "out_of_bounds";
      return preview;
    }

    if (state.mode !== "playing") {
      preview.reason = "not_playing";
      return preview;
    }

    if (!towerType) {
      preview.status = "hidden";
      return preview;
    }

    if (isPathCell(gridX, gridY)) {
      preview.reason = "path";
      return preview;
    }

    if (isRockCell(gridX, gridY)) {
      preview.reason = "rock";
      return preview;
    }

    if (isTowerAt(gridX, gridY)) {
      preview.reason = "occupied";
      return preview;
    }

    if (state.gold < towerType.cost) {
      preview.status = "unaffordable";
      preview.reason = "insufficient_gold";
      preview.shortage = towerType.cost - state.gold;
      return preview;
    }

    preview.status = "valid";
    return preview;
  }

  function getHoveredBuildPreview() {
    if (!state.hoveredCell) {
      return {
        status: "hidden",
        reason: null,
        gridX: null,
        gridY: null,
        selectedType: state.selectedBuildType,
        shortage: 0,
        towerType: getSelectedBuildType(),
      };
    }

    return getBuildPreview(state.hoveredCell.x, state.hoveredCell.y);
  }

  function getBuildClickMessage(preview) {
    if (preview.reason === "not_playing") {
      return "請先開始遊戲，再部署塔。";
    }

    if (preview.reason === "insufficient_gold") {
      return "金錢不足，還差 " + preview.shortage + "g。";
    }

    if (preview.reason === "path") {
      return "路徑上不能蓋塔。";
    }

    if (preview.reason === "rock") {
      return "岩石地形不能蓋塔。";
    }

    if (preview.reason === "occupied") {
      return "這格已經有塔了。";
    }

    if (preview.reason === "out_of_bounds") {
      return "請在地圖範圍內選擇位置。";
    }

    return "這裡不能建造。";
  }

  function startGame() {
    state = resetState();
    state.mode = "playing";
    announceWave(0);
    syncHud();
    draw();
  }

  function spawnEnemyForWave(index) {
    const wave = waves[index];
    if (!wave) {
      return null;
    }

    if (Array.isArray(wave.sequence) && wave.sequence[state.spawnedInWave]) {
      return makeEnemy(wave.sequence[state.spawnedInWave]);
    }

    if (wave.type === "mix") {
      return makeEnemy(state.spawnedInWave % 2 === 0 ? "scout" : "brute");
    }

    return makeEnemy(wave.type);
  }

  function updateWave(dt) {
    // Spawn timing and wave progression are separated from enemy movement for clarity.
    if (state.mode !== "playing") {
      return;
    }

    const wave = waves[state.waveIndex];
    if (!wave) {
      if (state.enemies.length === 0) {
        state.mode = "won";
        state.message = "你撐過所有波次了，按開始再玩一次。";
      }
      return;
    }

    if (state.spawnedInWave < wave.count) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        state.enemies.push(spawnEnemyForWave(state.waveIndex));
        state.spawnedInWave += 1;
        state.spawnTimer = wave.spacing;
      }
      return;
    }

    if (state.enemies.length === 0) {
      state.queuedWaveDelay -= dt;
      if (state.queuedWaveDelay <= 0) {
        state.waveIndex += 1;
        state.spawnedInWave = 0;
        state.spawnTimer = 0;
        state.queuedWaveDelay = 0.8;
        if (waves[state.waveIndex]) {
          announceWave(state.waveIndex);
        }
      }
    }
  }

  function getEnemyRemainingCells(enemy) {
    return Math.max(0, pathPoints.length - 1 - enemy.pathIndex);
  }

  function getEnemyDirection(enemy) {
    const nextPoint = pathPoints[enemy.pathIndex + 1];
    const fallbackPoint = pathPoints[Math.max(0, enemy.pathIndex)];
    const dx = nextPoint ? nextPoint.x - enemy.x : enemy.x - fallbackPoint.x;
    const dy = nextPoint ? nextPoint.y - enemy.y : enemy.y - fallbackPoint.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: dx / length,
      y: dy / length,
    };
  }

  function getEnemyProgressScore(enemy) {
    const nextPoint = pathPoints[enemy.pathIndex + 1];
    if (!nextPoint) {
      return pathPoints.length;
    }

    const distance = Math.hypot(nextPoint.x - enemy.x, nextPoint.y - enemy.y);
    const segmentProgress = 1 - Math.min(1, distance / TILE_SIZE);
    return enemy.pathIndex + segmentProgress;
  }

  function getEnemyThreatScore(enemy) {
    if (enemy.hp <= 0) {
      return -1;
    }
    const remainingCells = getEnemyRemainingCells(enemy);
    let score = getEnemyProgressScore(enemy) * 100;
    if (enemy.type === "scout") {
      score += 12;
    }
    if (enemy.type === "brute") {
      score += (enemy.hp / enemy.maxHp) * 10;
    }
    if (remainingCells <= 4) {
      score += enemy.type === "scout" ? 34 : 22;
    }
    return score;
  }

  function getPriorityEnemy() {
    let bestEnemy = null;
    let bestScore = -1;
    for (const enemy of state.enemies) {
      const score = getEnemyThreatScore(enemy);
      if (score > bestScore) {
        bestScore = score;
        bestEnemy = enemy;
      }
    }
    return bestEnemy;
  }

  function getTargetedEnemyCounts() {
    const counts = {};
    for (const tower of state.towers) {
      if (tower.targetEnemyId === null) {
        continue;
      }
      counts[tower.targetEnemyId] = (counts[tower.targetEnemyId] || 0) + 1;
    }
    return counts;
  }

  function updateEnemies(dt) {
    const survivors = [];

    for (const enemy of state.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 3.5);
      const nextPoint = pathPoints[enemy.pathIndex + 1];
      if (!nextPoint) {
        state.lives -= 1;
        state.message = getEnemyType(enemy.type).label + " 突破防線了。";
        if (state.lives <= 0) {
          state.mode = "lost";
          state.message = "防線被突破了，按開始重新挑戰。";
        }
        continue;
      }

      const dx = nextPoint.x - enemy.x;
      const dy = nextPoint.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      const step = enemy.speed * dt;

      if (distance <= step) {
        enemy.x = nextPoint.x;
        enemy.y = nextPoint.y;
        enemy.pathIndex += 1;
      } else {
        enemy.x += (dx / distance) * step;
        enemy.y += (dy / distance) * step;
      }

      if (enemy.hp > 0) {
        survivors.push(enemy);
      }
    }

    state.enemies = survivors;
  }

  function updateTowers(dt) {
    // Towers prefer the enemy farthest along the path among targets in range.
    const reservedDamageByEnemyId = {};

    for (const tower of state.towers) {
      tower.cooldownLeft = Math.max(0, tower.cooldownLeft - dt);
      tower.targetEnemyId = null;
      let target = null;
      let bestProgress = -1;
      let fallbackTarget = null;
      let fallbackProgress = -1;

      for (const enemy of state.enemies) {
        if (enemy.hp <= 0) {
          continue;
        }
        const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
        if (distance <= tower.range) {
          const progressScore = enemy.pathIndex * 1000 - distance;
          const reservedDamage = reservedDamageByEnemyId[enemy.id] || 0;
          const effectiveHp = enemy.hp - reservedDamage;

          if (progressScore > fallbackProgress) {
            fallbackProgress = progressScore;
            fallbackTarget = enemy;
          }

          if (effectiveHp > 0 && progressScore > bestProgress) {
            bestProgress = progressScore;
            target = enemy;
          }
        }
      }

      if (!target) {
        target = fallbackTarget;
      }

      if (!target) {
        continue;
      }

      tower.targetEnemyId = target.id;
      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
      if (tower.cooldownLeft > 0) {
        continue;
      }

      target.hp -= tower.damage;
      reservedDamageByEnemyId[target.id] = (reservedDamageByEnemyId[target.id] || 0) + tower.damage;
      target.hitFlash = Math.min(1, target.hitFlash + (tower.type === "sniper" ? 0.85 : 0.55));
      tower.cooldownLeft = tower.cooldown;
      state.effects.push({
        x1: tower.x,
        y1: tower.y,
        x2: target.x,
        y2: target.y,
        life: tower.type === "sniper" ? 0.12 : 0.08,
        duration: tower.type === "sniper" ? 0.12 : 0.08,
        color: tower.type === "sniper" ? "#b8f2e6" : "#ffe8a3",
        width: tower.type === "sniper" ? 4 : 3,
        impactColor: tower.type === "sniper" ? "rgba(184, 242, 230, 0.9)" : "rgba(255, 232, 163, 0.9)",
        impactRadius: tower.type === "sniper" ? 12 : 8,
      });

      if (target.hp <= 0) {
        state.gold += target.reward;
      }
    }

    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  }

  function updateEffects(dt) {
    state.effects = state.effects
      .map((effect) => ({
        ...effect,
        life: effect.life - dt,
      }))
      .filter((effect) => effect.life > 0);
  }

  function update(dt) {
    // The simulation step updates game systems first, then the HUD reflects the new state.
    if (state.mode === "playing") {
      state.visualTime += dt;
      state.bannerTimer = Math.max(0, state.bannerTimer - dt);
      updateWave(dt);
      updateEnemies(dt);
      updateTowers(dt);
      updateEffects(dt);
    }

    syncHud();
  }

  function getPointerInfo(event) {
    // Mouse coordinates must be converted from CSS pixels into canvas grid coordinates.
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    return {
      canvasX,
      canvasY,
      gridX: Math.floor(canvasX / TILE_SIZE),
      gridY: Math.floor(canvasY / TILE_SIZE),
    };
  }

  function placeTower(gridX, gridY) {
    const preview = getBuildPreview(gridX, gridY);
    const previewTowerType = preview.towerType;
    if (preview.status !== "valid") {
      state.message = getBuildClickMessage(preview);
      return;
    }

    state.gold -= previewTowerType.cost;
    const tower = createTower(gridX, gridY, state.nextTowerId, state.selectedBuildType);
    state.nextTowerId += 1;
    state.towers.push(tower);
    selectTowerById(tower.id);
    state.message = previewTowerType.label + " 已部署。";
  }

  function getTowerAtPosition(x, y) {
    // Check towers from top-most to oldest so the most recently placed tower wins overlapping clicks.
    for (let index = state.towers.length - 1; index >= 0; index -= 1) {
      const tower = state.towers[index];
      const distance = Math.hypot(x - tower.x, y - tower.y);
      if (distance <= TOWER_SELECT_RADIUS) {
        return tower;
      }
    }
    return null;
  }

  function drawTile(x, y, type) {
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;

    if (type === "path") {
      ctx.fillStyle = "#d6b27a";
    } else if (type === "rock") {
      ctx.fillStyle = "#8a8f7b";
    } else {
      ctx.fillStyle = "#b8d78a";
    }

    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = "rgba(29, 42, 50, 0.12)";
    ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
  }

  function drawMap() {
    const preview = getHoveredBuildPreview();

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        drawTile(col, row, mapLayout[row][col]);
      }
    }

    if (preview.status !== "hidden" && preview.gridX >= 0 && preview.gridY >= 0 && preview.gridX < GRID_COLS && preview.gridY < GRID_ROWS) {
      if (preview.status === "valid") {
        ctx.fillStyle = "rgba(52, 115, 106, 0.24)";
      } else if (preview.status === "unaffordable") {
        ctx.fillStyle = "rgba(201, 111, 59, 0.24)";
      } else {
        ctx.fillStyle = "rgba(156, 74, 59, 0.24)";
      }
      ctx.fillRect(preview.gridX * TILE_SIZE, preview.gridY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  function drawPathMarkers() {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length; i += 1) {
      ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSelectedTowerRange() {
    const selectedTower = getSelectedTower();
    const preview = getHoveredBuildPreview();
    if (!selectedTower) {
      return;
    }

    if (preview.status !== "hidden" && preview.gridX >= 0 && preview.gridY >= 0 && preview.gridX < GRID_COLS && preview.gridY < GRID_ROWS) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(45, 95, 87, 0.68)";
    ctx.fillStyle = "rgba(45, 95, 87, 0.10)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(selectedTower.x, selectedTower.y, selectedTower.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawTowerVisual(tower, options) {
    const config = towerSpriteConfig[tower.type];
    const sprite = towerSprites[tower.type];
    const alpha = options && options.alpha !== undefined ? options.alpha : 1;
    const baseColor = options && options.baseColor ? options.baseColor : (tower.type === "sniper" ? "#6d4c41" : "#2d5f57");
    const muzzleColor = options && options.muzzleColor ? options.muzzleColor : "#ffe8b0";
    const shadowColor = options && options.shadowColor ? options.shadowColor : null;

    if (shadowColor) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = shadowColor;
      ctx.beginPath();
      ctx.ellipse(tower.x, tower.y + 18, 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (config && sprite && sprite.loaded && sprite.image) {
      const scale = Math.min(
        config.maxWidth / sprite.image.width,
        config.maxHeight / sprite.image.height
      );
      const drawWidth = sprite.image.width * scale;
      const drawHeight = sprite.image.height * scale;
      const targetAngle = tower.angle;
      const facingRight = Math.cos(targetAngle) >= 0;
      const renderAngle = facingRight
        ? targetAngle
        : (targetAngle > Math.PI / 2 ? targetAngle - Math.PI : targetAngle + Math.PI);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(tower.x, tower.y);
      ctx.rotate(renderAngle);
      if (facingRight) {
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        sprite.image,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      );
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(tower.x, tower.y);
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(tower.angle);
    ctx.fillStyle = muzzleColor;
    ctx.fillRect(0, -4, 28, 8);
    ctx.restore();
  }

  function drawBuildPreview() {
    const preview = getHoveredBuildPreview();
    if (preview.status !== "valid" && preview.status !== "unaffordable") {
      return;
    }

    const towerType = preview.towerType;
    if (!towerType) {
      return;
    }

    const tower = createTower(preview.gridX, preview.gridY, -1, preview.selectedType);
    const isValid = preview.status === "valid";
    const rangeStroke = isValid ? "rgba(45, 95, 87, 0.72)" : "rgba(201, 111, 59, 0.78)";
    const rangeFill = isValid ? "rgba(45, 95, 87, 0.10)" : "rgba(201, 111, 59, 0.12)";
    const shadowColor = isValid ? "rgba(52, 115, 106, 0.22)" : "rgba(201, 111, 59, 0.28)";

    ctx.save();
    ctx.strokeStyle = rangeStroke;
    ctx.fillStyle = rangeFill;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, towerType.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawTowerVisual(tower, {
      alpha: isValid ? 0.58 : 0.52,
      baseColor: isValid ? "#2d5f57" : "#9a5b3d",
      muzzleColor: isValid ? "#ffe8b0" : "#ffe0b6",
      shadowColor,
    });
  }

  function drawTowers() {
    // If art loads successfully we draw the sprite, otherwise we fall back to simple shapes.
    for (const tower of state.towers) {
      const towerType = getTowerType(tower.type);
      const isSelected = tower.id === state.selectedTowerId;
      ctx.save();
      ctx.fillStyle = towerType ? towerType.markerColor : "rgba(29, 42, 50, 0.15)";
      ctx.beginPath();
      ctx.ellipse(tower.x, tower.y + 18, 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 250, 240, 0.95)";
        ctx.fillStyle = towerType ? towerType.markerColor : "rgba(201, 111, 59, 0.18)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      drawTowerVisual(tower);
    }
  }

  function drawEnemyFallback(enemy) {
    ctx.fillStyle = getEnemyType(enemy.type).fallbackColor;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemySprite(enemy) {
    const config = enemySpriteConfig[enemy.type];
    const sprite = enemySprites[enemy.type];

    if (!config || !sprite || !sprite.loaded || !sprite.image) {
      drawEnemyFallback(enemy);
      return;
    }

    const scale = Math.min(
      config.maxWidth / sprite.image.width,
      config.maxHeight / sprite.image.height
    );
    const drawWidth = sprite.image.width * scale;
    const drawHeight = sprite.image.height * scale;

    ctx.drawImage(
      sprite.image,
      enemy.x - drawWidth / 2,
      enemy.y - drawHeight / 2,
      drawWidth,
      drawHeight
    );
  }

  function drawTargetReticle(enemy, color, radius, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(enemy.x - radius, enemy.y - radius);
    ctx.lineTo(enemy.x - radius / 2, enemy.y - radius);
    ctx.moveTo(enemy.x - radius, enemy.y - radius);
    ctx.lineTo(enemy.x - radius, enemy.y - radius / 2);
    ctx.moveTo(enemy.x + radius, enemy.y - radius);
    ctx.lineTo(enemy.x + radius / 2, enemy.y - radius);
    ctx.moveTo(enemy.x + radius, enemy.y - radius);
    ctx.lineTo(enemy.x + radius, enemy.y - radius / 2);
    ctx.moveTo(enemy.x - radius, enemy.y + radius);
    ctx.lineTo(enemy.x - radius / 2, enemy.y + radius);
    ctx.moveTo(enemy.x - radius, enemy.y + radius);
    ctx.lineTo(enemy.x - radius, enemy.y + radius / 2);
    ctx.moveTo(enemy.x + radius, enemy.y + radius);
    ctx.lineTo(enemy.x + radius / 2, enemy.y + radius);
    ctx.moveTo(enemy.x + radius, enemy.y + radius);
    ctx.lineTo(enemy.x + radius, enemy.y + radius / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemyUnderlay(enemy, targetCount, isPriority) {
    const enemyType = getEnemyType(enemy.type);
    const remainingCells = getEnemyRemainingCells(enemy);
    const pulse = 0.72 + Math.sin(state.visualTime * 7 + enemy.id) * 0.18;

    ctx.save();
    if (enemy.type === "scout") {
      const direction = getEnemyDirection(enemy);
      const perpendicularX = -direction.y;
      const perpendicularY = direction.x;
      ctx.strokeStyle = enemyType.trailColor;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (let index = 0; index < 2; index += 1) {
        const offset = index === 0 ? -6 : 6;
        const startX = enemy.x - direction.x * 8 + perpendicularX * offset;
        const startY = enemy.y - direction.y * 8 + perpendicularY * offset;
        const endX = enemy.x - direction.x * 24 + perpendicularX * offset;
        const endY = enemy.y - direction.y * 24 + perpendicularY * offset;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "rgba(54, 34, 24, 0.18)";
      ctx.beginPath();
      ctx.ellipse(enemy.x, enemy.y + enemy.radius + 4, enemy.radius + 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isPriority || remainingCells <= 3) {
      ctx.fillStyle = enemyType.warningColor;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius + 12 + pulse * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (targetCount > 0 || isPriority) {
      drawTargetReticle(
        enemy,
        isPriority ? enemyType.priorityColor : "rgba(255, 250, 240, 0.9)",
        enemy.radius + 10 + (targetCount > 1 ? 3 : 0),
        isPriority ? 3 : 2
      );
    }
  }

  function drawEnemyOverlay(enemy, targetCount, isPriority) {
    const enemyType = getEnemyType(enemy.type);
    const remainingCells = getEnemyRemainingCells(enemy);
    const barWidth = enemy.type === "brute" ? 40 : 30;
    const barHeight = enemy.type === "brute" ? 7 : 5;
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    const flashAlpha = enemy.hitFlash * 0.45;

    ctx.save();
    if (enemy.hitFlash > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, " + flashAlpha.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius + 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = enemyType.healthBack;
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 14, barWidth, barHeight);
    ctx.fillStyle = enemyType.healthColor;
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 14, barWidth * ratio, barHeight);

    if (enemy.type === "brute") {
      ctx.strokeStyle = "rgba(84, 40, 31, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 14, barWidth, barHeight);
    }

    if (enemy.type === "scout") {
      const badgeY = enemy.y - enemy.radius - 24;
      ctx.strokeStyle = "rgba(240, 171, 252, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(enemy.x - 8, badgeY);
      ctx.lineTo(enemy.x - 2, badgeY - 4);
      ctx.lineTo(enemy.x - 2, badgeY + 4);
      ctx.moveTo(enemy.x + 2, badgeY);
      ctx.lineTo(enemy.x + 8, badgeY - 4);
      ctx.lineTo(enemy.x + 8, badgeY + 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(255, 214, 165, 0.95)";
      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y - enemy.radius - 20);
      ctx.lineTo(enemy.x - 7, enemy.y - enemy.radius - 8);
      ctx.lineTo(enemy.x + 7, enemy.y - enemy.radius - 8);
      ctx.closePath();
      ctx.fill();
    }

    if (isPriority) {
      ctx.fillStyle = enemyType.priorityColor;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y - enemy.radius - 30, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2b1d12";
      ctx.font = "700 12px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText("!", enemy.x, enemy.y - enemy.radius - 26);
    }

    if (remainingCells <= 3) {
      ctx.strokeStyle = "rgba(255, 248, 220, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius + 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (targetCount > 1) {
      ctx.fillStyle = "rgba(255, 250, 240, 0.92)";
      ctx.font = "700 11px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.fillText(String(targetCount), enemy.x, enemy.y + enemy.radius + 18);
    }
    ctx.restore();
  }

  function drawEnemies() {
    const priorityEnemy = getPriorityEnemy();
    const targetedCounts = getTargetedEnemyCounts();
    for (const enemy of state.enemies) {
      const targetCount = targetedCounts[enemy.id] || 0;
      drawEnemyUnderlay(enemy, targetCount, !!priorityEnemy && priorityEnemy.id === enemy.id);
      drawEnemySprite(enemy);
      drawEnemyOverlay(enemy, targetCount, !!priorityEnemy && priorityEnemy.id === enemy.id);
    }
  }

  function drawEffects() {
    ctx.save();
    for (const effect of state.effects) {
      const maxLife = effect.duration || 0.08;
      ctx.globalAlpha = Math.max(0.15, effect.life / maxLife);
      ctx.lineWidth = effect.width || 3;
      ctx.strokeStyle = effect.color || "#fef3c7";
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();

      if (effect.impactRadius) {
        ctx.fillStyle = effect.impactColor || "rgba(255, 243, 199, 0.9)";
        ctx.beginPath();
        ctx.arc(effect.x2, effect.y2, effect.impactRadius * (0.55 + effect.life * 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function traceRoundedRect(x, y, width, height, radius) {
    const clampedRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + clampedRadius, y);
    ctx.lineTo(x + width - clampedRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
    ctx.lineTo(x + width, y + height - clampedRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
    ctx.lineTo(x + clampedRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
    ctx.lineTo(x, y + clampedRadius);
    ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
    ctx.closePath();
  }

  function drawBattleBanner() {
    if (state.mode !== "playing" || state.bannerTimer <= 0 || !state.bannerText) {
      return;
    }

    const alpha = Math.min(1, state.bannerTimer / 0.45);
    const width = Math.min(canvas.width - 80, 360);
    const height = 40;
    const x = (canvas.width - width) / 2;
    const y = 18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(29, 42, 50, 0.76)";
    ctx.strokeStyle = "rgba(255, 250, 240, 0.35)";
    ctx.lineWidth = 2;
    traceRoundedRect(x, y, width, height, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff9ef";
    ctx.font = "700 18px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(state.bannerText, canvas.width / 2, y + 25);
    ctx.restore();
  }

  function drawPriorityWarning() {
    if (state.mode !== "playing") {
      return;
    }

    const priorityEnemy = getPriorityEnemy();
    if (!priorityEnemy || getEnemyRemainingCells(priorityEnemy) > 3) {
      return;
    }

    const enemyType = getEnemyType(priorityEnemy.type);
    const text = priorityEnemy.type === "scout"
      ? "優先處理：攔下斥候怪。"
      : "優先處理：集中火力打重裝怪。";
    const width = 280;
    const height = 34;
    const x = canvas.width - width - 18;
    const y = 18;
    ctx.save();
    ctx.fillStyle = "rgba(29, 42, 50, 0.82)";
    traceRoundedRect(x, y, width, height, 16);
    ctx.fill();
    ctx.fillStyle = enemyType.accentColor;
    ctx.fillRect(x + 10, y + 9, 8, 16);
    ctx.fillStyle = "#fff9ef";
    ctx.font = "700 15px Trebuchet MS";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 30, y + 22);
    ctx.restore();
  }

  function drawOverlay() {
    if (state.mode === "playing") {
      return;
    }

    ctx.fillStyle = "rgba(29, 42, 50, 0.28)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#fff9ef";
    ctx.textAlign = "center";
    ctx.font = "700 34px Trebuchet MS";

    let title = "魚貓塔防";
    if (state.mode === "won") {
      title = "勝利";
    } else if (state.mode === "lost") {
      title = "失敗";
    }

    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 18);
    ctx.font = "20px Trebuchet MS";
    ctx.fillText(state.message, canvas.width / 2, canvas.height / 2 + 20);
  }

  function draw() {
    // Draw from back to front so the map stays behind units and overlays stay on top.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    drawPathMarkers();
    drawSelectedTowerRange();
    drawBuildPreview();
    drawTowers();
    drawEnemies();
    drawEffects();
    drawBattleBanner();
    drawPriorityWarning();
    drawOverlay();
  }

  function syncHud() {
    const currentWave = Math.min(state.waveIndex + (state.mode === "won" ? 0 : 1), waves.length);
    const waveConfig = waves[Math.min(state.waveIndex, waves.length - 1)] || null;
    const selectedTower = getSelectedTower();
    const buildPanelMarkup = [
      "<h2>建造塔防</h2>",
      "<div class=\"build-options\">",
      Object.entries(TOWER_TYPES).map(([type, towerType]) =>
        "<button type=\"button\" class=\"build-option"
        + (state.selectedBuildType === type ? " is-selected" : "")
        + (state.gold < towerType.cost ? " is-unaffordable" : "")
        + "\" data-build-type=\"" + type + "\">"
        + "<strong>" + towerType.label + " - " + towerType.cost + "g</strong>"
        + "<small>傷害 " + towerType.damage + " | 射程 " + towerType.range.toFixed(0) + " | 攻速 " + (1 / towerType.cooldown).toFixed(2) + "/秒</small>"
        + "</button>"
      ).join("")
      + "</div>",
    ].join("");
    if (buildPanelMarkup !== lastBuildPanelMarkup) {
      buildPanelEl.innerHTML = buildPanelMarkup;
      lastBuildPanelMarkup = buildPanelMarkup;
    }

    const lifeMarkup = [
      "<div class=\"life-chip\">",
      "<strong>生命</strong>",
      "<span>" + state.lives + "</span>",
      "</div>",
    ].join("");
    if (lifeMarkup !== lastLifeMarkup) {
      lifePanelEl.innerHTML = lifeMarkup;
      lastLifeMarkup = lifeMarkup;
    }

    const economyMarkup = [
      "<h2>金錢狀態</h2>",
      "<div class=\"economy-chip\">",
      "<strong>金錢</strong>",
      "<span>" + state.gold + "g</span>",
      "</div>",
    ].join("");
    if (economyMarkup !== lastEconomyMarkup) {
      economyPanelEl.innerHTML = economyMarkup;
      lastEconomyMarkup = economyMarkup;
    }

    const waveMarkup = [
      "<div class=\"wave-chip\">",
      "<div class=\"wave-header\">",
      "<strong>第 " + currentWave + " / " + waves.length + " 波</strong>",
      "<span>" + (waveConfig ? waveConfig.name : "所有波次已完成") + "</span>",
      "</div>",
      "<p class=\"wave-status\">" + state.message + "</p>",
      "</div>",
    ].join("");
    if (waveMarkup !== lastWaveMarkup) {
      wavePanelEl.innerHTML = waveMarkup;
      lastWaveMarkup = waveMarkup;
    }

    let towerInfoMarkup = "";
    if (!selectedTower) {
      towerInfoEl.classList.add("is-hidden");
    } else {
      towerInfoEl.classList.remove("is-hidden");
      const upgradeCost = getTowerUpgradeCost(selectedTower);
      const sellValue = getTowerSellValue(selectedTower);
      const upgradeLabel = upgradeCost === null ? "已滿級" : upgradeCost + "g";
      const sellLabel = sellValue + "g";
      towerInfoMarkup = [
        "<h2>已選塔：" + getTowerType(selectedTower.type).label + " Lv." + selectedTower.level + "</h2>",
        "<p><strong>傷害</strong>：" + selectedTower.damage + "</p>",
        "<p><strong>射速</strong>：" + getTowerAttacksPerSecond(selectedTower).toFixed(2) + "/秒</p>",
        "<div class=\"tower-actions\">",
        "<button type=\"button\" class=\"tower-action\" data-action=\"upgrade\" " + (canUpgradeTower(selectedTower) ? "" : "disabled") + ">"
          + "<span class=\"tower-action-label\">升級</span>"
          + "<span class=\"tower-action-value\">" + upgradeLabel + "</span>"
          + "</button>",
        "<button type=\"button\" class=\"tower-action secondary\" data-action=\"sell\">"
          + "<span class=\"tower-action-label\">賣出</span>"
          + "<span class=\"tower-action-value\">" + sellLabel + "</span>"
          + "</button>",
        "</div>",
      ].join("");
    }
    if (towerInfoMarkup !== lastTowerInfoMarkup) {
      towerInfoEl.innerHTML = towerInfoMarkup;
      lastTowerInfoMarkup = towerInfoMarkup;
    }
  }

  function spriteStatusText() {
    return Object.keys(enemySprites)
      .map((type) => {
        if (enemySprites[type].loaded) {
          return type + ":loaded";
        }
        if (enemySprites[type].failed) {
          return type + ":fallback";
        }
        return type + ":loading";
      })
      .join(" | ");
  }

  function animationLoop(timestamp) {
    // requestAnimationFrame drives the game by repeating update -> draw every frame.
    if (!lastTimestamp) {
      lastTimestamp = timestamp;
    }

    const dt = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    update(dt);
    draw();
    rafId = window.requestAnimationFrame(animationLoop);
  }

  canvas.addEventListener("mousemove", (event) => {
    const pointer = getPointerInfo(event);
    state.hoveredCell = { x: pointer.gridX, y: pointer.gridY };
  });

  canvas.addEventListener("mouseleave", () => {
    state.hoveredCell = null;
  });

  canvas.addEventListener("click", (event) => {
    const pointer = getPointerInfo(event);
    const clickedTower = getTowerAtPosition(pointer.canvasX, pointer.canvasY);
    const buildPreview = getBuildPreview(pointer.gridX, pointer.gridY);

    // Selection takes priority over placement so clicking an existing tower never spends gold by mistake.
    if (clickedTower) {
      if (clickedTower.id === state.selectedTowerId) {
        clearTowerSelection();
        state.message = "已取消選擇塔。";
        syncHud();
        draw();
        return;
      }

      selectTowerById(clickedTower.id);
      state.message = "已選擇塔。";
      syncHud();
      draw();
      return;
    }

    if (buildPreview.status === "valid") {
      placeTower(pointer.gridX, pointer.gridY);
      syncHud();
      draw();
      return;
    }

    state.message = getBuildClickMessage(buildPreview);
    syncHud();
    draw();
  });

  towerInfoEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionButton = target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.getAttribute("data-action");
    if (action === "upgrade") {
      upgradeSelectedTower();
    } else if (action === "sell") {
      sellSelectedTower();
    }

    syncHud();
    draw();
  });

  buildPanelEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const buildButton = target.closest("[data-build-type]");
    if (!buildButton) {
      return;
    }

    const buildType = buildButton.getAttribute("data-build-type");
    if (!buildType) {
      return;
    }

    setSelectedBuildType(buildType);
    syncHud();
    draw();
  });

  startBtn.addEventListener("click", () => {
    startGame();
  });

  function renderGameToText() {
    // Expose a compact text snapshot so tests and debugging tools can inspect game state.
    const selectedTower = getSelectedTower();
    const buildPreview = getHoveredBuildPreview();
    const payload = {
      mode: state.mode,
      coordinateSystem: "原點在左上，x 軸向右、y 軸向下；位置使用畫布像素，格位使用地圖索引",
      resources: {
        gold: state.gold,
        lives: state.lives,
        wave: Math.min(state.waveIndex + (state.mode === "won" ? 0 : 1), waves.length),
        totalWaves: waves.length,
        selectedBuildType: state.selectedBuildType,
      },
      towers: state.towers.map((tower) => ({
        id: tower.id,
        type: tower.type,
        typeLabel: getTowerType(tower.type).label,
        level: tower.level,
        totalSpent: tower.totalSpent,
        gridX: tower.gridX,
        gridY: tower.gridY,
        x: Math.round(tower.x),
        y: Math.round(tower.y),
        range: tower.range,
        damage: tower.damage,
        cooldown: tower.cooldown,
        attacksPerSecond: Number(getTowerAttacksPerSecond(tower).toFixed(2)),
        upgradeCost: getTowerUpgradeCost(tower),
        sellValue: getTowerSellValue(tower),
      })),
      enemies: state.enemies.map((enemy) => ({
        type: enemy.type,
        x: Math.round(enemy.x),
        y: Math.round(enemy.y),
        hp: enemy.hp,
        speed: enemy.speed,
        pathIndex: enemy.pathIndex,
      })),
      path: pathCells,
      sprites: Object.keys(enemySprites).reduce((acc, type) => {
        acc[type] = {
          loaded: enemySprites[type].loaded,
          failed: enemySprites[type].failed,
          src: enemySpriteConfig[type].src,
          maxWidth: enemySpriteConfig[type].maxWidth,
          maxHeight: enemySpriteConfig[type].maxHeight,
        };
        return acc;
      }, {}),
      towerSprites: Object.keys(towerSprites).reduce((acc, type) => {
        acc[type] = {
          loaded: towerSprites[type].loaded,
          failed: towerSprites[type].failed,
          src: towerSpriteConfig[type].src,
          maxWidth: towerSpriteConfig[type].maxWidth,
          maxHeight: towerSpriteConfig[type].maxHeight,
        };
        return acc;
      }, {}),
      towerTypes: Object.keys(TOWER_TYPES).reduce((acc, type) => {
        acc[type] = {
          label: TOWER_TYPES[type].label,
          cost: TOWER_TYPES[type].cost,
          range: TOWER_TYPES[type].range,
          damage: TOWER_TYPES[type].damage,
          cooldown: TOWER_TYPES[type].cooldown,
        };
        return acc;
      }, {}),
      buildPreview: {
        status: buildPreview.status,
        reason: buildPreview.reason,
        gridX: buildPreview.gridX,
        gridY: buildPreview.gridY,
        selectedType: buildPreview.selectedType,
      },
      selectedTowerId: state.selectedTowerId,
      selectedTower: selectedTower
        ? {
            id: selectedTower.id,
            type: selectedTower.type,
            typeLabel: getTowerType(selectedTower.type).label,
            level: selectedTower.level,
            gridX: selectedTower.gridX,
            gridY: selectedTower.gridY,
            damage: selectedTower.damage,
            range: selectedTower.range,
            cooldown: selectedTower.cooldown,
            attacksPerSecond: Number(getTowerAttacksPerSecond(selectedTower).toFixed(2)),
            upgradeCost: getTowerUpgradeCost(selectedTower),
            sellValue: getTowerSellValue(selectedTower),
          }
        : null,
      message: state.message,
    };

    return JSON.stringify(payload);
  }

  function advanceTime(ms) {
    // Deterministic stepping lets tests advance the simulation without waiting in real time.
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      update(FIXED_DT);
    }
    draw();
  }

  // Public debug hooks make it easier to inspect or drive the game from the browser console.
  window.render_game_to_text = renderGameToText;
  window.advanceTime = advanceTime;
  window.__towerDefense = {
    startGame,
    getState: () => state,
    placeTower,
    setSelectedBuildType,
    upgradeSelectedTower,
    sellSelectedTower,
    enemySprites,
    towerSprites,
  };

  loadEnemySprites();
  loadTowerSprites();
  syncHud();
  draw();
  rafId = window.requestAnimationFrame(animationLoop);

  window.addEventListener("beforeunload", () => {
    window.cancelAnimationFrame(rafId);
  });
})();
