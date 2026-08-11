import { isRuntimeSourceFailure } from "./playerFallback.js";

const API_PREFIX = "/api/poc/youtube-fallback";

interface Candidate {
  videoId: string;
  title: string;
  channelTitle: string;
  durationMs: number;
  embeddable: boolean;
  madeForKids?: boolean;
  searchRank: number;
}

interface CandidateView {
  candidate: Candidate;
  decision: "selected" | "eligible" | "rejected";
  reasons: string[];
}

interface ResolveSearchSummary {
  query: string;
  searchCount: number;
  candidateCount: number;
  missingVideoIds: string[];
}

type ResolveResponse =
  | {
      kind: "matched";
      resolutionId: string;
      candidate: Candidate;
      reasons: string[];
      candidates: CandidateView[];
      search: ResolveSearchSummary;
    }
  | {
      kind: "no_match";
      code: string;
      candidates: CandidateView[];
      search: ResolveSearchSummary;
    }
  | {
      kind: "error";
      code: string;
      message: string;
      errors?: string[];
    };

type RuntimeFailureResponse =
  | {
      kind: "switched";
      resolutionId: string;
      failedVideoId: string;
      errorCode: 100 | 101 | 150;
      candidate: Candidate;
      reasons: string[];
    }
  | {
      kind: "exhausted";
      resolutionId: string;
      failedVideoId: string;
      errorCode: 100 | 101 | 150;
    }
  | {
      kind: "error";
      code: string;
      message: string;
    };

interface YouTubePlayer {
  cueVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: string | HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady(event: { target: YouTubePlayer }): void;
        onStateChange(event: { data: number; target: YouTubePlayer }): void;
        onError(event: { data: number; target: YouTubePlayer }): void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const getElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`POC_ELEMENT_MISSING:${selector}`);
  return element;
};

const healthElement = getElement<HTMLElement>("#health");
const resolveButton = getElement<HTMLButtonElement>("#resolve");
const resultPanel = getElement<HTMLElement>("#result-panel");
const resultKind = getElement<HTMLElement>("#result-kind");
const searchSummary = getElement<HTMLElement>("#search-summary");
const finalSelection = getElement<HTMLElement>("#final-selection");
const candidatesElement = getElement<HTMLElement>("#candidates");
const rawResponse = getElement<HTMLElement>("#raw-response");
const playerPanel = getElement<HTMLElement>("#player-panel");
const playerFrame = getElement<HTMLElement>("#player-frame");
const playerLog = getElement<HTMLOListElement>("#player-log");
const currentTime = getElement<HTMLElement>("#current-time");
const requestError = getElement<HTMLElement>("#request-error");
const recoverButton = getElement<HTMLButtonElement>("#recover");
const youtubeLink = getElement<HTMLAnchorElement>("#youtube-link");

let player: YouTubePlayer | undefined;
let youtubeApiPromise: Promise<YouTubeNamespace> | undefined;
let currentTimeTimer: number | undefined;
let autoplayTimer: number | undefined;
let playerMountToken = 0;
let activeResolutionId: string | undefined;
const runtimeRejectedVideoIds = new Set<string>();

function isResolveResponse(value: unknown): value is ResolveResponse {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function isRuntimeFailureResponse(value: unknown): value is RuntimeFailureResponse {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function setRequestError(message?: string): void {
  requestError.hidden = !message;
  requestError.textContent = message ?? "";
}

function addPlayerLog(message: string): void {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  playerLog.prepend(item);
}

function stateName(state: number): string {
  const states = window.YT?.PlayerState;
  if (!states) return `UNKNOWN(${state})`;
  if (state === states.ENDED) return "ENDED";
  if (state === states.PLAYING) return "PLAYING";
  if (state === states.PAUSED) return "PAUSED";
  if (state === states.BUFFERING) return "BUFFERING";
  if (state === states.CUED) return "CUED";
  return `UNSTARTED(${state})`;
}

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("YOUTUBE_IFRAME_API_TIMEOUT")), 15_000);
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YOUTUBE_IFRAME_API_UNAVAILABLE"));
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("YOUTUBE_IFRAME_API_LOAD_FAILED"));
      document.head.append(script);
    }
  });
  return youtubeApiPromise;
}

function monitorAutoplay(): void {
  if (autoplayTimer !== undefined) window.clearTimeout(autoplayTimer);
  autoplayTimer = window.setTimeout(() => {
    if (!player || player.getPlayerState() === window.YT?.PlayerState.PLAYING) return;
    recoverButton.hidden = false;
    addPlayerLog("AUTOPLAY_BLOCKED_OR_NOT_STARTED：请点击“恢复播放”提供用户手势");
  }, 2500);
}

