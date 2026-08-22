const ROOT = document.querySelector("#elections-app");

const NAV_LABELS = {
  dashboard: "Dashboard",
  campaigns: "Operações",
  bases: "Preparação",
  portal: "Portal Postal",
  returns: "Retorno do Portal",
  production: "Produção",
};

const VIEW_STAGE = {
  dashboard: 0,
  campaigns: 0,
  bases: 1,
  portal: 3,
  returns: 4,
  production: 5,
};

const STAGES = [
  [1, "Receber base", "violet"],
  [2, "Higienizar", "violet"],
  [3, "Exportar Portal", "violet"],
  [4, "Retorno Portal", "orange"],
  [5, "Preparar documentos", "orange"],
  [6, "Impressão", "orange"],
  [7, "Volumes / acompanhamento", "green"],
];

function numberFromText(text) {
  const digits = String(text || "").replace(/\D/g, "");
  return Number(digits || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function activeView() {
  return document.querySelector(".app-nav button.active")?.dataset.view || "dashboard";
}

function decorateAuth() {
  const auth = ROOT?.querySelector(".elections-auth");
  if (!auth) return;
  const pill = auth.querySelector(".brand-pill");
  const title = auth.querySelector(".elections-auth-copy h1");
  const copy = auth.querySelector(".elections-auth-copy p");
  if (pill) pill.textContent = "AGF OPERAÇÕES POSTAIS";
  if (title) title.textContent = "Da base de endereços à produção postal.";
  if (copy) copy.textContent = "Bases, Portal Postal, documentos, etiquetas, volumes e acompanhamento operacional em um único fluxo.";
}

function decorateBrandAndNav() {
  const brand = ROOT?.querySelector(".app-brand");
  if (brand) {
    const strong = brand.querySelector("strong");
    const small = brand.querySelector("small");
    if (strong) strong.textContent = "Operações Postais";
    if (small) small.textContent = "Painel da agência";
  }

  ROOT?.querySelectorAll(".app-nav button[data-view]").forEach((button) => {
    const view = button.dataset.view;
    const label = NAV_LABELS[view];
    if (!label) return;
    button.textContent = label;
    button.classList.toggle("nav-prep", ["bases", "portal"].includes(view));
    button.classList.toggle("nav-prod", ["returns", "production"].includes(view));
  });
}

function processMarkup(view) {
  const active = VIEW_STAGE[view] || 0;
  return `<section class="approved-process" aria-label="Etapas da operação">
    <div class="approved-process-head">
      <div><strong>PASSO A PASSO DA OPERAÇÃO</strong><span>O volume avança por etapas e as baixas podem ser parciais.</span></div>
      <div class="approved-process-legend"><i class="done"></i> concluído <i class="current"></i> atual <i class="pending"></i> pendente</div>
    </div>
    <div class="approved-steps">
      ${STAGES.map(([number, label, color]) => {
        const state = active === 0 ? "neutral" : number < active ? "done" : number === active ? "current" : "pending";
        return `<div class="approved-step ${state} ${color}"><b>${number}</b><span>${label}</span></div>`;
      }).join("")}
    </div>
  </section>`;
}

function addProcess() {
  const page = ROOT?.querySelector(".page");
  const head = page?.querySelector(":scope > .page-head");
  if (!page || !head || page.querySelector(":scope > .approved-process")) return;
  const view = activeView();
  if (view === "campaigns") return;
  head.insertAdjacentHTML("afterend", processMarkup(view));
}

function metricValueByLabel(label) {
  const card = [...(ROOT?.querySelectorAll(".metric-card") || [])].find((item) => item.querySelector("span")?.textContent.trim() === label);
  return numberFromText(card?.querySelector("strong")?.textContent);
}

function addServiceSummary() {
  const page = ROOT?.querySelector(".page");
  const metrics = page?.querySelector(".grid.metrics");
  if (!page || !metrics || page.querySelector(".service-summary")) return;
  if (activeView() !== "dashboard") return;

  const pac = metricValueByLabel("PAC emitidos");
  const sedex = metricValueByLabel("SEDEX emitidos");
  const total = pac + sedex;
  metrics.insertAdjacentHTML("beforebegin", `<section class="service-summary">
    <article class="service-card pac"><div><span>PAC</span><small>Objetos emitidos</small></div><strong>${formatNumber(pac)}</strong></article>
    <article class="service-card sedex"><div><span>SEDEX</span><small>Objetos emitidos</small></div><strong>${formatNumber(sedex)}</strong></article>
    <article class="service-card total"><div><span>TOTAL</span><small>PAC + SEDEX emitidos</small></div><strong>${formatNumber(total)}</strong></article>
  </section>`);
}

function genericOperationLanguage() {
  const view = activeView();
  if (view !== "campaigns") return;
  const head = ROOT?.querySelector(".page-head");
  const title = head?.querySelector("h1");
  const description = head?.querySelector("p:not(.eyebrow)");
  const action = head?.querySelector("#new-campaign");
  if (title) title.textContent = "Operações";
  if (description) description.textContent = "Cada operação mantém seus dados, usuários, lotes e histórico separados.";
  if (action) action.textContent = "Nova operação";
  ROOT?.querySelectorAll("[data-open-campaign]").forEach((button) => { button.textContent = "Abrir operação"; });
}

const NEXT_VIEW = {
  bases: ["portal", "Seguir para Portal Postal"],
  portal: ["returns", "Seguir para Retorno do Portal"],
  returns: ["production", "Seguir para Produção"],
};

function addNextAction() {
  const page = ROOT?.querySelector(".page");
  if (!page || page.querySelector(".approved-next")) return;
  const view = activeView();
  const next = NEXT_VIEW[view];
  if (!next) return;
  page.insertAdjacentHTML("beforeend", `<div class="approved-next"><div><strong>Etapa concluída?</strong><span>Avance mantendo o mesmo contexto da operação selecionada.</span></div><button class="primary" type="button" data-approved-next="${next[0]}">${next[1]} →</button></div>`);
}

function keepChipsResponsive() {
  ROOT?.querySelectorAll(".status").forEach((chip) => {
    chip.title = chip.textContent.trim();
  });
}

function decorate() {
  decorateAuth();
  decorateBrandAndNav();
  genericOperationLanguage();
  addProcess();
  addServiceSummary();
  addNextAction();
  keepChipsResponsive();
}

ROOT?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-approved-next]");
  if (!button) return;
  ROOT.querySelector(`.app-nav button[data-view="${CSS.escape(button.dataset.approvedNext)}"]`)?.click();
});

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate();
  });
});

if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorate();
