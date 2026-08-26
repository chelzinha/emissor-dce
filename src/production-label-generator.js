import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dataAction, downloadBlob } from './api.js';
import { getPortalReturnAssets } from './portal-assets.js';
import { auditPdfDocuments, loadPdfDocuments, verifyCrops } from './matrix-engine.js';
import { loadPostalVendors } from './postal-vendors.js';
import { renderUnifiedLabelV13, normalizeUnifiedLabelFontScale } from './production-label-layout-v13.js';

const CROP_CACHE = new Map();

function normalizeTracking(value) {
  return String(value || '').replace(/\s/g, '').toUpperCase();
}

async function matrixCrops(portalReturnId, trackingCodes, onProgress) {
  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) {
    throw new Error('Os PDFs originais do Portal não estão disponíveis neste navegador. Reimporte o retorno no computador da produção.');
  }
  const region = assets.labelSetup?.matrixRegion;
  if (!region) throw new Error('A área do Data Matrix ainda não foi configurada para este retorno.');

  const targets = [...new Set((trackingCodes || []).map(normalizeTracking).filter(Boolean))].sort();
  if (!targets.length) throw new Error('Nenhum SRO foi informado para gerar as etiquetas.');

  const cacheKey = `${portalReturnId}:${JSON.stringify(region)}:${targets.join('|')}`;
  if (CROP_CACHE.has(cacheKey)) return CROP_CACHE.get(cacheKey);

  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);
  let audit;
  try {
    audit = await auditPdfDocuments(documents, ZXing, {
      region,
      onProgress,
      targetTrackingCodes: targets,
    });
  } finally {
    for (const item of documents) {
      try { await item.doc.destroy?.(); } catch {}
    }
  }

  const textOnly = new Set(audit.audit
    .filter((row) => row.origin === 'texto' && targets.includes(row.object))
    .map((row) => row.object));
  const verified = await verifyCrops(audit.crops, ZXing);
  const failed = verified.filter((row) => !row.ok && !textOnly.has(row.object));
  const missing = targets.filter((code) => !audit.crops.has(code));
  if (failed.length || missing.length) {
    throw new Error(`${failed.length + missing.length} Data Matrix não puderam ser recuperados para a geração.`);
  }

  if (targets.length <= 10) CROP_CACHE.set(cacheKey, audit.crops);
  return audit.crops;
}

async function buildPdf(data, onProgress) {
  if (data.senderIssues?.length) {
    throw new Error(`Dados do remetente incompletos: ${data.senderIssues.join(' ')}`);
  }

  const assets = await getPortalReturnAssets(data.portalReturnId);
  const postageMarkDataUrl = assets?.labelSetup?.postageMarkDataUrl;
  const fontScale = normalizeUnifiedLabelFontScale(assets?.labelSetup?.fontScale);
  if (!assets?.labelSetup?.matrixRegion || !postageMarkDataUrl) {
    throw new Error('Configure a área do Data Matrix e a chancela antes de gerar etiquetas.');
  }

  const targetTrackingCodes = data.objects.map((object) => normalizeTracking(object.trackingCode));
  const crops = await matrixCrops(
    data.portalReturnId,
    targetTrackingCodes,
    (progress) => onProgress?.(`Localizando Data Matrix: ${progress.processed || 0}/${progress.totalPages || 0}`),
  );

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  for (let index = 0; index < data.objects.length; index += 1) {
    const object = data.objects[index];
    const tracking = normalizeTracking(object.trackingCode);
    const crop = crops.get(tracking);
    if (!crop) throw new Error(`Data Matrix original não localizado para ${object.trackingCode}.`);

    onProgress?.(`Montando etiqueta ${index + 1} de ${data.objects.length}`);
    await renderUnifiedLabelV13({
      pdf,
      fonts,
      object,
      matrixDataUrl: crop,
      postageMarkDataUrl,
      fontScale,
    });
    if (index % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  pdf.setTitle(data.documentMode === 'DCE_AUTHORIZED'
    ? 'Etiquetas unificadas DC-e'
    : 'Etiquetas com declaração simplificada');
  pdf.setProducer('AGF Operações Postais');
  return pdf.save();
}

export async function generateProductionTestPdf(campaignId, productionBatchId, onProgress) {
  const data = await dataAction('production.documents.test', { campaignId, productionBatchId });
  const bytes = await buildPdf(data, onProgress);
  downloadBlob(
    new Blob([bytes], { type: 'application/pdf' }),
    `etiqueta_teste_${String(data.objects[0]?.trackingCode || 'lote')}.pdf`,
  );
  return data;
}

export async function generateProductionVolumePdf(campaignId, productionBatchId, volumeId, onProgress) {
  const data = await dataAction('production.documents.volume', { campaignId, productionBatchId, volumeId });
  const bytes = await buildPdf(data, onProgress);
  const volume = data.volume;
  downloadBlob(
    new Blob([bytes], { type: 'application/pdf' }),
    `volume_${String(volume.number).padStart(2, '0')}_de_${String(volume.totalVolumes).padStart(2, '0')}_${volume.service}.pdf`,
  );
  return data;
}
