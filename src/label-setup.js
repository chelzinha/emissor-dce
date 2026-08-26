export const DEFAULT_MATRIX_REGION = Object.freeze({ x: 0.365, y: 0.042, w: 0.245, h: 0.140 });
export const DEFAULT_LABEL_FONT_SCALE = 0.8;

function number(value, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMatrixRegion(region) {
  if (!region) return null;
  const x = clamp(number(region.x), 0, 1);
  const y = clamp(number(region.y), 0, 1);
  const w = clamp(number(region.w), 0.01, 1 - x);
  const h = clamp(number(region.h), 0.01, 1 - y);
  if (w < 0.01 || h < 0.01) return null;
  return { x, y, w, h };
}

export function normalizeLabelFontScale(value) {
  return clamp(number(value, DEFAULT_LABEL_FONT_SCALE), 0.8, 1.1);
}

export function normalizeLabelSetup(value) {
  const source = value || {};
  return {
    matrixRegion: normalizeMatrixRegion(source.matrixRegion),
    postageMarkDataUrl: String(source.postageMarkDataUrl || ""),
    postageMarkName: String(source.postageMarkName || ""),
    fontScale: normalizeLabelFontScale(source.fontScale),
    configuredAt: String(source.configuredAt || ""),
  };
}

export function isLabelSetupComplete(value) {
  const setup = normalizeLabelSetup(value);
  return Boolean(setup.matrixRegion && /^data:image\/(png|jpeg);base64,/i.test(setup.postageMarkDataUrl));
}

export function completeLabelSetup(value) {
  const setup = normalizeLabelSetup(value);
  if (!isLabelSetupComplete(setup)) throw new Error("Marque a área do Data Matrix e carregue a chancela antes de continuar.");
  return { ...setup, configuredAt: setup.configuredAt || new Date().toISOString() };
}
