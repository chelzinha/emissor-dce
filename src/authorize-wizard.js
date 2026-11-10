// Autorização guiada da DC-e para o detentor do e-CNPJ (rota /autorizar).
// A AGF prepara as remessas na conta do emitente; aqui o cliente só confere, informa o certificado e autoriza.
import "./authorize-wizard.css";
import { getUser, login, logout, requestPasswordRecovery } from "@netlify/identity";
import { api, dataAction, fileToBase64 } from "./api.js";
import { cnpjDigits, digits } from "./validation.js";
import { buildLots, estimateSeconds, PauseError, PER_DOC_ESTIMATE_MS, pendingBatchesFor, runAuthorization, summarizeReady } from "./authorize-engine.js";

const CFG = Object.freeze({
  agfName: "AGF José Bonifácio",
  agfWhatsApp: "5585920023386",
  environment: new URLSearchParams(location.search).get("ambiente") === "homologacao" ? "2" : "1",
});
const STEPS = [["inicio", "Início"], ["conferir", "Conferir"], ["certificado", "Certificado"], ["confirmar", "Confirmar"], ["autorizar", "Autorizar"]];

const root = document.querySelector("#wizard");
const S = {
  user: null, step: "inicio", company: null, remittances: [], batches: [], imports: [], summary: null, overall: null, pending: [], lots: [], lot: null,
  cert: { base64: "", name: "", info: null }, passphrase: "", accepted: { eligibility: false, production: false },
  search: "", progress: null, result: null, pause: null, running: false,
};

// ---------- helpers ----------
const h = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const int = (value) => Number(value || 0).toLocaleString("pt-BR");
const cnpjMask = (value) => cnpjDigits(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const dateBr = (value) => (value ? new Date(value).toLocaleDateString("pt-BR") : "");
const whatsLink = (text) => `https://wa.me/${CFG.agfWhatsApp}?text=${encodeURIComponent(text)}`;
const lotsMode = () => S.lots.length > 1;
const multiRound = () => new Set(S.lots.map((lot) => lot.round)).size > 1;
const lotName = (lot) => (lot ? [multiRound() ? `Rodada ${lot.round}` : "", lot.ambito, lot.label].filter(Boolean).join(" · ") : "");
const estimate = (count) => duration(estimateSeconds(count, 0, 0, PER_DOC_ESTIMATE_MS));
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const totalToAuthorize = () => (S.summary?.total || 0) + S.pending.reduce((sum, batch) => sum + Number(batch.TOTAL || 0) - Number(batch.AUTHORIZED || 0) - Number(batch.REJECTED || 0), 0);

function duration(seconds) {
  if (seconds < 60) return "menos de 1 minuto";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `cerca de ${minutes} minuto${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return `cerca de ${hours}h${rest ? ` ${rest}min` : ""}`;
}

function toast(message, type = "info") {
  const el = document.querySelector("#wizard-toast");
  el.textContent = message; el.className = `wz-toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = "wz-toast"; }, 5000);
}

function busy(label) {
  const el = document.createElement("div");
  el.className = "wz-busy"; el.innerHTML = `<div class="wz-spinner"></div><strong>${h(label)}</strong>`;
  document.body.appendChild(el);
  return () => el.remove();
}

const icon = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 12l9-9M16 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v5M12 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// ---------- layout ----------
function frame(content, { stepper = true, wide = false } = {}) {
  const index = STEPS.findIndex(([id]) => id === S.step);
  const banner = CFG.environment === "2" ? '<div class="wz-env">Ambiente de TESTE (homologação): as declarações não têm valor fiscal.</div>' : "";
  root.innerHTML = `${banner}<header class="wz-top"><div class="wz-brand"><small>${h(CFG.agfName)}</small><b>Autorização de DC-e</b></div><div class="wz-top-right">${S.company ? `<span class="wz-top-company" title="${h(S.company.name || S.company.profile?.name || "")}">${h(S.company.name || S.company.profile?.name || "")}</span>` : ""}${S.user ? '<button class="wz-link" id="wz-logout">Sair</button>' : ""}</div></header>
  ${stepper ? `<nav class="wz-steps" aria-label="Etapas">${STEPS.map(([id, label], i) => `<div class="wz-step ${i < index ? "done" : ""} ${i === index ? "current" : ""}" ${i === index ? 'aria-current="step"' : ""}><span>${i < index ? icon.check : i + 1}</span><small>${label}</small></div>`).join("")}</nav>` : ""}
  <main class="wz-main${wide ? " wz-main-wide" : ""}">${content}</main>
  <footer class="wz-foot">Dúvidas? <a href="${whatsLink("Olá! Estou na autorização das DC-e e preciso de ajuda.")}" target="_blank" rel="noopener">Fale com a ${h(CFG.agfName)} pelo WhatsApp</a></footer>`;
  root.querySelector("#wz-logout")?.addEventListener("click", async () => { if (S.running) return; await logout(); location.reload(); });
}

function go(step) { S.step = step; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }

