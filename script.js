const prompts = [
  "I have cardboard, yarn, buttons, and 45 minutes. I want something cozy for a teen bedroom.",
  "Make a low-cost birthday gift using paper scraps, markers, glue, and ribbon.",
  "I want a nature-inspired weekend craft for adults using jars, twine, and dried flowers.",
  "Create something colorful for a desk using felt, beads, and recycled packaging.",
];

const knownMaterials = [
  "paper scraps",
  "fabric scraps",
  "recycled packaging",
  "dried flowers",
  "cardboard",
  "paper",
  "yarn",
  "buttons",
  "button",
  "markers",
  "marker",
  "glue",
  "ribbon",
  "string",
  "twine",
  "jars",
  "jar",
  "felt",
  "beads",
  "bead",
  "fabric",
  "paint",
  "clay",
  "sticks",
  "stick",
  "leaves",
  "leaf",
  "flowers",
  "flower",
  "photos",
  "photo",
  "newspaper",
  "magazines",
  "magazine",
  "tape",
  "wire",
  "boxes",
  "box",
  "tube",
  "pom poms",
  "pipe cleaners",
  "popsicle sticks",
];

const promptInput = document.querySelector("#promptInput");
const timeInput = document.querySelector("#timeInput");
const difficultyInput = document.querySelector("#difficultyInput");
const styleInput = document.querySelector("#styleInput");
const generateButton = document.querySelector("#generateButton");
const surpriseButton = document.querySelector("#surpriseButton");
const emptyState = document.querySelector("#emptyState");
const ideaCard = document.querySelector("#ideaCard");
const saveIdeaButton = document.querySelector("#saveIdeaButton");
const sourceSummary = document.querySelector("#sourceSummary");
const sourceLink = document.querySelector("#sourceLink");
const toast = document.querySelector("#toast");
const header = document.querySelector(".site-header");
const menuToggle = document.querySelector(".menu-toggle");
const accountLabel = document.querySelector("#accountLabel");
const loginButton = document.querySelector("#loginButton");
const signupButton = document.querySelector("#signupButton");
const logoutButton = document.querySelector("#logoutButton");
const savedAuthButton = document.querySelector("#savedAuthButton");
const savedEmpty = document.querySelector("#savedEmpty");
const savedGrid = document.querySelector("#savedGrid");

const authModal = document.querySelector("#authModal");
const authTitle = document.querySelector("#authTitle");
const authSubtitle = document.querySelector("#authSubtitle");
const authSubmit = document.querySelector("#authSubmit");
const authForm = document.querySelector("#authForm");
const loginTab = document.querySelector("#loginTab");
const signupTab = document.querySelector("#signupTab");
const nameField = document.querySelector("#nameField");
const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const nameInput = document.querySelector("#nameInput");

let authMode = "login";
let activeIdea = null;
let currentUser = null;
let savedIdeas = [];
let toastTimer = null;

async function renderIdea() {
  const text = promptInput.value.trim();

  if (!text) {
    showToast("Add the materials you want the idea to use first.");
    promptInput.focus();
    return;
  }

  const materials = extractMaterials(text);

  if (materials.length === 0) {
    showToast("Please name at least one material, like cardboard, yarn, jars, paper, or ribbon.");
    promptInput.focus();
    return;
  }

  const time = timeInput.value;
  const difficulty = difficultyInput.value;
  const style = styleInput.value;

  activeIdea = buildPromptBoundIdea({ text, materials, time, difficulty, style });

  document.querySelector("#ideaCategory").textContent = activeIdea.category;
  document.querySelector("#generatedTitle").textContent = activeIdea.title;
  document.querySelector("#generatedIntro").textContent = activeIdea.intro;
  document.querySelector("#generatedTime").textContent = time;
  document.querySelector("#generatedDifficulty").textContent = difficulty;
  document.querySelector("#generatedStyle").textContent = style;
  document.querySelector("#finishingTouch").textContent = activeIdea.finish;
  fillList("#suppliesList", activeIdea.supplies);
  fillList("#stepsList", activeIdea.steps);
  renderSourceLoading(activeIdea);

  emptyState.classList.add("hidden");
  ideaCard.classList.remove("hidden");
  updateSaveButtonState();

  const source = await fetchRelatedSource(activeIdea);
  renderSource(source);
}

