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
const socialAuthButtons = document.querySelectorAll("[data-social-auth]");

let authMode = "login";
let activeIdea = null;
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
  saveIdeaButton.classList.remove("saved");
  saveIdeaButton.textContent = "♡";

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
  const hasAdhesive = materials.some((item) => item.includes("glue") || item.includes("tape"));
  const hasFlexible = materials.some((item) =>
    ["yarn", "twine", "ribbon", "string", "wire", "pipe cleaners"].some((word) => item.includes(word)),
  );
  const category = getPromptCategory(normalized, materials);
  const title = getPromptTitle({ category, primary, style });
  const joinMethod = hasAdhesive
    ? `Use ${materials.find((item) => item.includes("glue") || item.includes("tape"))} only where pieces need to stay fixed.`
    : hasFlexible
      ? `Use ${materials.find((item) => ["yarn", "twine", "ribbon", "string", "wire"].some((word) => item.includes(word)))} to wrap, tie, or bundle the piece without adding extra supplies.`
      : "Use folding, layering, tucking, balancing, or arranging so you do not need extra materials.";

  return {
    category,
    title,
    intro: `A ${style.toLowerCase()} project built only from the materials in your prompt: ${formatList(materials)}.`,
    supplies: materials,
    time,
    difficulty,
    style,
    prompt: text,
    searchQuery: buildSearchQuery({ text, materials, category }),
    steps: [
      `Set out only these prompt materials: ${formatList(materials)}.`,
      `Choose ${primary} as the main structure or visual base for the project.`,
      `Add ${secondary} to create contrast, texture, or a useful second layer.`,
      `${joinMethod}`,
      `Use ${accent} as the most visible detail so the design feels intentional.`,
      `Pause and remove anything that was not named in your prompt before calling the project finished.`,
    ],
    finish: `Give the finished piece a name based on ${primary}, then save this idea knowing the supply list stayed locked to your prompt.`,
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

  if (location.protocol === "file:") {
    return {
      title: "Search related handcraft tutorials",
      url: fallbackUrl,
      summary: "Open a focused web search based on the materials and request you typed.",
    };
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
    return await response.json();
  } catch (error) {
    return {
      title: "Search related handcraft tutorials",
      url: fallbackUrl,
      summary: "Open a focused web search based on the materials and request you typed.",
    };
  }
}

function renderSourceLoading(idea) {
  sourceSummary.textContent = `Looking for a related link for ${formatList(idea.supplies)}.`;
  sourceLink.textContent = "Finding link...";
  sourceLink.href = `https://www.google.com/search?q=${encodeURIComponent(idea.searchQuery)}`;
}

function renderSource(source) {
  sourceSummary.textContent = source.summary || "Related to the materials and request in your prompt.";
  sourceLink.textContent = source.title || "Open related link";
  sourceLink.href = source.url;
}

function getPromptCategory(text, materials) {
  if (text.includes("gift") || text.includes("birthday")) return "Gift craft";
  if (text.includes("desk") || materials.some((item) => ["box", "tube", "packaging"].some((word) => item.includes(word)))) {
    return "Organizer";
  }
  if (text.includes("room") || text.includes("decor") || materials.some((item) => item.includes("jar"))) return "Home decor";
  return "Custom craft";
}

function getPromptTitle({ category, primary, style }) {
  const prefix = style.includes("Playful")
    ? "Colorful"
    : style.includes("Minimal")
      ? "Simple"
      : style.includes("Gift")
        ? "Giftable"
        : "Creative";

  if (category === "Gift craft") return `${prefix} ${titleCase(primary)} Keepsake`;
  if (category === "Organizer") return `${prefix} ${titleCase(primary)} Organizer`;
  if (category === "Home decor") return `${prefix} ${titleCase(primary)} Accent`;
  return `${prefix} ${titleCase(primary)} Project`;
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

function openAuth(mode) {
  authMode = mode;
  const isSignup = mode === "signup";

  loginTab.classList.toggle("active", !isSignup);
  signupTab.classList.toggle("active", isSignup);
  nameField.classList.toggle("hidden", !isSignup);
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

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const accountName = nameInput.value.trim() || emailInput.value.split("@")[0] || "maker";
  localStorage.setItem("craftlyUser", JSON.stringify({ email: emailInput.value, name: accountName }));
  closeAuth();
  showToast(authMode === "signup" ? `Welcome, ${accountName}.` : "You are logged in for this preview.");
  authForm.reset();
});

socialAuthButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const provider = button.dataset.socialAuth;
    localStorage.setItem(
      "craftlyUser",
      JSON.stringify({
        email: `${provider.toLowerCase()}-preview@craftly.local`,
        name: `${provider} user`,
        provider,
      }),
    );
    closeAuth();
    showToast(`Signed in with ${provider} for this preview.`);
  });
});

generateButton.addEventListener("click", renderIdea);

surpriseButton.addEventListener("click", () => {
  const nextPrompt = prompts[Math.floor(Math.random() * prompts.length)];
  promptInput.value = nextPrompt;
  renderIdea();
});

saveIdeaButton.addEventListener("click", () => {
  if (!activeIdea) return;

  const savedIdeas = JSON.parse(localStorage.getItem("craftlySavedIdeas") || "[]");
  savedIdeas.unshift({ ...activeIdea, savedAt: new Date().toISOString() });
  localStorage.setItem("craftlySavedIdeas", JSON.stringify(savedIdeas.slice(0, 12)));
  saveIdeaButton.classList.add("saved");
  saveIdeaButton.textContent = "♥";
  showToast("Idea saved on this device.");
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