function render() {
  if (!S.user) return renderLogin();
  ({ inicio: renderStart, conferir: renderReview, certificado: renderCertificate, confirmar: renderConfirm, autorizar: renderRun, concluido: renderDone }[S.step] || renderStart)();
}

// ---------- 0. login ----------
function authMessage(error) {
  const text = String(error?.message || "");
  if (/no user found|invalid password|invalid_grant|invalid login/i.test(text)) return "E-mail ou senha incorretos.";
  if (/not confirmed/i.test(text)) return "Confirme o e-mail antes de entrar: abra o link que chegou na sua caixa de entrada.";
  return text || "Não foi possível entrar. Tente de novo.";
}

function renderLogin(message = "") {
  frame(`<section class="wz-login">
    <aside class="wz-login-hero">
      <p class="wz-hero-kicker">${h(CFG.agfName)}</p>
      <h1>Assine as declarações da sua empresa em poucos minutos.</h1>
      <p class="wz-hero-lead">A ${h(CFG.agfName)} prepara as declarações de conteúdo eletrônicas (DC-e). Você só confere e assina com o e-CNPJ.</p>
      <ul class="wz-hero-list">
        <li><span class="c1">${icon.file}</span>Declarações já preparadas pela AGF</li>
        <li><span class="c2">${icon.key}</span>Assinatura com o certificado e-CNPJ A1</li>
        <li><span class="c3">${icon.shield}</span>Certificado usado só nesta página, sem ser salvo</li>
      </ul>
    </aside>
    <div class="wz-login-side">
      <div class="wz-card wz-login-card">
        <p class="wz-eyebrow">Acesso seguro</p>
        <h2 class="wz-login-title">Entrar</h2>
        <p class="wz-lead">Use o e-mail e a senha que a ${h(CFG.agfName)} enviou para você.</p>
        ${message ? `<div class="wz-note ok">${h(message)}</div>` : ""}
        <form id="wz-login" class="wz-form">
          <label>E-mail<input name="email" type="email" autocomplete="username" inputmode="email" required></label>
          <label>Senha<div class="wz-pass"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="wz-link" id="wz-show">Mostrar</button></div></label>
          <button class="wz-primary wz-block" type="submit">Entrar</button>
        </form>
        <div class="wz-login-links"><button class="wz-link" id="wz-forgot">Esqueci minha senha</button></div>
      </div>
    </div>
  </section>`, { stepper: false, wide: true });
  root.querySelector("#wz-show").addEventListener("click", (event) => {
    const input = root.querySelector("[name=password]");
    input.type = input.type === "password" ? "text" : "password";
    event.currentTarget.textContent = input.type === "password" ? "Mostrar" : "Ocultar";
  });
  root.querySelector("#wz-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const stop = busy("Entrando...");
    try { S.user = await login(values.email.trim(), values.password); await loadData(); go("inicio"); }
    catch (error) { toast(authMessage(error), "error"); }
    finally { stop(); }
  });
  root.querySelector("#wz-forgot").addEventListener("click", async () => {
    const email = root.querySelector("[name=email]").value.trim();
    if (!email) return toast("Digite seu e-mail no campo acima e clique de novo.", "error");
    try { await requestPasswordRecovery(email); renderLogin("Enviamos um link para criar uma nova senha. Confira seu e-mail."); }
    catch (error) { toast(error.message, "error"); }
  });
}

async function loadData() {
  const [company, remittances, batches, imports] = await Promise.all([
    dataAction("company.get", {}), dataAction("remittances.list", {}), dataAction("batches.list", {}),
    dataAction("imports.list", {}).catch(() => []),
  ]);
  S.company = company; S.remittances = remittances || []; S.batches = batches || []; S.imports = Array.isArray(imports) ? imports : [];
  S.overall = summarizeReady(S.remittances);
  // Cada arquivo importado é um lote. Com mais de um lote, só o lote atual é autorizado de cada vez.
  const { lots, current } = buildLots(S.remittances, S.imports);
  S.lots = lots; S.lot = current;
  S.summary = lotsMode() && current ? summarizeReady(current.readyRows) : S.overall;
  S.pending = pendingBatchesFor(S.batches, CFG.environment);
}