async function reportRuntimeFailure(
  resolutionId: string,
  videoId: string,
  errorCode: 100 | 101 | 150,
  tryAutoplay: boolean,
): Promise<void> {
  const response = await fetch(`${API_PREFIX}/runtime-failure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resolutionId, videoId, errorCode }),
  });
  const payload: unknown = await response.json();
  if (!isRuntimeFailureResponse(payload)) throw new Error("INVALID_RUNTIME_FAILURE_RESPONSE");

  if (payload.kind === "error") {
    activeResolutionId = undefined;
    setRequestError(`运行时失败上报被服务端拒绝：${payload.code} · ${payload.message}`);
    addPlayerLog(`SERVER_RUNTIME_FAILURE_ERROR(${payload.code})`);
    return;
  }

  if (payload.kind === "exhausted") {
    activeResolutionId = undefined;
    finalSelection.textContent = "运行时无可播放候选：服务端候选已耗尽";
    setRequestError("YouTube IFrame 拒绝了全部合格候选；不会提取或代理音频流。");
    addPlayerLog("NO_RUNTIME_PLAYABLE_CANDIDATE");
    return;
  }

  activeResolutionId = payload.resolutionId;
  finalSelection.textContent = `服务端运行时切换：${payload.candidate.title} (${payload.candidate.videoId}) · 前一候选 ERROR(${payload.errorCode})`;
  addPlayerLog(`SERVER_SELECTED_NEXT_CANDIDATE(${payload.candidate.videoId})`);
  await mountPlayer(payload.candidate.videoId, tryAutoplay, false);
}

async function mountPlayer(
  videoId: string,
  tryAutoplay: boolean,
  resetLog = true,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("INVALID_VIDEO_ID");

  const mountToken = ++playerMountToken;
  playerPanel.hidden = false;
  youtubeLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  recoverButton.hidden = true;
  if (resetLog) playerLog.replaceChildren();
  addPlayerLog(`正在加载可见 IFrame：${videoId}`);

  const youtube = await loadYouTubeApi();
  player?.destroy();
  playerFrame.replaceChildren();
  const target = document.createElement("div");
  target.id = "youtube-player-target";
  playerFrame.append(target);

  player = new youtube.Player(target, {
    width: "100%",
    height: "100%",
    videoId,
    playerVars: {
      controls: 1,
      playsinline: 1,
      rel: 0,
      origin: window.location.origin,
    },
    events: {
      onReady(event) {
        if (mountToken !== playerMountToken) return;
        player = event.target;
        addPlayerLog("READY");
        if (tryAutoplay) {
          addPlayerLog("AUTOPLAY_ATTEMPT");
          event.target.playVideo();
          monitorAutoplay();
        }
      },
      onStateChange(event) {
        if (mountToken !== playerMountToken) return;
        const name = stateName(event.data);
        addPlayerLog(name);
        if (name === "PLAYING") {
          recoverButton.hidden = true;
          if (autoplayTimer !== undefined) window.clearTimeout(autoplayTimer);
        }
      },
      onError(event) {
        if (mountToken !== playerMountToken) return;
        if (isRuntimeSourceFailure(event.data) && runtimeRejectedVideoIds.has(videoId)) return;
        addPlayerLog(`ERROR(${event.data})`);
        if (!isRuntimeSourceFailure(event.data) || !activeResolutionId) {
          recoverButton.hidden = false;
          return;
        }

        runtimeRejectedVideoIds.add(videoId);
        recoverButton.hidden = true;
        if (autoplayTimer !== undefined) window.clearTimeout(autoplayTimer);
        addPlayerLog(`RUNTIME_REJECTED(${videoId})：正在上报服务端`);
        const resolutionId = activeResolutionId;
        ++playerMountToken;
        player?.destroy();
        player = undefined;
        void reportRuntimeFailure(resolutionId, videoId, event.data, tryAutoplay).catch((error) => {
          activeResolutionId = undefined;
          setRequestError(`运行时失败上报失败：${String(error)}`);
        });
      },
    },
  });

  if (currentTimeTimer !== undefined) window.clearInterval(currentTimeTimer);
  currentTimeTimer = window.setInterval(() => {
    if (!player) return;
    const seconds = player.getCurrentTime();
    currentTime.textContent = `currentTime：${Number.isFinite(seconds) ? seconds.toFixed(2) : "不可用"} 秒`;
  }, 500);
}

function addSummaryTerm(term: string, description: string): void {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = description;
  searchSummary.append(dt, dd);
}

function renderCandidates(candidates: CandidateView[]): void {
  candidatesElement.replaceChildren();
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "没有可展示的详情候选。";
    candidatesElement.append(empty);
    return;
  }

  for (const [index, view] of candidates.entries()) {
    const article = document.createElement("article");
    article.className = `candidate candidate--${view.decision}`;
    const heading = document.createElement("h3");
    heading.textContent = `${index + 1}. ${view.candidate.title}`;
    const metadata = document.createElement("p");
    metadata.className = "candidate-meta";
    metadata.textContent = `${view.candidate.channelTitle} · ${(view.candidate.durationMs / 1000).toFixed(1)} 秒 · rank ${view.candidate.searchRank}`;
    const decision = document.createElement("span");
    decision.className = `badge badge--${view.decision}`;
    decision.textContent = view.decision.toUpperCase();
    const reasons = document.createElement("p");
    reasons.className = "reasons";
    reasons.textContent = view.reasons.length > 0 ? view.reasons.join(" · ") : "NO_REASONS";
    article.append(decision, heading, metadata, reasons);
    candidatesElement.append(article);
  }
}

async function renderResponse(httpStatus: number, response: ResolveResponse): Promise<void> {
  resultPanel.hidden = false;
  rawResponse.textContent = JSON.stringify({ httpStatus, ...response }, null, 2);
  resultKind.textContent = response.kind;
  resultKind.className = `badge badge--${response.kind}`;
  searchSummary.replaceChildren();

  if (response.kind === "error") {
    finalSelection.textContent = `${response.code}: ${response.message}`;
    renderCandidates([]);
    playerPanel.hidden = true;
    return;
  }

  addSummaryTerm("query", response.search.query);
  addSummaryTerm("搜索结果", String(response.search.searchCount));
  addSummaryTerm("详情候选", String(response.search.candidateCount));
  addSummaryTerm("详情缺失 ID", response.search.missingVideoIds.join(", ") || "无");
  renderCandidates(response.candidates);

  if (response.kind === "no_match") {
    finalSelection.textContent = `明确不选择候选：${response.code}`;
    playerPanel.hidden = true;
    return;
  }

  finalSelection.textContent = `最终选择：${response.candidate.title} (${response.candidate.videoId}) · ${response.reasons.join(" · ")}`;
  const tryAutoplay = getElement<HTMLInputElement>("#autoplay").checked;
  activeResolutionId = response.resolutionId;
  runtimeRejectedVideoIds.clear();
  await mountPlayer(response.candidate.videoId, tryAutoplay);
}

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch(`${API_PREFIX}/health`);
    const payload = (await response.json()) as { fallbackEnabled?: boolean; regionCode?: string };
    healthElement.textContent = payload.fallbackEnabled
      ? `服务已就绪 · region ${payload.regionCode ?? "unknown"}`
      : "服务已启动，但未配置 YOUTUBE_API_KEY";
    healthElement.classList.toggle("health--ready", Boolean(payload.fallbackEnabled));
  } catch (error) {
    healthElement.textContent = `POC 服务不可用：${String(error)}`;
  }
}

resolveButton.addEventListener("click", async () => {
  setRequestError();
  resolveButton.disabled = true;
  resolveButton.textContent = "解析中…";
  try {
    const title = getElement<HTMLInputElement>("#title").value;
    const artists = getElement<HTMLInputElement>("#artists")
      .value.split(",")
      .map((artist) => artist.trim())
      .filter(Boolean);
    const durationValue = getElement<HTMLInputElement>("#duration").value.trim();
    const durationMs = durationValue ? Number(durationValue) : undefined;
    const response = await fetch(`${API_PREFIX}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        track: {
          title,
          artists,
          durationMs,
          origin: { provider: "unknown", resourceId: "poc-manual-input" },
        },
      }),
    });
    const payload: unknown = await response.json();
    if (!isResolveResponse(payload)) throw new Error("INVALID_RESOLVE_RESPONSE");
    await renderResponse(response.status, payload);
  } catch (error) {
    setRequestError(`解析或播放器初始化失败：${String(error)}`);
  } finally {
    resolveButton.disabled = false;
    resolveButton.textContent = "调用 POC Resolver";
  }
});

