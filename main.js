(function () {
  // Cache the DOM and canvas handles once so the game loop can reuse them cheaply.
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const buildPanelEl = document.getElementById("build-panel");
  const statsEl = document.getElementById("stats");
  const towerInfoEl = document.getElementById("tower-info");
  const messageEl = document.getElementById("message");
  const startBtn = document.getElementById("start-btn");

  // Core rules and balancing values live together at the top for quick tuning.
  const TILE_SIZE = 64;
  const GRID_COLS = 12;
  const GRID_ROWS = 9;
  const STARTING_GOLD = 90;
  const STARTING_LIVES = 12;
  const TOWER_MAX_LEVEL = 3;
  const TOWER_SELECT_RADIUS = 28;
  const FIXED_DT = 1 / 60;
  const ENEMY_RADIUS = 14;
  const DEFAULT_MESSAGE = "Press start, then place towers on grass tiles.";

  const TOWER_TYPES = {
    basic: {
      label: "Basic Fish",
      cost: 25,
      range: TILE_SIZE * 2.15,
      damage: 11,
      cooldown: 0.55,
      upgradeCosts: [35, 60],
      upgradeDamage: 6,
      upgradeRange: 18,
      upgradeCooldownStep: 0.08,
      markerColor: "rgba(201, 111, 59, 0.18)",
    },
    sniper: {
      label: "Sniper Fish",
      cost: 45,
      range: TILE_SIZE * 3.05,
      damage: 24,
      cooldown: 1.05,
      upgradeCosts: [55, 80],
      upgradeDamage: 12,
      upgradeRange: 22,
      upgradeCooldownStep: 0.1,
      markerColor: "rgba(52, 115, 106, 0.18)",
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
    { count: 5, type: "scout", spacing: 1.1 },
    { count: 8, type: "scout", spacing: 0.85 },
    { count: 4, type: "brute", spacing: 1.35 },
    { count: 6, type: "mix", spacing: 0.9 },
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
  };

  const enemySprites = {
    scout: { image: null, loaded: false, failed: false },
    brute: { image: null, loaded: false, failed: false },
  };
  const towerSprites = {
    basic: { image: null, loaded: false, failed: false },
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
        type,
        x: pathPoints[0].x,
        y: pathPoints[0].y,
        hp: 40,
        maxHp: 40,
        speed: 42,
        reward: 10,
        pathIndex: 0,
        radius: ENEMY_RADIUS + 4,
      };
    }

    return {
      type: "scout",
      x: pathPoints[0].x,
      y: pathPoints[0].y,
      hp: 20,
      maxHp: 20,
      speed: 58,
      reward: 7,
      pathIndex: 0,
      radius: ENEMY_RADIUS,
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
      enemies: [],
      effects: [],
      hoveredCell: null,
      spawnTimer: 0,
      spawnedInWave: 0,
      queuedWaveDelay: 0.8,
      message: DEFAULT_MESSAGE,
    };
  }

  let state = resetState();
  let lastTimestamp = 0;
  let rafId = 0;
  let lastBuildPanelMarkup = "";
  let lastStatsMarkup = "";
  let lastTowerInfoMarkup = "";
  let lastMessageText = "";

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
    state.message = getTowerType(type).label + " ready to place.";
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
      state.message = "Select a tower first.";
      return;
    }

    const upgradeCost = getTowerUpgradeCost(tower);
    if (upgradeCost === null) {
      state.message = "This tower is already max level.";
      return;
    }

    if (state.gold < upgradeCost) {
      state.message = "Not enough gold to upgrade.";
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
    state.message = "Tower upgraded to level " + tower.level + ".";
  }

  function sellSelectedTower() {
    const tower = getSelectedTower();
    if (!tower) {
      state.message = "Select a tower first.";
      return;
    }

    const sellValue = getTowerSellValue(tower);
    state.gold += sellValue;
    state.towers = state.towers.filter((candidate) => candidate.id !== tower.id);
    clearTowerSelection();
    state.message = "Tower sold for " + sellValue + " gold.";
  }

  function canBuildAt(x, y) {
    if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) {
      return false;
    }
    return !isPathCell(x, y) && !isRockCell(x, y) && !isTowerAt(x, y);
  }

  function startGame() {
    state = resetState();
    state.mode = "playing";
    state.message = "Wave 1 is coming in. Place a few towers.";
    syncHud();
    draw();
  }

  function spawnEnemyForWave(index) {
    const wave = waves[index];
    if (!wave) {
      return null;
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
        state.message = "You held every wave. Press start to play again.";
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
        state.queuedWaveDelay = 1.2;
        if (waves[state.waveIndex]) {
          state.message = "Wave " + (state.waveIndex + 1) + " begins.";
        }
      }
    }
  }

  function updateEnemies(dt) {
    const survivors = [];

    for (const enemy of state.enemies) {
      const nextPoint = pathPoints[enemy.pathIndex + 1];
      if (!nextPoint) {
        state.lives -= 1;
        state.message = "An enemy slipped through.";
        if (state.lives <= 0) {
          state.mode = "lost";
          state.message = "The line is broken. Press start to retry.";
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
    for (const tower of state.towers) {
      tower.cooldownLeft = Math.max(0, tower.cooldownLeft - dt);
      let target = null;
      let bestProgress = -1;

      for (const enemy of state.enemies) {
        const distance = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
        if (distance <= tower.range) {
          const progressScore = enemy.pathIndex * 1000 - distance;
          if (progressScore > bestProgress) {
            bestProgress = progressScore;
            target = enemy;
          }
        }
      }

      if (!target) {
        continue;
      }

      tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
      if (tower.cooldownLeft > 0) {
        continue;
      }

      target.hp -= tower.damage;
      tower.cooldownLeft = tower.cooldown;
      state.effects.push({
        x1: tower.x,
        y1: tower.y,
        x2: target.x,
        y2: target.y,
        life: 0.08,
      });

      if (target.hp <= 0) {
        state.gold += target.reward;
        state.message = "Enemy defeated. +" + target.reward + " gold.";
      }
    }
  }

  function updateEffects(dt) {
    state.effects = state.effects
      .map((effect) => ({
        x1: effect.x1,
        y1: effect.y1,
        x2: effect.x2,
        y2: effect.y2,
        life: effect.life - dt,
      }))
      .filter((effect) => effect.life > 0);
  }

  function update(dt) {
    // The simulation step updates game systems first, then the HUD reflects the new state.
    if (state.mode === "playing") {
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
    const selectedBuildType = getSelectedBuildType();
    if (state.mode !== "playing") {
      state.message = "Press start before placing towers.";
      return;
    }

    if (!canBuildAt(gridX, gridY)) {
      state.message = "That tile is blocked.";
      return;
    }

    if (!selectedBuildType || state.gold < selectedBuildType.cost) {
      state.message = "Not enough gold yet.";
      return;
    }

    state.gold -= selectedBuildType.cost;
    const tower = createTower(gridX, gridY, state.nextTowerId, state.selectedBuildType);
    state.nextTowerId += 1;
    state.towers.push(tower);
    selectTowerById(tower.id);
    state.message = selectedBuildType.label + " deployed.";
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
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        drawTile(col, row, mapLayout[row][col]);
      }
    }

    if (state.hoveredCell) {
      const x = state.hoveredCell.x;
      const y = state.hoveredCell.y;
      if (x >= 0 && y >= 0 && x < GRID_COLS && y < GRID_ROWS) {
        ctx.fillStyle = canBuildAt(x, y) ? "rgba(52, 115, 106, 0.28)" : "rgba(201, 111, 59, 0.26)";
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
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
    if (!selectedTower) {
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

      const config = towerSpriteConfig[tower.type];
      const sprite = towerSprites[tower.type];
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
        continue;
      }

      ctx.save();
      ctx.translate(tower.x, tower.y);
      ctx.fillStyle = tower.type === "sniper" ? "#6d4c41" : "#2d5f57";
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(tower.angle);
      ctx.fillStyle = "#ffe8b0";
      ctx.fillRect(0, -4, 28, 8);
      ctx.restore();
    }
  }

  function drawEnemyFallback(enemy) {
    ctx.fillStyle = enemy.type === "brute" ? "#7c2d2d" : "#9d4edd";
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

  function drawEnemies() {
    for (const enemy of state.enemies) {
      drawEnemySprite(enemy);

      const barWidth = 34;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = "rgba(29, 42, 50, 0.25)";
      ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 14, barWidth, 6);
      ctx.fillStyle = "#90be6d";
      ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.radius - 14, barWidth * ratio, 6);
    }
  }

  function drawEffects() {
    ctx.save();
    ctx.lineWidth = 3;
    for (const effect of state.effects) {
      ctx.globalAlpha = Math.max(0.15, effect.life / 0.08);
      ctx.strokeStyle = "#fef3c7";
      ctx.beginPath();
      ctx.moveTo(effect.x1, effect.y1);
      ctx.lineTo(effect.x2, effect.y2);
      ctx.stroke();
    }
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

    let title = "Fishcat Tower Defense";
    if (state.mode === "won") {
      title = "Victory";
    } else if (state.mode === "lost") {
      title = "Defeat";
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
    drawTowers();
    drawEnemies();
    drawEffects();
    drawOverlay();
  }

  function syncHud() {
    const currentWave = Math.min(state.waveIndex + (state.mode === "won" ? 0 : 1), waves.length);
    const selectedTower = getSelectedTower();
    const buildPanelMarkup = [
      "<h2>Build Towers</h2>",
      "<p>Choose a tower, then click a grass tile to place it.</p>",
      "<div class=\"build-options\">",
      Object.entries(TOWER_TYPES).map(([type, towerType]) =>
        "<button type=\"button\" class=\"build-option" + (state.selectedBuildType === type ? " is-selected" : "") + "\" data-build-type=\"" + type + "\">"
        + "<strong>" + towerType.label + " - " + towerType.cost + "g</strong>"
        + "<small>DMG " + towerType.damage + " | RNG " + towerType.range.toFixed(0) + " | SPD " + (1 / towerType.cooldown).toFixed(2) + "/s</small>"
        + "</button>"
      ).join("")
      + "</div>",
    ].join("");
    if (buildPanelMarkup !== lastBuildPanelMarkup) {
      buildPanelEl.innerHTML = buildPanelMarkup;
      lastBuildPanelMarkup = buildPanelMarkup;
    }

    const statsMarkup = [
      "<div class=\"stat-chip\"><strong>Gold</strong>" + state.gold + "</div>",
      "<div class=\"stat-chip\"><strong>Lives</strong>" + state.lives + "</div>",
      "<div class=\"stat-chip\"><strong>Wave</strong>" + currentWave + " / " + waves.length + "</div>",
    ].join("");
    if (statsMarkup !== lastStatsMarkup) {
      statsEl.innerHTML = statsMarkup;
      lastStatsMarkup = statsMarkup;
    }

    let towerInfoMarkup = "";
    if (!selectedTower) {
      towerInfoEl.classList.add("is-hidden");
    } else {
      towerInfoEl.classList.remove("is-hidden");
      const upgradeCost = getTowerUpgradeCost(selectedTower);
      const sellValue = getTowerSellValue(selectedTower);
      towerInfoMarkup = [
        "<h2>Selected Tower</h2>",
        "<p><strong>Level</strong>: " + selectedTower.level + " / " + TOWER_MAX_LEVEL + "</p>",
        "<p><strong>Type</strong>: " + getTowerType(selectedTower.type).label + "</p>",
        "<p><strong>Grid</strong>: " + selectedTower.gridX + ", " + selectedTower.gridY + "</p>",
        "<p><strong>Damage</strong>: " + selectedTower.damage + "</p>",
        "<p><strong>Attack Speed</strong>: " + getTowerAttacksPerSecond(selectedTower).toFixed(2) + "/s</p>",
        "<p><strong>Range</strong>: " + selectedTower.range.toFixed(0) + "</p>",
        "<p><strong>Upgrade</strong>: " + (upgradeCost === null ? "MAX" : upgradeCost + " gold") + "</p>",
        "<p><strong>Sell</strong>: " + sellValue + " gold</p>",
        "<div class=\"tower-actions\">",
        "<button type=\"button\" class=\"tower-action\" data-action=\"upgrade\" " + (canUpgradeTower(selectedTower) ? "" : "disabled") + ">Upgrade</button>",
        "<button type=\"button\" class=\"tower-action secondary\" data-action=\"sell\">Sell</button>",
        "</div>",
      ].join("");
    }
    if (towerInfoMarkup !== lastTowerInfoMarkup) {
      towerInfoEl.innerHTML = towerInfoMarkup;
      lastTowerInfoMarkup = towerInfoMarkup;
    }

    if (state.message !== lastMessageText) {
      messageEl.textContent = state.message;
      lastMessageText = state.message;
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

    // Selection takes priority over placement so clicking an existing tower never spends gold by mistake.
    if (clickedTower) {
      if (clickedTower.id === state.selectedTowerId) {
        clearTowerSelection();
        state.message = "Tower deselected.";
        syncHud();
        draw();
        return;
      }

      selectTowerById(clickedTower.id);
      state.message = "Tower selected.";
      syncHud();
      draw();
      return;
    }

    if (canBuildAt(pointer.gridX, pointer.gridY)) {
      placeTower(pointer.gridX, pointer.gridY);
      syncHud();
      draw();
      return;
    }

    clearTowerSelection();
    state.message = "Selection cleared.";
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
    const payload = {
      mode: state.mode,
      coordinateSystem: "origin=(top-left), +x right, +y down, positions in canvas pixels, grid in tile indices",
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