// ---------- 1. início ----------
function renderStart() {
  if (!S.company) {
    frame(`<section class="wz-card"><div class="wz-empty">${icon.alert}<h1>Ainda não está pronto</h1><p>Esta conta ainda não tem empresa nem declarações cadastradas.</p>${S.user?.email ? `<p class="wz-muted">Conta conectada: <b>${h(S.user.email)}</b></p>` : ""}<p>Confira se entrou com o e-mail que a ${h(CFG.agfName)} enviou. Se estiver certo, avise a ${h(CFG.agfName)}: as declarações ainda estão sendo preparadas.</p><div class="wz-actions center"><button class="wz-ghost" id="wz-switch">Entrar com outro e-mail</button></div></div></section>`);
    root.querySelector("#wz-switch")?.addEventListener("click", async () => { try { await logout(); } catch {} S.user = null; renderLogin(); });
    return;
  }
  const total = totalToAuthorize();
  const name = S.company.name || S.company.profile?.name || "sua empresa";
  if (!total) {
    frame(`<section class="wz-card"><div class="wz-empty ok">${icon.check}<h1>Nada pendente</h1><p>Não há declarações aguardando autorização.${S.overall.authorized ? ` ${int(S.overall.authorized)} já foram autorizadas.` : ""}</p><p>Se você esperava encontrar declarações aqui, fale com a ${h(CFG.agfName)}.</p></div></section>`);
    return;
  }
  if (lotsMode()) return renderLotsStart(name);
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">Olá!</p>
    <h1>Declarações prontas para autorização</h1>
    <div class="wz-company">${icon.file}<div><small>Emitente</small><b>${h(name)}</b>${S.company.profile?.cnpj || S.company.cnpj ? `<span>CNPJ ${h(cnpjMask(S.company.profile?.cnpj || S.company.cnpj))}</span>` : ""}</div></div>
    <p class="wz-lead">A <b>DC-e</b> (Declaração de Conteúdo eletrônica) é o documento fiscal que acompanha cada envio. A ${h(CFG.agfName)} já preparou tudo. Falta somente a <b>assinatura digital com o e-CNPJ</b> da empresa.</p>
    ${S.pending.length ? `<button type="button" class="wz-note warn wz-resume" id="resume-start">${icon.alert}<div><b>Existe uma autorização interrompida.</b> O sistema retoma exatamente de onde parou, sem duplicar nenhuma declaração.<span class="wz-resume-cta">Continuar de onde parou →</span></div></button>` : ""}
    <h2>Antes de começar, tenha em mãos</h2>
    <ul class="wz-needs">
      <li>${icon.file}<div><b>O arquivo do certificado e-CNPJ A1</b><span>Termina em <b>.pfx</b> ou <b>.p12</b>. Precisa estar neste computador.</span></div></li>
      <li>${icon.key}<div><b>A senha do certificado</b><span>É a senha criada quando o certificado foi emitido. Não é a senha deste site.</span></div></li>
      <li>${icon.clock}<div><b>${capitalize(estimate(total))} com esta página aberta</b><span>São ${int(total)} declarações. Deixe o computador ligado na tomada.</span></div></li>
    </ul>
    <div class="wz-note">${icon.shield}<div>O certificado <b>não é salvo</b>. Ele é usado só durante a autorização e descartado ao fechar a página.</div></div>
    <details class="wz-faq"><summary>Meu certificado é um cartão ou token USB</summary><p>Esse tipo (A3) não funciona neste sistema. É necessário o certificado em arquivo (A1). Fale com a ${h(CFG.agfName)} antes de continuar.</p></details>
    <div class="wz-actions"><button class="wz-primary" id="next">Começar</button></div>
  </section>`);
  root.querySelector("#next").addEventListener("click", () => { S.resuming = false; go("conferir"); });
  // Atalho: retomar direto pelo certificado (as confirmações já foram feitas na primeira tentativa).
  root.querySelector("#resume-start")?.addEventListener("click", () => { S.resuming = true; go("certificado"); });
}

// ---------- 1b. início em lotes ----------
function lotChip(lot) {
  if (lot.state === "done") return `<em class="ok">${icon.check}Autorizado${lot.pendingFix ? ` · ${int(lot.pendingFix)} com pendência` : ""}</em>`;
  if (lot.state === "current") return `<em class="now">${S.pending.length ? "Em andamento" : "Próximo"}</em>`;
  return '<em>Na fila</em>';
}

function lotsGroups() {
  const keyOf = (lot) => `${lot.round}|${lot.ambito || "OUTROS"}`;
  const order = [...new Set(S.lots.map(keyOf))];
  return order.map((key) => {
    const lots = S.lots.filter((lot) => keyOf(lot) === key);
    const ambito = lots[0].ambito || "OUTROS";
    const title = `${multiRound() ? `Rodada ${lots[0].round} · ` : ""}${ambito === "OUTROS" ? "Outros" : ambito}`;
    const doneLots = lots.filter((lot) => lot.state === "done").length;
    const declarations = lots.reduce((sum, lot) => sum + lot.authorized + lot.open, 0);
    const authorized = lots.reduce((sum, lot) => sum + lot.authorized, 0);
    const hasCurrent = lots.some((lot) => lot.state === "current");
    return `<details class="wz-lotgroup" ${hasCurrent ? "open" : ""}><summary><b>${h(title)}</b><span>${int(doneLots)} de ${int(lots.length)} lotes · ${int(authorized)} de ${int(declarations)} declarações</span></summary>
      <ol class="wz-lots">${lots.map((lot) => `<li class="is-${lot.state}"><i>${lot.state === "done" ? icon.check : (lot.number || "•")}</i><div><b>${h(lot.label)}</b><span>${int(lot.authorized + lot.open)} declarações${lot.state === "done" ? "" : ` · ${estimate(lot.open)}`}</span></div>${lotChip(lot)}</li>`).join("")}</ol></details>`;
  }).join("");
}

function renderLotsStart(name) {
  const lot = S.lot;
  const all = S.lots.reduce((sum, item) => sum + item.authorized + item.open, 0);
  const authorized = S.lots.reduce((sum, item) => sum + item.authorized, 0);
  const percent = all ? Math.round((authorized / all) * 100) : 0;
  const doneLots = S.lots.filter((item) => item.state === "done").length;
  const total = totalToAuthorize();
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">Olá!</p>
    <h1>Autorização em lotes</h1>
    <div class="wz-company">${icon.file}<div><small>Emitente</small><b>${h(name)}</b>${S.company.profile?.cnpj || S.company.cnpj ? `<span>CNPJ ${h(cnpjMask(S.company.profile?.cnpj || S.company.cnpj))}</span>` : ""}</div></div>
    <p class="wz-lead">A ${h(CFG.agfName)} preparou as declarações de conteúdo (DC-e) em <b>${int(S.lots.length)} lotes</b> de até 100. Autorize <b>um lote por vez</b>, na ordem abaixo.</p>
    <div class="wz-overall"><div><span>Andamento geral</span><b>${int(authorized)} de ${int(all)} declarações autorizadas</b><small>${int(doneLots)} de ${int(S.lots.length)} lotes concluídos</small></div><strong>${percent}%</strong><div class="wz-progress"><i style="width:${percent}%"></i></div></div>
    ${S.pending.length ? `<button type="button" class="wz-note warn wz-resume" id="resume-start">${icon.alert}<div><b>O ${h(lotName(lot))} foi interrompido.</b> O sistema retoma exatamente de onde parou, sem duplicar nenhuma declaração.<span class="wz-resume-cta">Continuar de onde parou →</span></div></button>` : ""}
    <div class="wz-next">
      <div><span>Próximo lote</span><b>${h(lotName(lot))}</b><small>${int(total)} declarações · ${estimate(total)}</small></div>
      <button class="wz-primary" id="next">Autorizar este lote</button>
    </div>
    <h2>Como funciona</h2>
    <ol class="wz-rules">
      <li><b>Um lote por vez, na ordem</b><span>O próximo lote só é liberado quando o anterior termina. Assim cada lote sai certinho para a postagem.</span></li>
      <li><b>${capitalize(estimate(100))} por lote de 100</b><span>A barra de andamento mostra quanto falta. O tempo depende da internet e da SEFAZ.</span></li>
      <li><b>Deixe esta página aberta até o fim</b><span>Não feche a aba. Mantenha o computador na tomada e sem entrar em descanso. Você pode usar outros programas enquanto isso.</span></li>
      <li><b>Se cair, nada se perde</b><span>Se a internet ou o computador desligar, entre de novo e clique em <b>Continuar de onde parou</b>. Nenhuma declaração é duplicada.</span></li>
      <li><b>Pode dividir em vários dias</b><span>Ao terminar um lote, comece o próximo em seguida ou volte outro dia. A lista mostra onde você parou.</span></li>
    </ol>
    <h2>Tenha em mãos</h2>
    <ul class="wz-needs">
      <li>${icon.file}<div><b>O arquivo do certificado e-CNPJ A1</b><span>Termina em <b>.pfx</b> ou <b>.p12</b>. Precisa estar neste computador.</span></div></li>
      <li>${icon.key}<div><b>A senha do certificado</b><span>É a senha criada quando o certificado foi emitido. Não é a senha deste site.</span></div></li>
    </ul>
    <div class="wz-note">${icon.shield}<div>O certificado <b>não é salvo</b>. Ele é usado só durante a autorização e descartado ao fechar a página.</div></div>
    <h2>Lotes</h2>
    <div class="wz-lotgroups">${lotsGroups()}</div>
    <details class="wz-faq"><summary>Meu certificado é um cartão ou token USB</summary><p>Esse tipo (A3) não funciona neste sistema. É necessário o certificado em arquivo (A1). Fale com a ${h(CFG.agfName)} antes de continuar.</p></details>
  </section>`);
  root.querySelector("#next").addEventListener("click", () => { S.resuming = false; go("conferir"); });
  root.querySelector("#resume-start")?.addEventListener("click", () => { S.resuming = true; go("certificado"); });
}