function extractMaterials(text) {
  const normalized = text.toLowerCase();
  const found = [];
  const materialClause = normalized.match(
    /(?:i have|using|with|materials?|supplies?|made from|made of)\s+([^.!?]+)/i,
  );

  if (materialClause) {
    materialClause[1]
      .replace(/\b\d+\s*(minutes?|mins?|hours?|hrs?|days?)\b/g, "")
      .replace(/\b(?:and|plus)\b/g, ",")
      .split(/[,/]+/)
      .map(cleanMaterialName)
      .filter(isLikelyMaterial)
      .forEach((material) => addMaterial(found, material));
  }

  knownMaterials
    .filter((material) => normalized.includes(material))
    .forEach((material) => addMaterial(found, material));

  return [...new Set(found.map(cleanMaterialName).filter(isLikelyMaterial))].slice(0, 8);
}

function addMaterial(materials, material) {
  const cleaned = cleanMaterialName(material);
  const existingIndex = materials.findIndex((item) => item.includes(cleaned) || cleaned.includes(item));

  if (existingIndex === -1) {
    materials.push(cleaned);
    return;
  }

  if (cleaned.length > materials[existingIndex].length) {
    materials[existingIndex] = cleaned;
  }
}

function cleanMaterialName(material) {
  return material
    .replace(/\b(?:a|an|the|some|clean|old|small|big|few|little|lots of|want|make|create|something)\b/g, "")
    .replace(/\b(?:for|to|in|on|at|by)\b.*$/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyMaterial(material) {
  const blockedWords = ["", "i", "and", "or", "style", "vibe", "occasion", "teen bedroom", "adult friendly decor project"];
  return material.length > 2 && material.length < 32 && !blockedWords.includes(material);
}

function buildPromptBoundIdea({ text, materials, time, difficulty, style }) {
  const normalized = text.toLowerCase();
  const primary = materials[0];
  const secondary = materials[1] || materials[0];
  const accent = materials[2] || secondary;
  const mood = inferPromptMood(normalized, style);
  const useCase = inferUseCase(normalized);
  const hasAdhesive = materials.some((item) => item.includes("glue") || item.includes("tape"));
  const hasFlexible = materials.some((item) =>
    ["yarn", "twine", "ribbon", "string", "wire", "pipe cleaners"].some((word) => item.includes(word)),
  );
  const category = getPromptCategory(normalized, materials);
  const concept = getCreativeConcept({ category, primary, secondary, accent, mood, useCase, materials });
  const title = getPromptTitle({ concept, primary, style, mood });
  const joinMethod = hasAdhesive
    ? `Use ${materials.find((item) => item.includes("glue") || item.includes("tape"))} to secure the main form, then leave a few edges lifted for dimension.`
    : hasFlexible
      ? `Use ${materials.find((item) => ["yarn", "twine", "ribbon", "string", "wire"].some((word) => item.includes(word)))} as both structure and decoration: wrap, knot, fringe, or suspend part of the piece.`
      : "Use folding, layering, slotting, weaving, or balancing so the form feels designed rather than simply assembled.";

  return {
    category,
    title,
    intro: `A ${mood} ${style.toLowerCase()} idea anchored in your prompt materials: ${formatList(materials)}. It adds shape, story, and a clear purpose without drifting away from what you described.`,
    supplies: materials,
    time,
    difficulty,
    style,
    prompt: text,
    searchQuery: buildSearchQuery({ text, materials, category }),
    steps: [
      `Turn the prompt into a concept: make a ${concept.toLowerCase()} for ${useCase}.`,
      `Use ${primary} as the main shape, base, or repeated motif so the piece has one clear visual anchor.`,
      `Layer ${secondary} to create contrast, movement, texture, or a useful second surface.`,
      `${joinMethod}`,
      `Feature ${accent} as the signature detail: cluster it, outline with it, turn it into tabs, charms, labels, or a small focal pattern.`,
      `Add one optional household basic only if needed, such as scissors, a pencil mark, or a tiny knot, while keeping the visible design based on the prompt.`,
    ],
    finish: `Give it a small story, label, or display spot connected to ${useCase}; that little context is what makes the idea feel custom rather than generic.`,
  };
}

function buildSearchQuery({ text, materials, category }) {
  const intentWords = ["gift", "birthday", "desk", "room", "decor", "organizer", "teen", "adult"].filter((word) =>
    text.toLowerCase().includes(word),
  );
  return [...materials, ...intentWords, category, "handcraft tutorial"].join(" ");
}

async function fetchRelatedSource(idea) {
  const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(idea.searchQuery)}`;
  const fallbackSource = {
    status: "browser-fallback",
    title: "Search related handcraft tutorials",
    url: fallbackUrl,
    summary: "Open a focused web search based on the materials and request you typed.",
  };

  if (location.protocol === "file:") {
    return fallbackSource;
  }

  try {
    const response = await fetch("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: idea.prompt,
        materials: idea.supplies,
        category: idea.category,
        query: idea.searchQuery,
      }),
    });

    if (!response.ok) throw new Error("Source API unavailable");
    const source = await response.json();

    if (!isSafeWebUrl(source.url)) {
      throw new Error("Source API returned an invalid URL");
    }

    return source;
  } catch (error) {
    return {
      ...fallbackSource,
      status: "network-error",
      summary: "The related-link service is temporarily unavailable. This opens a focused search instead.",
    };
  }
}

function renderSourceLoading(idea) {
  sourceSummary.textContent = `Looking for a related link for ${formatList(idea.supplies)}.`;
  sourceLink.textContent = "Finding link...";
  sourceLink.href = `https://www.google.com/search?q=${encodeURIComponent(idea.searchQuery)}`;
}

function renderSource(source) {
  const statusMessages = {
    live: source.summary || "A related handcraft source found from your prompt.",
    "missing-key": source.summary || "Live related links need the Brave Search secret. This opens a focused search instead.",
    error: source.summary || "Live related links are temporarily unavailable. This opens a focused search instead.",
    "network-error": source.summary || "The related-link service is temporarily unavailable. This opens a focused search instead.",
    "browser-fallback": source.summary || "Open a focused web search based on the materials and request you typed.",
  };

  sourceSummary.textContent = statusMessages[source.status] || "Related to the materials and request in your prompt.";
  sourceLink.textContent = source.title || "Open related link";
  sourceLink.href = source.url;
}

function isSafeWebUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function getPromptCategory(text, materials) {
  if (text.includes("gift") || text.includes("birthday")) return "Gift craft";
  if (text.includes("desk") || materials.some((item) => ["box", "tube", "packaging"].some((word) => item.includes(word)))) {
    return "Organizer";
  }
  if (text.includes("room") || text.includes("decor") || materials.some((item) => item.includes("jar"))) return "Home decor";
  return "Custom craft";
}

function inferPromptMood(text, style) {
  if (text.includes("cozy") || text.includes("bedroom")) return "cozy";
  if (text.includes("birthday") || text.includes("gift")) return "keepsake-ready";
  if (text.includes("nature") || text.includes("flowers") || text.includes("leaf")) return "nature-inspired";
  if (text.includes("colorful") || style.includes("Playful")) return "playful";
  if (style.includes("Minimal")) return "quietly polished";
  return "creative";
}

function inferUseCase(text) {
  if (text.includes("birthday")) return "a birthday surprise";
  if (text.includes("gift")) return "a personal handmade gift";
  if (text.includes("desk")) return "a desk that needs a useful focal point";
  if (text.includes("teen")) return "a teen bedroom or locker corner";
  if (text.includes("room") || text.includes("decor")) return "a room that needs a handmade accent";
  if (text.includes("holiday")) return "a seasonal display";
  if (text.includes("adult")) return "a calm grown-up craft session";
  return "the situation described in your prompt";
}

function getCreativeConcept({ category, primary, secondary, accent, mood, useCase, materials }) {
  const hasContainer = materials.some((item) => ["jar", "box", "tube", "packaging"].some((word) => item.includes(word)));
  const hasSoftMaterial = materials.some((item) => ["yarn", "felt", "fabric", "ribbon", "twine"].some((word) => item.includes(word)));
  const hasPaperMaterial = materials.some((item) => ["paper", "cardboard", "newspaper", "magazine"].some((word) => item.includes(word)));

  if (category === "Gift craft") return `${mood} ${primary} memory charm`;
  if (category === "Organizer" && hasContainer) return `${primary} catch-all station with ${secondary} dividers`;
  if (category === "Organizer") return `${primary} pocket organizer with ${accent} markers`;
  if (category === "Home decor" && hasSoftMaterial) return `textured ${primary} wall accent for ${useCase}`;
  if (category === "Home decor") return `${primary} mini vignette with layered ${secondary}`;
  if (hasPaperMaterial && hasSoftMaterial) return `${primary} story panel with wrapped ${secondary}`;
  return `${primary} art object with a ${accent} focal detail`;
}

function getPromptTitle({ concept, primary, style, mood }) {
  const prefix = style.includes("Playful")
    ? "Colorful"
    : style.includes("Minimal")
      ? "Simple"
      : style.includes("Gift")
        ? "Giftable"
        : titleCase(mood);
  const cleanedConcept = concept.startsWith(mood) ? concept.slice(mood.length).trim() : concept;

  return `${prefix} ${titleCase(cleanedConcept.replace(primary, titleCase(primary)))}`;
}

function formatList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function titleCase(text) {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fillList(selector, items) {
  const list = document.querySelector(selector);
  list.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong. Please try again.");
  }

  return payload;
}

async function loadSession() {
  if (location.protocol === "file:") {
    renderAuthState();
    renderSavedIdeas();
    return;
  }

  try {
    const session = await apiRequest("/api/session");
    currentUser = session.user;
    savedIdeas = Array.isArray(session.ideas) ? session.ideas : [];
  } catch (error) {
    currentUser = null;
    savedIdeas = [];
  }

  renderAuthState();
  renderSavedIdeas();
  updateSaveButtonState();
}

function renderAuthState() {
  const isSignedIn = Boolean(currentUser);

  accountLabel.classList.toggle("hidden", !isSignedIn);
  logoutButton.classList.toggle("hidden", !isSignedIn);
  loginButton.classList.toggle("hidden", isSignedIn);
  signupButton.classList.toggle("hidden", isSignedIn);
  savedAuthButton.classList.toggle("hidden", isSignedIn);

  if (isSignedIn) {
    accountLabel.textContent = currentUser.name || currentUser.email;
  }
}

function renderSavedIdeas() {
  savedGrid.innerHTML = "";

  if (!currentUser) {
    savedEmpty.textContent = "Log in or create a free account to keep generated ideas available across visits on this server.";
    savedEmpty.classList.remove("hidden");
    return;
  }

  if (savedIdeas.length === 0) {
    savedEmpty.textContent = "Your saved shelf is empty. Generate an idea, then tap the heart to keep it here.";
    savedEmpty.classList.remove("hidden");
    return;
  }

  savedEmpty.classList.add("hidden");
  savedIdeas.forEach((idea) => {
    const card = document.createElement("article");
    card.className = "saved-card";

    const savedDate = idea.savedAt
      ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(idea.savedAt))
      : "Saved";
    const supplies = Array.isArray(idea.supplies) ? idea.supplies.slice(0, 4).join(", ") : "";

    card.innerHTML = `
      <div class="saved-card-topline">
        <span>${escapeHtml(idea.category || "Craft idea")}</span>
        <time>${escapeHtml(savedDate)}</time>
      </div>
      <h3>${escapeHtml(idea.title || "Untitled craft idea")}</h3>
      <p>${escapeHtml(idea.intro || "A saved craft idea from your private shelf.")}</p>
      <small>${escapeHtml(supplies)}</small>
    `;
    savedGrid.appendChild(card);
  });
}

