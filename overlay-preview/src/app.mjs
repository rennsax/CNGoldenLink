import { DemoSource, HttpSource, formatTier } from "./data.mjs";

const CANVAS_WIDTH = 1920;
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 3000;
const DEMO_STEP_INTERVAL_MS = 3500;
const DEMO_CHALLENGES = ["C", "FC", "All Major Secrets"];

const PAGE_COPY = {
  apex: {
    edition: "01 / APEX — PRECISION BROADCAST",
    title: "把每一步，带进直播。",
    description:
      "冰蓝色的转播仪表，清晰的路线层次。把空间让给游戏，让进步留在画面里。",
    signature: "APEX / EVERY ROOM COUNTS",
  },
  orbit: {
    edition: "02 / ORBIT — AMBIENT BROADCAST",
    title: "暖光随行，专注下一间。",
    description:
      "铜金、柔和的圆弧与缓慢流动的光。带金时，整套仪表进入暖金状态。",
    signature: "ORBIT / FOLLOW THE LIGHT",
  },
};

const CONTEXT_NOTES = {
  ready: "选择自动保存，同步到 OBS",
  cached: "金榜连接中断，使用缓存资料",
  unmatched: "地图尚未配对，请到金榜账户页申请配对",
  authorization_required: "请开启金榜连接完成授权",
  unavailable: "金榜资料暂不可用",
  waiting: "等待进入地图",
};

const GOLDEN_PB_FIELDS = [
  ["golden-pb", "goldenPbRoomIndex", "goldenPb"],
  ["session-golden-pb", "sessionGoldenPbRoomIndex", "sessionGoldenPb"],
];

const getElement = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isOrbit = location.pathname === "/orbit";
const isObs = params.has("obs");
const isLive =
  document.body.dataset.source === "live" || params.get("source") === "live";
const heartEnabled = params.get("heart") === "1";

const board = getElement("board");
const viewport = getElement("viewport");
const controls = document.querySelector(".controls");
const demoButtons = [...document.querySelectorAll(".buttons button")];

let choiceSelect;
let contextNote;
let data;
let initial;
let timer;
let playing = false;
let liveBusy = false;

function format(value, decimalPlaces = 0) {
  if (value == null) return "—";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

function setText(id, value) {
  const element = getElement(id);
  if (element.textContent === value) return;

  element.textContent = value;
  element.classList.remove("value-change");
  void element.offsetWidth;
  element.classList.add("value-change");
}

function configurePage() {
  const theme = isOrbit ? PAGE_COPY.orbit : PAGE_COPY.apex;

  document.body.classList.toggle("orbit-page", isOrbit);
  document.body.classList.toggle("obs", isObs);
  document.documentElement.classList.toggle("obs-root", isObs);
  board.classList.toggle("orbit", isOrbit);
  board.classList.toggle("heart-enabled", heartEnabled);
  getElement("heart-module").hidden = !heartEnabled;

  getElement(isOrbit ? "orbit-link" : "apex-link").classList.add("active");
  getElement("edition").textContent = theme.edition;
  getElement("page-title").textContent = theme.title;
  getElement("description").textContent = theme.description;
  getElement("theme-signature").textContent = theme.signature;

  const obsParams = new URLSearchParams({ obs: "1" });
  if (isLive) obsParams.set("source", "live");
  if (heartEnabled) obsParams.set("heart", "1");
  getElement("obs-link").href = `${location.pathname}?${obsParams}`;
}

function resizePreview() {
  if (!isObs) {
    board.style.transform = `scale(${viewport.clientWidth / CANVAS_WIDTH})`;
  }
}

function updateClock() {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  getElement("current-time").textContent = time;
  getElement("current-date").textContent = now.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function createChallengeControls() {
  if (!isLive || isObs) return;

  const panel = document.createElement("div");
  panel.className = "live-controls";

  const label = document.createElement("label");
  label.textContent = "当前挑战 ";

  choiceSelect = document.createElement("select");
  contextNote = document.createElement("span");
  label.append(choiceSelect);
  panel.append(label, contextNote);
  controls.after(panel);

  choiceSelect.onchange = saveChallengeSelection;
}

async function saveChallengeSelection() {
  const selected = choiceSelect.value;
  if (!data?.mapId || !selected) return;

  choiceSelect.disabled = true;
  try {
    const response = await fetch("/api/overlay/selection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GoldenLink": "overlay",
      },
      body: JSON.stringify({ mapId: data.mapId, challengeId: selected }),
    });

    if (!response.ok) throw new Error();
  } catch {
    contextNote.textContent = "选择未保存，请重试";
  } finally {
    choiceSelect.disabled = false;
  }
}