// ---------- 2. conferir ----------
function renderReview() {
  const { ready, byService, totalValue } = S.summary;
  const term = S.search.trim().toUpperCase();
  const filtered = term ? ready.filter((row) => `${row.document?.recipient?.name} ${row.document?.recipient?.address?.city} ${row.reference}`.toUpperCase().includes(term)) : ready;
  const resumeCount = totalToAuthorize() - S.summary.total;
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">Etapa 2 de 5${lotsMode() ? ` · ${h(lotName(S.lot))}` : ""}</p>
    <h1>Confira o que será autorizado</h1>
    <p class="wz-lead">Estes são os envios que a ${h(CFG.agfName)} preparou. Não é preciso conferir um por um: veja se os totais fazem sentido.</p>
    <div class="wz-metrics">
      <div><span>Declarações</span><strong>${int(totalToAuthorize())}</strong>${resumeCount > 0 ? `<small>${int(resumeCount)} de autorização interrompida</small>` : ""}</div>
      <div><span>Valor total declarado</span><strong>${money(totalValue)}</strong>${resumeCount > 0 ? "<small>sem contar a autorização interrompida</small>" : ""}</div>
      <div><span>Emitente</span><strong class="wz-sm">${h(cnpjMask(S.company.profile?.cnpj || S.company.cnpj))}</strong><small>${h(S.company.name || S.company.profile?.name || "")}</small></div>
    </div>
    <div class="wz-chips">${Object.entries(byService).map(([service, count]) => `<span>${h(service)}: <b>${int(count)}</b></span>`).join("")}</div>
    <label class="wz-search">Procurar um destinatário<input id="search" value="${h(S.search)}" placeholder="Nome ou cidade"></label>
    <div class="wz-list">${filtered.slice(0, 30).map((row) => `<div><b>${h(row.document?.recipient?.name)}</b><span>${h(row.document?.recipient?.address?.city)}/${h(row.document?.recipient?.address?.uf)} · ${h(row.service)}</span><em>${h(row.document?.items?.[0]?.description || "")} · ${money(row.document?.items?.[0]?.unitValue)}</em></div>`).join("") || '<p class="wz-muted">Nenhum destinatário encontrado.</p>'}${filtered.length > 30 ? `<p class="wz-muted">Mostrando 30 de ${int(filtered.length)}. Use a busca para encontrar outros.</p>` : ""}</div>
    <div class="wz-actions"><button class="wz-ghost" id="back">Voltar</button><a class="wz-ghost" href="${whatsLink("Olá! Encontrei algo errado nas DC-e para autorizar.")}" target="_blank" rel="noopener">Algo errado? Avisar a AGF</a><button class="wz-primary" id="next">Está certo, continuar</button></div>
  </section>`);
  const search = root.querySelector("#search");
  search.addEventListener("input", () => { S.search = search.value; const pos = search.selectionStart; renderReview(); const again = root.querySelector("#search"); again.focus(); again.setSelectionRange(pos, pos); });
  root.querySelector("#back").addEventListener("click", () => go("inicio"));
  root.querySelector("#next").addEventListener("click", () => go("certificado"));
}

// ---------- 3. certificado ----------
function certificateProblem(info) {
  if (!info) return "";
  const companyCnpj = cnpjDigits(S.company.profile?.cnpj || S.company.cnpj);
  if (!info.cnpj) return "Este certificado não tem CNPJ. Use o e-CNPJ da empresa (não serve e-CPF).";
  if (cnpjDigits(info.cnpj).slice(0, 8) !== companyCnpj.slice(0, 8)) return `Este certificado é de outro CNPJ (${cnpjMask(info.cnpj)}). Use o e-CNPJ de ${cnpjMask(companyCnpj)}.`;
  if (info.validTo && new Date(info.validTo) < new Date()) return `Este certificado venceu em ${dateBr(info.validTo)}. É preciso renovar o certificado.`;
  return "";
}

function renderCertificate() {
  const info = S.cert.info; const problem = certificateProblem(info);
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">${S.resuming ? "Continuar de onde parou" : "Etapa 3 de 5"}</p>
    <h1>Informe o certificado digital</h1>
    <p class="wz-lead">Selecione o arquivo do e-CNPJ A1 e digite a senha dele. O sistema confere se o certificado é da empresa certa e se está válido.</p>
    <div class="wz-howto">
      <b>Onde encontrar o arquivo?</b>
      <ol><li>Procure no computador por um arquivo terminado em <b>.pfx</b> ou <b>.p12</b>.</li><li>Normalmente ele foi enviado por e-mail pela certificadora (Serasa, Certisign, Soluti, Valid e outras) ou está nas pastas <b>Documentos</b> ou <b>Downloads</b>.</li><li>Se o contador cuida do certificado, peça o arquivo e a senha a ele.</li></ol>
    </div>
    <label class="wz-drop ${S.cert.name ? "filled" : ""}">${icon.file}<span>${S.cert.name ? `<b>${h(S.cert.name)}</b><small>Clique para trocar o arquivo</small>` : "<b>Clique para selecionar o certificado</b><small>Arquivo .pfx ou .p12</small>"}</span><input id="cert" type="file" accept=".pfx,.p12,application/x-pkcs12"></label>
    <label class="wz-field">Senha do certificado<div class="wz-pass"><input id="pass" type="password" autocomplete="off" value="${h(S.passphrase)}"><button type="button" class="wz-link" id="toggle">Mostrar</button></div></label>
    ${info ? (problem ? `<div class="wz-note error">${icon.alert}<div>${h(problem)}</div></div>` : `<div class="wz-cert-ok">${icon.check}<div><b>Certificado conferido</b><span>${h(info.commonName)}</span><span>CNPJ ${h(cnpjMask(info.cnpj))} · válido até ${h(dateBr(info.validTo))}</span></div></div>`) : ""}
    <div class="wz-actions"><button class="wz-ghost" id="back">Voltar</button>${info && !problem ? `<button class="wz-primary" id="next">${S.resuming ? "Continuar autorização" : "Continuar"}</button>` : '<button class="wz-primary" id="check">Conferir certificado</button>'}</div>
  </section>`);
  root.querySelector("#cert").addEventListener("change", async (event) => {
    const file = event.target.files[0]; if (!file) return;
    S.cert = { base64: await fileToBase64(file), name: file.name, info: null }; S.passphrase = root.querySelector("#pass").value; renderCertificate();
  });
  root.querySelector("#pass").addEventListener("input", (event) => {
    S.passphrase = event.target.value;
    if (!S.cert.info) return;
    // Senha alterada depois da conferência: exige conferir de novo.
    S.cert.info = null; const pos = event.target.selectionStart; renderCertificate();
    const again = root.querySelector("#pass"); again.focus(); again.setSelectionRange(pos, pos);
  });
  root.querySelector("#toggle").addEventListener("click", (event) => { const input = root.querySelector("#pass"); input.type = input.type === "password" ? "text" : "password"; event.target.textContent = input.type === "password" ? "Mostrar" : "Ocultar"; });
  root.querySelector("#back").addEventListener("click", () => { if (S.resuming) { S.resuming = false; go("inicio"); } else go("conferir"); });
  root.querySelector("#next")?.addEventListener("click", () => (S.resuming ? startAuthorization() : go("confirmar")));
  root.querySelector("#check")?.addEventListener("click", checkCertificate);
}

