import "./label-setup-ui.css";
import { loadPostalVendors } from "./postal-vendors.js";
import { completeLabelSetup, normalizeLabelSetup } from "./label-setup.js";

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler a chancela."));
    reader.readAsDataURL(file);
  });
}

function drawSelection(canvas, region) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!region) return;
  const x = region.x * canvas.width;
  const y = region.y * canvas.height;
  const w = region.w * canvas.width;
  const hgt = region.h * canvas.height;
  context.save();
  context.fillStyle = "rgba(9,100,154,.12)";
  context.strokeStyle = "#09649a";
  context.lineWidth = Math.max(2, canvas.width / 260);
  context.setLineDash([8, 5]);
  context.fillRect(x, y, w, hgt);
  context.strokeRect(x, y, w, hgt);
  context.restore();
}

async function renderFirstPage(pdfFile, canvas, overlay) {
  const { pdfjsLib } = await loadPostalVendors();
  const document = await pdfjsLib.getDocument({ data: await pdfFile.arrayBuffer() }).promise;
  const page = await document.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const maxWidth = Math.min(760, Math.max(360, window.innerWidth - 120));
  const scale = Math.max(.7, Math.min(2.2, maxWidth / base.width));
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  canvas.style.aspectRatio = `${canvas.width}/${canvas.height}`;
  overlay.style.aspectRatio = `${canvas.width}/${canvas.height}`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

export async function configureLabelSetup({ pdfFiles, initialSetup = null } = {}) {
  const files = [...(pdfFiles || [])];
  if (!files.length) throw new Error("Selecione primeiro o PDF das etiquetas do Portal Postal.");

  let setup = normalizeLabelSetup(initialSetup || {});
  let draftRegion = setup.matrixRegion;
  let dragging = null;

  const backdrop = document.createElement("div");
  backdrop.className = "label-setup-backdrop";
  backdrop.innerHTML = `<section class="label-setup-modal" role="dialog" aria-modal="true" aria-label="Configurar etiqueta">
    <div class="label-setup-head">
      <div><p class="eyebrow">CONFIGURAÇÃO DA ETIQUETA</p><h2>Marque o Data Matrix e carregue a chancela</h2><p>Use a primeira etiqueta como modelo. A mesma área será aplicada às demais páginas deste retorno.</p></div>
      <button type="button" class="ghost" data-close>Fechar</button>
    </div>
    <div class="label-setup-grid">
      <div class="label-preview-column">
        <div class="label-preview-toolbar"><strong>1. Área do Data Matrix</strong><span>Arraste um retângulo exatamente sobre o código.</span></div>
        <div class="label-preview-stage"><canvas data-pdf></canvas><canvas data-overlay></canvas><div class="label-preview-loading">Carregando primeira etiqueta…</div></div>
        <div class="label-selection-status" data-region-status>Nenhuma área marcada.</div>
        <button type="button" class="ghost" data-clear-region>Limpar seleção</button>
      </div>
      <div class="label-stamp-column">
        <div><strong>2. Chancela da etiqueta</strong><p>Carregue a imagem que deve aparecer no espaço superior esquerdo da etiqueta final.</p></div>
        <div class="label-stamp-upload"><input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" data-stamp><span>Selecionar chancela</span><small>PNG ou JPG. Prefira fundo branco ou transparente.</small></div>
        <div class="label-stamp-preview" data-stamp-preview>${setup.postageMarkDataUrl ? `<img src="${h(setup.postageMarkDataUrl)}" alt="Prévia da chancela">` : "<span>Nenhuma chancela carregada.</span>"}</div>
        <div class="label-stamp-name" data-stamp-name>${h(setup.postageMarkName || "")}</div>
        <div class="label-setup-checklist">
          <div data-check-region class="${setup.matrixRegion ? "ok" : ""}"><span></span>Área do Data Matrix</div>
          <div data-check-stamp class="${setup.postageMarkDataUrl ? "ok" : ""}"><span></span>Chancela</div>
        </div>
      </div>
    </div>
    <div class="label-setup-actions"><div data-error></div><button type="button" class="primary" data-save>Salvar configuração da etiqueta</button></div>
  </section>`;
  document.body.appendChild(backdrop);

  const canvas = backdrop.querySelector("[data-pdf]");
  const overlay = backdrop.querySelector("[data-overlay]");
  const loading = backdrop.querySelector(".label-preview-loading");
  const regionStatus = backdrop.querySelector("[data-region-status]");
  const stampPreview = backdrop.querySelector("[data-stamp-preview]");
  const stampName = backdrop.querySelector("[data-stamp-name]");
  const checkRegion = backdrop.querySelector("[data-check-region]");
  const checkStamp = backdrop.querySelector("[data-check-stamp]");
  const errorBox = backdrop.querySelector("[data-error]");

  const updateRegionUi = () => {
    drawSelection(overlay, draftRegion);
    checkRegion.classList.toggle("ok", Boolean(draftRegion));
    regionStatus.textContent = draftRegion
      ? `Área marcada: ${(draftRegion.w * 100).toFixed(1)}% × ${(draftRegion.h * 100).toFixed(1)}% da página.`
      : "Nenhuma área marcada.";
  };
  const updateStampUi = () => {
    checkStamp.classList.toggle("ok", Boolean(setup.postageMarkDataUrl));
    stampPreview.innerHTML = setup.postageMarkDataUrl ? `<img src="${h(setup.postageMarkDataUrl)}" alt="Prévia da chancela">` : "<span>Nenhuma chancela carregada.</span>";
    stampName.textContent = setup.postageMarkName || "";
  };

  try {
    await renderFirstPage(files[0], canvas, overlay);
    loading.remove();
    updateRegionUi();
  } catch (error) {
    loading.textContent = error.message;
    loading.classList.add("error");
  }

  const point = (event) => {
    const rect = overlay.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  overlay.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    overlay.setPointerCapture?.(event.pointerId);
    dragging = point(event);
    draftRegion = { x: dragging.x, y: dragging.y, w: .001, h: .001 };
    updateRegionUi();
  });
  overlay.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const now = point(event);
    draftRegion = {
      x: Math.min(dragging.x, now.x),
      y: Math.min(dragging.y, now.y),
      w: Math.abs(now.x - dragging.x),
      h: Math.abs(now.y - dragging.y),
    };
    updateRegionUi();
  });
  const finishDrag = () => {
    if (!dragging) return;
    dragging = null;
    if (!draftRegion || draftRegion.w < .015 || draftRegion.h < .015) draftRegion = null;
    updateRegionUi();
  };
  overlay.addEventListener("pointerup", finishDrag);
  overlay.addEventListener("pointercancel", finishDrag);

  backdrop.querySelector("[data-clear-region]").addEventListener("click", () => { draftRegion = null; updateRegionUi(); });
  backdrop.querySelector("[data-stamp]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!/^data:image\/(png|jpeg);base64,/i.test(dataUrl)) throw new Error("Use uma chancela em PNG ou JPG.");
      setup = { ...setup, postageMarkDataUrl: dataUrl, postageMarkName: file.name };
      updateStampUi();
      errorBox.textContent = "";
    } catch (error) { errorBox.textContent = error.message; }
  });

  return await new Promise((resolve) => {
    const close = (value) => { backdrop.remove(); resolve(value); };
    backdrop.querySelector("[data-close]").addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(null); });
    backdrop.querySelector("[data-save]").addEventListener("click", () => {
      try {
        const completed = completeLabelSetup({ ...setup, matrixRegion: draftRegion, configuredAt: new Date().toISOString() });
        close(completed);
      } catch (error) { errorBox.textContent = error.message; }
    });
  });
}