function renderChallengeControls() {
  if (!choiceSelect) return;

  const signature = JSON.stringify([
    data.mapId,
    data.choices,
    data.selectedChallengeId,
  ]);

  if (choiceSelect.dataset.signature !== signature) {
    choiceSelect.dataset.signature = signature;
    choiceSelect.replaceChildren();

    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = "请选择挑战";
    choiceSelect.append(prompt);

    for (const challenge of data.choices) {
      const option = document.createElement("option");
      option.value = challenge.id;
      option.textContent = challenge.name;
      choiceSelect.append(option);
    }

    choiceSelect.value = data.selectedChallengeId || "";
    choiceSelect.disabled = !data.choices.length;
  }

  contextNote.textContent = CONTEXT_NOTES[data.contextStatus] || "等待本地数据";
}

function renderStatus() {
  board.classList.toggle("golden", data.live.holdingGolden);
  board.classList.toggle("paused", data.live.paused);
  board.classList.toggle("disconnected", !data.connected);

  setText(
    "status",
    !data.connected
      ? "连接中断"
      : data.live.paused
        ? "已暂停"
        : data.live.holdingGolden
          ? "炼"
          : "练",
  );
}

function renderMapDetails() {
  const mapName = data.catalog.mapName || "未匹配地图";
  setText(
    "map-name",
    `${mapName}${data.catalog.challenge ? ` [${data.catalog.challenge}]` : ""}`,
  );

  const tierLabel = formatTier(data.catalog.tier);
  setText("tier", tierLabel);
  getElement("tier").classList.toggle("tier-long", tierLabel.length > 4);
}

function renderGoldenPb() {
  const { cct, live } = data;
  getElement("golden-pb-block").hidden = !live.holdingGolden;

  for (const [id, indexField, nameField] of GOLDEN_PB_FIELDS) {
    const index = cct[indexField];
    const name = cct[nameField];
    const known = index != null && cct.roomCount > 0;
    const bar = getElement(`${id}-bar`);

    setText(id, `${format(index)} / ${format(cct.roomCount)}`);
    bar.value = known ? Math.min(1, Math.max(0, index / cct.roomCount)) : 0;
    bar.title = name ?? "暂无记录";
    bar.setAttribute(
      "aria-valuetext",
      known ? `${index} / ${cct.roomCount}，${name ?? ""}` : "暂无记录",
    );
  }
}

function renderTelemetry() {
  const { cct, live } = data;

  setText("room", live.room || "等待关卡");
  setText("room-count", `${format(cct.roomIndex)} / ${format(cct.roomCount)}`);
  setText("entry-rate", format(cct.entryRate, 2));
  setText("success", format(cct.successRate, 2));
  setText("golden-deaths", format(cct.goldenDeaths));

  const roomProgress = cct.roomCount
    ? Math.min(100, Math.max(0, (cct.roomIndex / cct.roomCount) * 100))
    : 0;
  getElement("progress").style.width = `${roomProgress}%`;
}