getElement<HTMLButtonElement>("#play").addEventListener("click", () => player?.playVideo());
getElement<HTMLButtonElement>("#pause").addEventListener("click", () => player?.pauseVideo());
getElement<HTMLButtonElement>("#seek").addEventListener("click", () => {
  const seconds = Number(getElement<HTMLInputElement>("#seek-time").value);
  if (player && Number.isFinite(seconds) && seconds >= 0) {
    player.seekTo(seconds, true);
    addPlayerLog(`SEEK(${seconds})`);
  }
});
recoverButton.addEventListener("click", () => {
  recoverButton.hidden = true;
  addPlayerLog("USER_GESTURE_RECOVERY");
  player?.playVideo();
});
getElement<HTMLButtonElement>("#error-test").addEventListener("click", async () => {
  setRequestError();
  activeResolutionId = undefined;
  runtimeRejectedVideoIds.clear();
  try {
    await mountPlayer("aaaaaaaaaaa", false);
    addPlayerLog("ERROR_TEST_VIDEO_LOADED：等待 YouTube 返回 ERROR(100)");
  } catch (error) {
    setRequestError(`错误路径测试初始化失败：${String(error)}`);
  }
});

getElement<HTMLButtonElement>("#official-sample-test").addEventListener("click", async () => {
  setRequestError();
  activeResolutionId = undefined;
  runtimeRejectedVideoIds.clear();
  try {
    await mountPlayer("M7lc1UVf-VE", false);
    addPlayerLog("OFFICIAL_IFRAME_SAMPLE_LOADED：请点击播放验证当前浏览器环境");
  } catch (error) {
    setRequestError(`官方示例视频初始化失败：${String(error)}`);
  }
});

void checkHealth();