async function checkCertificate() {
  S.passphrase = root.querySelector("#pass").value;
  if (!S.cert.base64) return toast("Selecione o arquivo do certificado.", "error");
  if (!S.passphrase) return toast("Digite a senha do certificado.", "error");
  const stop = busy("Conferindo o certificado...");
  try { S.cert.info = await api("/api/dce/certificate", { method: "POST", body: JSON.stringify({ certificateBase64: S.cert.base64, passphrase: S.passphrase }) }); renderCertificate(); }
  catch (error) { S.cert.info = null; toast(/senha|password|mac|decrypt/i.test(error.message) ? "Senha do certificado incorreta. Confira e tente de novo." : error.message, "error"); renderCertificate(); }
  finally { stop(); }
}

// ---------- 4. confirmar ----------
function renderConfirm() {
  const name = S.company.name || S.company.profile?.name || "a empresa";
  const total = totalToAuthorize();
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">Etapa 4 de 5${lotsMode() ? ` · ${h(lotName(S.lot))}` : ""}</p>
    <h1>Confirme e autorize</h1>
    <p class="wz-lead">Serão assinadas e enviadas à SEFAZ <b>${int(total)} declarações</b>${lotsMode() ? ` do <b>${h(lotName(S.lot))}</b>` : ""} em nome de <b>${h(name)}</b>, com o certificado <b>${h(S.cert.info?.commonName || "")}</b>.</p>
    <label class="wz-check"><input type="checkbox" id="eligibility" ${S.accepted.eligibility ? "checked" : ""}><span><b>${h(name)} não é contribuinte do ICMS</b> e estes envios não exigem nota fiscal. Por isso a DC-e é o documento correto.</span></label>
    ${CFG.environment === "1" ? `<label class="wz-check"><input type="checkbox" id="production" ${S.accepted.production ? "checked" : ""}><span>Entendo que serão emitidos <b>documentos fiscais válidos</b> em produção, com numeração oficial.</span></label>` : ""}
    <div class="wz-note">${icon.clock}<div>Tempo estimado: <b>${estimate(total)}</b>. Durante o processo, <b>não feche esta página</b> e não deixe o computador entrar em descanso.</div></div>
    <div class="wz-actions"><button class="wz-ghost" id="back">Voltar</button><button class="wz-primary" id="start" ${S.accepted.eligibility && (CFG.environment === "2" || S.accepted.production) ? "" : "disabled"}>Autorizar ${int(total)} declarações</button></div>
  </section>`);
  root.querySelector("#eligibility").addEventListener("change", (event) => { S.accepted.eligibility = event.target.checked; renderConfirm(); });
  root.querySelector("#production")?.addEventListener("change", (event) => { S.accepted.production = event.target.checked; renderConfirm(); });
  root.querySelector("#back").addEventListener("click", () => go("certificado"));
  root.querySelector("#start").addEventListener("click", startAuthorization);
}

// ---------- 5. autorizar ----------
let wakeLock = null;
const beforeUnload = (event) => { if (S.running) { event.preventDefault(); event.returnValue = ""; } };

async function startAuthorization() {
  S.running = true; S.pause = null; S.result = null; S.runLot = lotName(S.lot);
  S.progress = { stage: "starting", done: 0, expected: totalToAuthorize(), authorized: 0, rejected: 0, errors: 0, elapsedMs: 0 };
  go("autorizar");
  window.addEventListener("beforeunload", beforeUnload);
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
  const credentials = { certificateBase64: S.cert.base64, passphrase: S.passphrase };
  const confirmProduction = CFG.environment === "1";
  try {
    const uf = S.company?.profile?.address?.uf || S.company?.address?.uf || "";
    const service = await api("/api/dce/status", { method: "POST", body: JSON.stringify({ ...credentials, environment: CFG.environment, uf }) });
    // Só 108/109 (serviço paralisado) impedem o envio. Outro retorno da consulta de
    // status não bloqueia: a própria autorização devolve o motivo de cada DC-e.
    if (["108", "109"].includes(String(service.cStat))) throw new PauseError(`A SEFAZ está fora do ar agora (${service.cStat} ${service.reason || ""}). Tente de novo em alguns minutos.`);
    await loadData();
    const result = await runAuthorization({
      readyIds: S.summary.ready.map((row) => row.id),
      pendingBatches: S.pending,
      deps: {
        getBatch: (batchId) => dataAction("batch.get", { batchId }),
        prepare: (ids) => dataAction("batch.prepare", { remittanceIds: ids, environment: CFG.environment }),
        authorize: (documents) => api("/api/dce/authorize", { method: "POST", body: JSON.stringify({ documents, ...credentials, confirmProduction }) }),
        saveResults: (batchId, results) => dataAction("batch.saveResults", { batchId, results }),
        keepXml: (part, error) => {
          S.xmlBackup = S.xmlBackup || [];
          part.forEach((row) => { if (row.signedXml || row.processedXml) S.xmlBackup.push({ reference: row.reference, accessKey: row.accessKey, status: row.status, signedXml: row.signedXml || "", processedXml: row.processedXml || "" }); });
          S.xmlBackupReason = error?.message || "";
        },
      },
      onProgress: (progress) => { S.progress = progress; updateRun(); },
    });
    S.result = result; S.running = false;
    await loadData().catch(() => {});
    go("concluido");
  } catch (error) {
    S.running = false;
    S.pause = error instanceof PauseError ? error.message : `Ocorreu uma falha: ${error.message}`;
    if (error instanceof PauseError && error.cause?.message && !S.pause.includes(error.cause.message)) S.pause += ` Detalhe: ${error.cause.message}`;
    renderRun();
  } finally {
    S.running = false;
    window.removeEventListener("beforeunload", beforeUnload);
    try { await wakeLock?.release(); } catch { /* sem bloqueio de tela */ }
  }
}

function runContent() {
  const p = S.progress || { done: 0, expected: 0 };
  const percent = p.expected ? Math.min(100, Math.round((p.done / p.expected) * 100)) : 0;
  const eta = estimateSeconds(Math.max(0, p.expected - p.done), p.elapsedMs, p.done, PER_DOC_ESTIMATE_MS);
  const label = { starting: "Preparando...", reserving: "Reservando a numeração das próximas declarações...", authorizing: "Assinando e enviando à SEFAZ...", finished: "Finalizando..." }[p.stage] || "Processando...";
  return `<div class="wz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    <div class="wz-progress-info"><b>${int(p.done)} de ${int(p.expected)}</b><span>${percent}%</span></div>
    <p class="wz-muted">${S.pause ? "Pausado" : `${label} ${p.done ? `Faltam ${duration(eta)}.` : ""}`}</p>
    <div class="wz-counters"><div class="ok"><strong>${int(p.authorized)}</strong><span>autorizadas</span></div><div class="warn"><strong>${int(p.rejected)}</strong><span>recusadas pela SEFAZ</span></div><div><strong>${int(p.errors)}</strong><span>para tentar de novo</span></div></div>`;
}

function renderRun() {
  frame(`<section class="wz-card">
    <p class="wz-eyebrow">Etapa 5 de 5${lotsMode() && S.runLot ? ` · ${h(S.runLot)}` : ""}</p>
    <h1>${S.pause ? "Autorização pausada" : "Autorizando as declarações"}</h1>
    ${S.pause ? `<div class="wz-note error">${icon.alert}<div><b>${h(S.pause)}</b> As declarações já autorizadas estão garantidas. Ao continuar, o sistema retoma de onde parou.</div></div>` : '<div class="wz-note warn">' + icon.alert + '<div><b>Não feche esta página</b> e mantenha o computador ligado até o fim.</div></div>'}
    <div id="run">${runContent()}</div>
    ${S.pause ? '<div class="wz-actions"><button class="wz-primary" id="resume">Continuar de onde parou</button></div>' : ""}
    ${S.pause ? backupButton() : ""}
  </section>`);
  root.querySelector("#resume")?.addEventListener("click", startAuthorization);
  bindBackup();
}

function updateRun() {
  const box = root.querySelector("#run");
  if (box) box.innerHTML = runContent(); else renderRun();
}

// Cópia dos XML quando o Apps Script não conseguiu gravá-los no Drive (plano B do motor).
function backupButton() {
  return S.xmlBackup?.length ? `<div class="wz-note warn">${icon.alert}<div><b>Guarde uma cópia dos arquivos.</b> As declarações estão registradas, mas os arquivos XML não foram salvos no servidor. Baixe a cópia e envie para a ${h(CFG.agfName)}.</div></div><div class="wz-actions center"><button class="wz-ghost" id="xml-backup">Baixar cópia dos XML (${S.xmlBackup.length})</button></div>` : "";
}

function bindBackup() {
  root.querySelector("#xml-backup")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ geradoEm: new Date().toISOString(), motivo: S.xmlBackupReason || "", documentos: S.xmlBackup }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `DCe-XML-copia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });
}

