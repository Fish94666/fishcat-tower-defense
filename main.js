(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statsEl = document.getElementById("stats");
  const messageEl = document.getElementById("message");
  const startBtn = document.getElementById("start-btn");

  const TILE_SIZE = 64;
  const GRID_COLS = 12;
  const GRID_ROWS = 9;
  const STARTING_GOLD = 90;
  const STARTING_LIVES = 12;
  const TOWER_COST = 25;
  const FIXED_DT = 1 / 60;
  const ENEMY_RADIUS = 14;
  const DEFAULT_MESSAGE = "Press start, then place towers on grass tiles.";

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

  function createTower(gridX, gridY) {
    const centerX = gridX * TILE_SIZE + TILE_SIZE / 2;
    const centerY = gridY * TILE_SIZE + TILE_SIZE / 2;
    return {
      gridX,
      gridY,
      type: "basic",
      x: centerX,
      y: centerY,
      range: TILE_SIZE * 2.15,
      damage: 11,
      cooldown: 0.55,
      cooldownLeft: 0,
      angle: 0,
    };
  }

  function resetState() {
    return {
      mode: "ready",
      gold: STARTING_GOLD,
      lives: STARTING_LIVES,
      waveIndex: 0,
      towers: [],
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

  function isPathCell(x, y) {
    return mapLayout[y] && mapLayout[y][x] === "path";
  }

  function isRockCell(x, y) {
    return mapLayout[y] && mapLayout[y][x] === "rock";
  }

  function isTowerAt(x, y) {
    return state.towers.some((tower) => tower.gridX === x && tower.gridY === y);
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
    if (state.mode === "playing") {
      updateWave(dt);
      updateEnemies(dt);
      updateTowers(dt);
      updateEffects(dt);
    }

    syncHud();
  }

  function getPointerCell(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    return {
      x: Math.floor(canvasX / TILE_SIZE),
      y: Math.floor(canvasY / TILE_SIZE),
    };
  }

  function placeTower(gridX, gridY) {
    if (state.mode !== "playing") {
      state.message = "Press start before placing towers.";
      return;
    }

    if (!canBuildAt(gridX, gridY)) {
      state.message = "That tile is blocked.";
      return;
    }

    if (state.gold < TOWER_COST) {
      state.message = "Not enough gold yet.";
      return;
    }

    state.gold -= TOWER_COST;
    state.towers.push(createTower(gridX, gridY));
    state.message = "Tower deployed.";
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

  function drawTowers() {
    for (const tower of state.towers) {
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
      ctx.fillStyle = "#2d5f57";
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

    let title = "Mini Tower Defense";
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    drawPathMarkers();
    drawTowers();
    drawEnemies();
    drawEffects();
    drawOverlay();
  }

  function syncHud() {
    const currentWave = Math.min(state.waveIndex + (state.mode === "won" ? 0 : 1), waves.length);
    statsEl.innerHTML = [
      "<strong>Gold</strong>: " + state.gold,
      "<strong>Lives</strong>: " + state.lives,
      "<strong>Wave</strong>: " + currentWave + " / " + waves.length,
      "<strong>Towers</strong>: " + state.towers.length,
      "<strong>Enemies</strong>: " + state.enemies.length,
      "<strong>Sprites</strong>: " + spriteStatusText(),
    ].join("<br>");
    messageEl.textContent = state.message;
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
    state.hoveredCell = getPointerCell(event);
  });

  canvas.addEventListener("mouseleave", () => {
    state.hoveredCell = null;
  });

  canvas.addEventListener("click", (event) => {
    const cell = getPointerCell(event);
    placeTower(cell.x, cell.y);
    syncHud();
    draw();
  });

  startBtn.addEventListener("click", () => {
    startGame();
  });

  function renderGameToText() {
    const payload = {
      mode: state.mode,
      coordinateSystem: "origin=(top-left), +x right, +y down, positions in canvas pixels, grid in tile indices",
      resources: {
        gold: state.gold,
        lives: state.lives,
        wave: Math.min(state.waveIndex + (state.mode === "won" ? 0 : 1), waves.length),
        totalWaves: waves.length,
      },
      towers: state.towers.map((tower) => ({
        type: tower.type,
        gridX: tower.gridX,
        gridY: tower.gridY,
        x: Math.round(tower.x),
        y: Math.round(tower.y),
        range: tower.range,
        damage: tower.damage,
        cooldown: tower.cooldown,
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
      message: state.message,
    };

    return JSON.stringify(payload);
  }

  function advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      update(FIXED_DT);
    }
    draw();
  }

  window.render_game_to_text = renderGameToText;
  window.advanceTime = advanceTime;
  window.__towerDefense = {
    startGame,
    getState: () => state,
    placeTower,
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
