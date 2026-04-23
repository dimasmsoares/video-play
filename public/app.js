const player = document.querySelector("#player");
const nowPlayingTitle = document.querySelector("#nowPlayingTitle");
const foldersContainer = document.querySelector("#folders");
const videosContainer = document.querySelector("#videos");
const breadcrumbsContainer = document.querySelector("#breadcrumbs");
const sortControls = document.querySelector("#sortControls");
const searchInput = document.querySelector("#searchInput");
const logoutButton = document.querySelector("#logoutButton");

let currentData = null;
let currentPath = new URLSearchParams(window.location.search).get("path") || "";
let currentRatings = {};
let currentSort = "name";
let currentVideo = null;
const videoDurations = {};
const thumbCache = new Map();
let thumbObserver = null;
let activePicker = null;

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateUrl(path) {
  const url = new URL(window.location.href);
  if (path) url.searchParams.set("path", path);
  else url.searchParams.delete("path");
  window.history.pushState({ path }, "", url);
}

async function loadLibrary(path = "") {
  const [libRes, ratingsRes] = await Promise.all([
    fetch(`/api/library?path=${encodeURIComponent(path)}`),
    fetch("/api/ratings")
  ]);

  if (libRes.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  if (!libRes.ok) throw new Error("Nao foi possivel carregar a biblioteca.");

  currentData = await libRes.json();
  currentRatings = ratingsRes.ok ? await ratingsRes.json() : {};
  currentPath = currentData.path;
  searchInput.value = "";
  render();
}

function render() {
  if (!currentData) return;
  const query = searchInput.value.trim().toLowerCase();

  renderBreadcrumbs(currentData.breadcrumbs);
  renderFolders(currentData.folders.filter((f) => f.name.toLowerCase().includes(query)));
  renderSortControls();
  renderVideos(
    currentData.videos.filter((v) => `${v.name} ${v.filename}`.toLowerCase().includes(query))
  );
}

function renderBreadcrumbs(breadcrumbs) {
  breadcrumbsContainer.replaceChildren(
    ...breadcrumbs.map((crumb, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = crumb.name;
      button.className = index === breadcrumbs.length - 1 ? "active" : "";
      button.addEventListener("click", () => {
        updateUrl(crumb.path);
        loadLibrary(crumb.path);
      });
      return button;
    })
  );
}

function renderFolders(folders) {
  if (!folders.length) {
    foldersContainer.innerHTML = '<p class="empty-state">Nenhuma pasta aqui.</p>';
    return;
  }

  foldersContainer.replaceChildren(
    ...folders.map((folder) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "folder-card";

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.textContent = "/";

      const info = document.createElement("span");
      info.className = "folder-info";

      const nameEl = document.createElement("span");
      nameEl.className = "folder-name";
      nameEl.textContent = folder.name;

      const countEl = document.createElement("span");
      countEl.className = "folder-count";
      countEl.textContent = folder.videoCount === 1 ? "1 vídeo" : `${folder.videoCount} vídeos`;

      info.append(nameEl, countEl);
      button.append(icon, info);

      button.addEventListener("click", () => {
        updateUrl(folder.path);
        loadLibrary(folder.path);
      });
      return button;
    })
  );
}