// ---------- 6. concluído ----------
function renderDone() {
  const r = S.result || { authorized: 0, rejected: 0, errors: 0, rejections: [] };
  const allGood = !r.rejected && !r.errors;
  frame(`<section class="wz-card">
    <div class="wz-empty ${allGood ? "ok" : ""}">${allGood ? icon.check : icon.alert}<h1>${allGood ? "Pronto! Declarações autorizadas" : "Autorização concluída com pendências"}</h1>
    <p><b>${int(r.authorized)}</b> ${r.authorized === 1 ? "declaração autorizada" : "declarações autorizadas"} pela SEFAZ.${r.rejected ? ` <b>${int(r.rejected)}</b> ${r.rejected === 1 ? "foi recusada" : "foram recusadas"}.` : ""}${r.errors ? ` <b>${int(r.errors)}</b> ${r.errors === 1 ? "precisa ser enviada" : "precisam ser enviadas"} de novo.` : ""}</p></div>
    ${r.errors ? '<div class="wz-actions center"><button class="wz-primary" id="retry">Enviar de novo as pendentes</button></div>' : ""}
    ${r.rejections.length ? `<h2>Recusadas pela SEFAZ</h2><p class="wz-muted">A ${h(CFG.agfName)} vai corrigir estas e avisar você, se for preciso autorizar de novo.</p><div class="wz-list">${r.rejections.slice(0, 50).map((item) => `<div><b>${h(item.name || item.reference)}</b><em>${h(item.reason)}</em></div>`).join("")}</div>` : ""}
    ${nextLotBox(allGood)}
    ${backupButton()}
    <div class="wz-actions center"><a class="wz-ghost" href="${whatsLink(`Olá! Terminei a autorização das DC-e${S.runLot && lotsMode() ? ` (${S.runLot})` : ""}: ${r.authorized} autorizadas${r.rejected ? `, ${r.rejected} recusadas` : ""}${r.errors ? `, ${r.errors} pendentes` : ""}.`)}" target="_blank" rel="noopener">Avisar a AGF pelo WhatsApp</a></div>
  </section>`, { stepper: false });
  root.querySelector("#retry")?.addEventListener("click", startAuthorization);
  root.querySelector("#next-lot")?.addEventListener("click", () => { S.search = ""; go(S.cert.info ? "confirmar" : "inicio"); });
  bindBackup();
}

