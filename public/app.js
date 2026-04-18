const player = document.querySelector("#player");
const nowPlayingTitle = document.querySelector("#nowPlayingTitle");
const foldersContainer = document.querySelector("#folders");
const videosContainer = document.querySelector("#videos");
const breadcrumbsContainer = document.querySelector("#breadcrumbs");
const searchInput = document.querySelector("#searchInput");
const logoutButton = document.querySelector("#logoutButton");

let currentData = null;
let currentPath = new URLSearchParams(window.location.search).get("path") || "";

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

function updateUrl(path) {
  const url = new URL(window.location.href);
  if (path) url.searchParams.set("path", path);
  else url.searchParams.delete("path");
  window.history.pushState({ path }, "", url);
}

async function loadLibrary(path = "") {
  const response = await fetch(`/api/library?path=${encodeURIComponent(path)}`);
  if (response.status === 401) {
    window.location.href = "/login.html";
    return;
  }
  if (!response.ok) throw new Error("Nao foi possivel carregar a biblioteca.");

  currentData = await response.json();
  currentPath = currentData.path;
  searchInput.value = "";
  render();
}

function render() {
  if (!currentData) return;
  const query = searchInput.value.trim().toLowerCase();

  renderBreadcrumbs(currentData.breadcrumbs);
  renderFolders(currentData.folders.filter((folder) => folder.name.toLowerCase().includes(query)));
  renderVideos(
    currentData.videos.filter((video) =>
      `${video.name} ${video.filename}`.toLowerCase().includes(query)
    )
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
      button.innerHTML = `<span class="folder-icon">/</span><span>${escapeHtml(folder.name)}</span>`;
      button.addEventListener("click", () => {
        updateUrl(folder.path);
        loadLibrary(folder.path);
      });
      return button;
    })
  );
}

function renderVideos(videos) {
  if (!videos.length) {
    videosContainer.innerHTML = '<p class="empty-state">Nenhum video encontrado.</p>';
    return;
  }

  videosContainer.replaceChildren(
    ...videos.map((video) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "video-card";
      button.innerHTML = `
        <span class="video-thumb"><span>play</span></span>
        <span class="video-title">${escapeHtml(video.name)}</span>
        <span class="video-meta">${formatBytes(video.size)}</span>
      `;
      button.addEventListener("click", () => playVideo(video));
      return button;
    })
  );
}

function playVideo(video) {
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