function updateSaveButtonState() {
  const isSaved = activeIdea && savedIdeas.some((idea) => idea.title === activeIdea.title);
  saveIdeaButton.classList.toggle("saved", Boolean(isSaved));
  saveIdeaButton.textContent = isSaved ? "♥" : "♡";
  saveIdeaButton.setAttribute("aria-label", isSaved ? "Idea saved" : "Save idea");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openAuth(mode) {
  authMode = mode;
  const isSignup = mode === "signup";

  loginTab.classList.toggle("active", !isSignup);
  signupTab.classList.toggle("active", isSignup);
  nameField.classList.toggle("hidden", !isSignup);
  nameInput.required = isSignup;
  authTitle.textContent = isSignup ? "Create your craft space" : "Welcome back";
  authSubtitle.textContent = isSignup
    ? "Save ideas, return to favorite projects, and keep your creations private."
    : "Save your favorite ideas and revisit them later.";
  authSubmit.textContent = isSignup ? "Sign up" : "Log in";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";

  authModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  window.setTimeout(() => emailInput.focus(), 80);
}

function closeAuth() {
  authModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-auth-open]").forEach((button) => {
  button.addEventListener("click", () => openAuth(button.dataset.authOpen));
});

document.querySelectorAll("[data-auth-close]").forEach((button) => {
  button.addEventListener("click", closeAuth);
});

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => openAuth(button.dataset.authTab));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    authSubmit.disabled = true;
    authSubmit.textContent = authMode === "signup" ? "Creating account..." : "Logging in...";
    const payload = await apiRequest(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({
        email: emailInput.value,
        password: passwordInput.value,
        name: nameInput.value,
      }),
    });

    const signedInUser = payload.user;
    currentUser = signedInUser;
    await loadSession();
    closeAuth();
    showToast(authMode === "signup" ? `Welcome, ${signedInUser.name}.` : "You are logged in.");
    authForm.reset();
  } catch (error) {
    showToast(error.message);
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === "signup" ? "Sign up" : "Log in";
  }
});