function renderSortControls() {
  const options = [
    { key: "name", label: "Nome" },
    { key: "size", label: "Tamanho" },
    { key: "duration", label: "Duração" },
    { key: "rating", label: "Nota" }
  ];

  sortControls.replaceChildren(
    ...options.map(({ key, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `sort-btn${currentSort === key ? " active" : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        currentSort = key;
        render();
      });
      return btn;
    })
  );
}

function sortVideos(videos) {
  const sorted = [...videos];

  if (currentSort === "size") {
    sorted.sort((a, b) => b.size - a.size);
  } else if (currentSort === "duration") {
    sorted.sort((a, b) => {
      const da = videoDurations[a.path] ?? -1;
      const db = videoDurations[b.path] ?? -1;
      if (da < 0 && db < 0) return a.name.localeCompare(b.name);
      if (da < 0) return 1;
      if (db < 0) return -1;
      return db - da;
    });
  } else if (currentSort === "rating") {
    sorted.sort((a, b) => {
      const ra = currentRatings[a.path] ?? -1;
      const rb = currentRatings[b.path] ?? -1;
      if (ra < 0 && rb < 0) return a.name.localeCompare(b.name);
      if (ra < 0) return 1;
      if (rb < 0) return -1;
      return rb - ra;
    });
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }

  return sorted;
}

function renderVideos(videos) {
  if (thumbObserver) {
    thumbObserver.disconnect();
    thumbObserver = null;
  }

  if (!videos.length) {
    videosContainer.innerHTML = '<p class="empty-state">Nenhum video encontrado.</p>';
    return;
  }

  const sorted = sortVideos(videos);
  const thumbRefs = [];

  const cards = sorted.map((video) => {
    const card = document.createElement("div");
    card.className = "video-card";
    card.tabIndex = 0;

    const thumb = document.createElement("span");
    thumb.className = "video-thumb";
    thumb.dataset.path = video.path;
    thumb.dataset.stream = video.streamUrl;
    const playIcon = document.createElement("span");
    playIcon.textContent = "play";
    thumb.appendChild(playIcon);

    const title = document.createElement("span");
    title.className = "video-title";
    title.textContent = video.name;

    const meta = document.createElement("span");
    meta.className = "video-meta";

    const durationEl = document.createElement("span");
    durationEl.className = "video-duration";
    const knownDuration = videoDurations[video.path];
    if (knownDuration) durationEl.textContent = formatDuration(knownDuration);
    meta.appendChild(durationEl);

    const sizeEl = document.createElement("span");
    sizeEl.textContent = formatBytes(video.size);
    meta.appendChild(sizeEl);

    const ratingBadge = document.createElement("button");
    ratingBadge.type = "button";
    ratingBadge.className = "video-rating-badge";
    const rv = currentRatings[video.path];
    ratingBadge.textContent = rv !== undefined ? `★ ${rv}` : "★ —";
    ratingBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      openRatingPicker(ratingBadge, video.path);
    });
    meta.appendChild(ratingBadge);

    card.append(thumb, title, meta);
    card.addEventListener("click", () => playVideo(video));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        playVideo(video);
      }
    });

    thumbRefs.push({ thumb, path: video.path });
    return card;
  });

  videosContainer.replaceChildren(...cards);

  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const thumb = entry.target;
        thumbObserver.unobserve(thumb);
        generateThumb(thumb.dataset.path, thumb.dataset.stream).then((dataUrl) => {
          const dur = videoDurations[thumb.dataset.path];
          if (dur) {
            const el = thumb.closest(".video-card")?.querySelector(".video-duration");
            if (el) el.textContent = formatDuration(dur);
          }
          if (!dataUrl) return;
          const img = document.createElement("img");
          img.src = dataUrl;
          img.alt = "";
          thumb.replaceChildren(img);
        });
      }
    },
    { rootMargin: "200px" }
  );

  for (const { thumb, path } of thumbRefs) {
    if (thumbCache.has(path)) {
      const img = document.createElement("img");
      img.src = thumbCache.get(path);
      img.alt = "";
      thumb.replaceChildren(img);
    } else {
      thumbObserver.observe(thumb);
    }
  }
}

function generateThumb(videoPath, streamUrl) {
  if (thumbCache.has(videoPath)) return Promise.resolve(thumbCache.get(videoPath));

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    Object.assign(video.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none"
    });
    document.body.appendChild(video);

    let settled = false;
    const timeout = setTimeout(() => finish(null), 8000);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (video.parentNode) video.remove();
      resolve(result);
    }

    video.addEventListener("error", () => finish(null), { once: true });

    video.addEventListener(
      "loadedmetadata",
      () => {
        if (video.duration && isFinite(video.duration)) {
          videoDurations[videoPath] = video.duration;
        }
        video.currentTime =
          video.duration > 20 ? 20 : video.duration > 0 ? video.duration / 2 : 0;
      },
      { once: true }
    );

    video.addEventListener(
      "seeked",
      () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          canvas.getContext("2d").drawImage(video, 0, 0, 320, 180);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
          thumbCache.set(videoPath, dataUrl);
          finish(dataUrl);
        } catch {
          finish(null);
        }
      },
      { once: true }
    );

    video.src = streamUrl;
  });
}

function openRatingPicker(badge, videoPath) {
  if (activePicker) {
    activePicker.remove();
    activePicker = null;
  }

  const picker = document.createElement("div");
  picker.className = "rating-picker";

  for (let i = 0; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rating-opt";
    if (currentRatings[videoPath] === i) btn.classList.add("active");
    btn.textContent = i;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setRating(videoPath, i);
      picker.remove();
      activePicker = null;
    });
    picker.appendChild(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "rating-opt rating-opt-clear";
  clearBtn.textContent = "×";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setRating(videoPath, null);
    picker.remove();
    activePicker = null;
  });
  picker.appendChild(clearBtn);

  badge.appendChild(picker);
  activePicker = picker;

  setTimeout(() => {
    document.addEventListener(
      "click",
      () => {
        if (activePicker) {
          activePicker.remove();
          activePicker = null;
        }
      },
      { once: true }
    );
  }, 0);
}

async function setRating(videoPath, rating) {
  const res = await fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: videoPath, rating })
  });
  if (!res.ok) return;
  if (rating === null) {
    delete currentRatings[videoPath];
  } else {
    currentRatings[videoPath] = rating;
  }
  render();
  renderPlayerRating();
}

function renderPlayerRating() {
  const container = document.querySelector("#playerRating");
  if (!currentVideo) {
    container.replaceChildren();
    return;
  }

  const label = document.createElement("span");
  label.className = "player-rating-label";
  label.textContent = "Nota:";

  const buttons = [];
  for (let i = 0; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rating-opt${currentRatings[currentVideo.path] === i ? " active" : ""}`;
    btn.textContent = i;
    btn.addEventListener("click", () => setRating(currentVideo.path, i));
    buttons.push(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "rating-opt rating-opt-clear";
  clearBtn.textContent = "×";
  clearBtn.addEventListener("click", () => setRating(currentVideo.path, null));

  container.replaceChildren(label, ...buttons, clearBtn);
}

function playVideo(video) {
  currentVideo = video;
  nowPlayingTitle.textContent = `Carregando ${video.name}`;
  player.src = video.streamUrl;
  player.load();
  player
    .play()
    .then(() => {
      nowPlayingTitle.textContent = video.name;
    })
    .catch(() => {
      nowPlayingTitle.textContent = `${video.name} pronto. Toque no play do player.`;
    });
  renderPlayerRating();
  player.scrollIntoView({ behavior: "smooth", block: "start" });
}

player.addEventListener("error", () => {
  const messages = {
    1: "Reproducao cancelada.",
    2: "Falha de rede ao carregar o video.",
    3: "O navegador nao conseguiu decodificar este video.",
    4: "Formato ou codec nao suportado pelo navegador."
  };
  nowPlayingTitle.textContent = messages[player.error?.code] || "Nao foi possivel carregar o video.";
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

searchInput.addEventListener("input", render);

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

window.addEventListener("popstate", (event) => {
  loadLibrary(event.state?.path || "");
});

loadLibrary(currentPath).catch((error) => {
  videosContainer.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