// Fim de um lote: mostra o próximo e permite seguir com o mesmo certificado, sem digitar de novo.
function nextLotBox(allGood) {
  const finished = `Você já pode fechar esta página. A ${h(CFG.agfName)} cuida da impressão e da postagem.`;
  if (!lotsMode()) return `<div class="wz-note ok">${icon.shield}<div>${allGood ? finished : `Avise a ${h(CFG.agfName)} que a autorização terminou.`}</div></div>`;
  if (!S.lot) return `<div class="wz-note ok">${icon.shield}<div><b>Todos os lotes foram autorizados.</b> ${finished}</div></div>`;
  if (!allGood) return `<div class="wz-note warn">${icon.alert}<div>Resolva as pendências deste lote antes de seguir. Se precisar, avise a ${h(CFG.agfName)}.</div></div>`;
  const count = totalToAuthorize();
  return `<div class="wz-next"><div><span>Próximo lote</span><b>${h(lotName(S.lot))}</b><small>${int(count)} declarações · ${estimate(count)}</small></div><button class="wz-primary" id="next-lot">Autorizar o próximo lote</button></div>
    <p class="wz-muted center">Prefere continuar outro dia? Pode fechar a página. Ao voltar, a lista mostra onde você parou.</p>`;
}

// ---------- boot ----------
async function init() {
  try { S.user = await getUser(); } catch { S.user = null; }
  if (!S.user && location.hostname === "localhost" && new URLSearchParams(location.search).has("demo")) S.user = { id: "local-development", email: "dev@localhost" };
  if (!S.user) return renderLogin();
  const stop = busy("Carregando...");
  try { await loadData(); } catch (error) { toast(error.message, "error"); }
  finally { stop(); }
  render();
}

init();