generateButton.addEventListener("click", renderIdea);

surpriseButton.addEventListener("click", () => {
  const nextPrompt = prompts[Math.floor(Math.random() * prompts.length)];
  promptInput.value = nextPrompt;
  renderIdea();
});

saveIdeaButton.addEventListener("click", async () => {
  if (!activeIdea) return;

  if (!currentUser) {
    openAuth("signup");
    showToast("Create an account or log in to save ideas privately.");
    return;
  }

  try {
    saveIdeaButton.disabled = true;
    const payload = await apiRequest("/api/ideas", {
      method: "POST",
      body: JSON.stringify({ idea: activeIdea }),
    });
    savedIdeas = payload.ideas || [];
    renderSavedIdeas();
    updateSaveButtonState();
    showToast("Idea saved to your private shelf.");
  } catch (error) {
    showToast(error.message);
  } finally {
    saveIdeaButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    // The local UI can still clear when the session has already expired.
  }

  currentUser = null;
  savedIdeas = [];
  renderAuthState();
  renderSavedIdeas();
  updateSaveButtonState();
  showToast("You are logged out.");
});

menuToggle.addEventListener("click", () => {
  const isOpen = header.classList.toggle("menu-open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

document.querySelectorAll(".site-header nav a").forEach((link) => {
  link.addEventListener("click", () => {
    header.classList.remove("menu-open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAuth();
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") renderIdea();
});

loadSession();