function renderStateLine() {
  const stateLine = !data.connected
    ? "连接中断 · 保留最后快照"
    : data.live.paused
      ? "稍作停留，下一次继续。"
      : data.live.holdingGolden
        ? "金莓在身，下一间见。"
        : "练习的每一步，都有迹可循。";

  setText("state-line", stateLine);
}

function renderButtonStates() {
  const states = [
    ["golden", data.live.holdingGolden],
    ["paused", data.live.paused],
    ["offline", !data.connected],
    ["play", playing],
  ];

  for (const [id, state] of states) {
    getElement(id).setAttribute("aria-pressed", String(state));
  }
}

function render() {
  renderChallengeControls();
  demoButtons.forEach((button) => (button.disabled = false));
  renderStatus();
  renderMapDetails();
  renderGoldenPb();
  renderTelemetry();
  renderStateLine();
  renderButtonStates();
}

function advanceDemo() {
  if (!data || data.live.paused || !data.connected) return;

  const { cct } = data;
  cct.roomIndex = (cct.roomIndex % cct.roomCount) + 1;
  data.live.room = `Room-${cct.roomIndex}`;
  cct.checkpointIndex = cct.roomIndex <= 4 ? 1 : cct.roomIndex <= 9 ? 2 : 3;
  cct.streak++;
  cct.bestStreak = Math.max(cct.streak, cct.bestStreak);
  cct.recent = [...cct.recent.slice(1), true];
  cct.successes++;
  cct.attempts++;
  cct.successRate = (cct.successes / cct.attempts) * 100;
  render();
}

function cycleDemoChallenge() {
  const currentIndex = DEMO_CHALLENGES.indexOf(data.catalog.challenge);
  data.catalog.challenge =
    DEMO_CHALLENGES[(currentIndex + 1) % DEMO_CHALLENGES.length];
  render();
}

function toggleDemoGolden() {
  data.live.holdingGolden = !data.live.holdingGolden;
  render();
}

function toggleDemoPaused() {
  data.live.paused = !data.live.paused;
  render();
}

function toggleDemoOffline() {
  data.connected = !data.connected;
  render();
}

function toggleDemoPlayback() {
  playing = !playing;
  clearInterval(timer);

  if (playing) {
    timer = setInterval(advanceDemo, DEMO_STEP_INTERVAL_MS);
  }

  getElement("play").textContent = playing ? "停止演示" : "播放演示";
  render();
}

function resetDemo() {
  clearInterval(timer);
  playing = false;
  data = structuredClone(initial);
  getElement("play").textContent = "播放演示";
  render();
}

function configureDemoControls() {
  getElement("change-challenge").onclick = cycleDemoChallenge;
  getElement("next").onclick = advanceDemo;
  getElement("golden").onclick = toggleDemoGolden;
  getElement("paused").onclick = toggleDemoPaused;
  getElement("offline").onclick = toggleDemoOffline;
  getElement("play").onclick = toggleDemoPlayback;
  getElement("reset").onclick = resetDemo;
}

function showInitialLoadFailure(live) {
  getElement("map-name").textContent = "等待本地数据";
  getElement("status").textContent = "数据接口尚未连接";
  getElement("source-label").textContent = live ? "NO DATA" : "DEMO ERROR";
}

async function start() {
  const source = isLive ? new HttpSource() : new DemoSource();
  if (isLive) controls.hidden = true;

  const poll = async () => {
    if (liveBusy) return;

    liveBusy = true;
    try {
      data = await source.read(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      initial = structuredClone(data);
      render();
    } catch {
      if (data) {
        data.connected = false;
        render();
      } else {
        showInitialLoadFailure(isLive);
      }
    } finally {
      liveBusy = false;
    }
  };

  await poll();
  if (isLive) setInterval(poll, POLL_INTERVAL_MS);
}

configurePage();
createChallengeControls();
new ResizeObserver(resizePreview).observe(viewport);
resizePreview();
demoButtons.forEach((button) => (button.disabled = true));
updateClock();
setInterval(updateClock, 1000);
configureDemoControls();
start();
