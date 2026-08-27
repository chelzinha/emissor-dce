import { createDecipheriv } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { callOperationsAppsScript } from "./_shared/operations-apps-script.mjs";
import { env } from "./_shared/constants.mjs";
import { encryptedMigrationPayload } from "./_migration/payload.mjs";

const MIGRATION_USER = Object.freeze({
  id: "b1b4bfe1-766b-41ab-80d8-fd5082f10b7b",
  email: "chelzinha@gmail.com",
});

const CAMPAIGN_ID = "d0a9470d-79dd-425f-9bd3-c6230c4693e5";
const CHUNK_SIZE = 200;
const VALID_MODES = new Set(["campaign", "addresses", "production", "tracking", "events"]);

function parseMaybeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); }
  catch { return fallback; }
}

function loadMigrationPayload() {
  const keyHex = env("HISTORICAL_PAYLOAD_KEY");
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error("Chave da carga histórica não configurada");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(encryptedMigrationPayload.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(encryptedMigrationPayload.aad, "utf8"));
  decipher.setAuthTag(Buffer.from(encryptedMigrationPayload.tag, "base64"));
  const ciphertext = Buffer.from(encryptedMigrationPayload.chunks.join(""), "base64");
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(brotliDecompressSync(compressed).toString("utf8"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(action, payload, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callOperationsAppsScript(action, payload, MIGRATION_USER);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(500 * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`${action}: ${String(lastError?.message || lastError)}`);
}

function chunks(rows, size = CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function campaignProfileFromPayload(data) {
  const profile = data.campaign || {};
  const meta = data.campaignMeta || {};
  if (!profile || typeof profile !== "object") throw new Error("Campanha ausente na carga histórica");
  return { meta, profile };
}

async function migrateCampaign(data) {
  const { meta, profile } = campaignProfileFromPayload(data);
  return callWithRetry("campaign.upsert", {
    id: CAMPAIGN_ID,
    name: String(meta.NAME || profile.name || ""),
    cnpj: String(meta.CNPJ || profile.cnpj || ""),
    candidateName: String(meta.CANDIDATE_NAME || profile.candidateName || ""),
    office: String(meta.OFFICE || profile.office || ""),
    status: "ACTIVE",
    profile,
  });
}

function normalizedAddressRows(data) {
  return Array.isArray(data.addresses) ? data.addresses : [];
}

async function migrateAddresses(data) {
  const rows = normalizedAddressRows(data);
  if (rows.length !== 9999) throw new Error(`Carga de endereços divergente: ${rows.length}`);
  const started = await callWithRetry("addressList.start", {
    campaignId: CAMPAIGN_ID,
    fileName: "CADASTRO CONSOLIDADO - CAMPANHA 2026.xlsx",
    metadata: {
      historicalImport: true,
      source: "CADASTRO CONSOLIDADO - campanha 2026.xlsx",
      expectedTotal: rows.length,
      expectedReady: 7952,
      expectedRejected: 816,
      expectedReview: 1231,
    },
  });
  for (const block of chunks(rows)) {
    await callWithRetry("addressList.append", {
      campaignId: CAMPAIGN_ID,
      addressListId: started.id,
      rows: block,
    });
  }
  const finished = await callWithRetry("addressList.finish", {
    campaignId: CAMPAIGN_ID,
    addressListId: started.id,
  });
  console.log(JSON.stringify({ marker: "HISTORICAL_ADDRESSES_DONE", addressListId: started.id, total: rows.length }));
  return { addressListId: started.id, finished };
}

function postingDateIso(objects) {
  for (const row of objects) {
    const postal = parseMaybeJson(row.postal || row.POSTAL_JSON, {});
    const raw = String(postal.POSTAGEM || postal.DATA_POSTAGEM || "").trim();
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}T17:00:00-03:00`;
  }
  return new Date().toISOString();
}

async function migrateProduction(data) {
  const returns = Array.isArray(data.returns) ? data.returns : [];
  const allObjects = returns.flatMap((item) => item.objects || []);
  if (allObjects.length !== 5368) throw new Error(`Carga de objetos divergente: ${allObjects.length}`);
  let migrated = 0;
  const batches = [];

  for (let returnIndex = 0; returnIndex < returns.length; returnIndex += 1) {
    const returnRow = returns[returnIndex];
    const sourceObjects = Array.isArray(returnRow.objects) ? returnRow.objects : [];
    const sourceReturnId = `historical-return-${returnIndex + 1}`;
    if (!sourceObjects.length) throw new Error(`Retorno sem objetos: ${sourceReturnId}`);
    const started = await callWithRetry("portalReturn.start", {
      campaignId: CAMPAIGN_ID,
      csvFileName: String(returnRow.csvFileName || "retorno_historico.csv"),
      csvSha256: "",
      pdfFiles: [],
    });
    for (const block of chunks(sourceObjects)) {
      await callWithRetry("portalReturn.append", {
        campaignId: CAMPAIGN_ID,
        portalReturnId: started.id,
        rows: block,
      });
    }
    const finished = await callWithRetry("portalReturn.finish", {
      campaignId: CAMPAIGN_ID,
      portalReturnId: started.id,
    });
    if (String(finished.status) !== "READY") {
      throw new Error(`Retorno histórico ficou em ${finished.status}: ${sourceReturnId}`);
    }
    const batch = await callWithRetry("production.prepare", {
      campaignId: CAMPAIGN_ID,
      portalReturnId: started.id,
      documentMode: "SIMPLIFIED_DECLARATION",
    });
    const trackingCodes = sourceObjects.map((row) => String(row.trackingCode || row.TRACKING_CODE || ""));
    await callWithRetry("production.matrix.confirm", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
      verifiedTrackingCodes: trackingCodes,
    });
    const test = await callWithRetry("production.labelTest.data", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
    });
    await callWithRetry("production.labelTest.approve", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
      readTrackingCode: test.trackingCode,
    });
    await callWithRetry("production.print.confirm", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
      quantity: sourceObjects.length,
      confirmationId: `historical-print-${returnIndex + 1}`,
    });
    await callWithRetry("production.handoff.confirm", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
      receivedBy: "IMPORTAÇÃO HISTÓRICA",
      deliveredBy: "AGF JOSÉ BONIFÁCIO",
    });
    const postingLists = await callWithRetry("production.posting.list", {
      campaignId: CAMPAIGN_ID,
      productionBatchId: batch.id,
    });
    if (!postingLists.length) throw new Error(`Nenhuma lista postal encontrada para ${sourceReturnId}`);
    const postedAt = postingDateIso(sourceObjects);
    for (const list of postingLists) {
      await callWithRetry("production.posting.confirm", {
        campaignId: CAMPAIGN_ID,
        productionBatchId: batch.id,
        listId: list.listId,
        service: list.service,
        postedAt,
        receiptReference: `Migração histórica ${list.listId}`,
      });
    }
    migrated += sourceObjects.length;
    batches.push({ portalReturnId: started.id, productionBatchId: batch.id, total: sourceObjects.length });
    console.log(JSON.stringify({ marker: "HISTORICAL_BATCH_DONE", sourceReturnId, total: sourceObjects.length }));
  }

  if (migrated !== allObjects.length) throw new Error(`Objetos migrados divergentes: ${migrated}`);
  console.log(JSON.stringify({ marker: "HISTORICAL_PRODUCTION_DONE", total: migrated, batches: batches.length }));
  return { total: migrated, batches };
}

function trackingInput(row) {
  return {
    trackingCode: String(row.TRACKING_CODE || row.trackingCode || ""),
    eventAt: String(row.EVENT_AT || ""),
    category: String(row.CATEGORY || "UNKNOWN"),
    status: String(row.STATUS || ""),
    description: String(row.DESCRIPTION || ""),
    location: String(row.LOCATION || ""),
    sourceKey: String(row.SOURCE_KEY || ""),
  };
}

async function migrateTracking(data) {
  const rows = data.tracking || [];
  if (rows.length !== 2353) throw new Error(`Carga de rastreamento divergente: ${rows.length}`);
  let inserted = 0;
  let duplicates = 0;
  const errors = [];
  for (const block of chunks(rows.map(trackingInput))) {
    const result = await callWithRetry("tracking.updates.append", {
      campaignId: CAMPAIGN_ID,
      source: "CORREIOS_ANALITICO_ATE_27_08_2026",
      rows: block,
    });
    inserted += Number(result.inserted || 0);
    duplicates += Number(result.duplicates || 0);
    if (Array.isArray(result.errors) && result.errors.length) errors.push(...result.errors);
  }
  if (errors.length) throw new Error(`Erros no rastreamento: ${JSON.stringify(errors.slice(0, 10))}`);
  console.log(JSON.stringify({ marker: "HISTORICAL_TRACKING_DONE", received: rows.length, inserted, duplicates }));
  return { received: rows.length, inserted, duplicates };
}

async function migrateEvents(data) {
  const rows = (data.events || []).slice().sort((a, b) =>
    String(a.occurredAt || "").localeCompare(String(b.occurredAt || "")) || String(a.idempotencyKey || "").localeCompare(String(b.idempotencyKey || ""))
  );
  let recorded = 0;
  for (const row of rows) {
    await callWithRetry("operation.record", {
      campaignId: CAMPAIGN_ID,
      type: String(row.type || row.TYPE || ""),
      sourceType: String(row.sourceType || row.SOURCE_TYPE || "HISTORICAL_IMPORT"),
      sourceId: String(row.sourceId || row.SOURCE_ID || ""),
      service: String(row.service || row.SERVICE || ""),
      quantity: Number(row.quantity ?? row.QUANTITY ?? 0),
      idempotencyKey: String(row.idempotencyKey || row.IDEMPOTENCY_KEY || `historical-event:${recorded + 1}`),
      metadata: parseMaybeJson(row.metadata || row.METADATA_JSON, {}),
      occurredAt: String(row.occurredAt || row.OCCURRED_AT || row.CREATED_AT || ""),
    });
    recorded += 1;
  }
  console.log(JSON.stringify({ marker: "HISTORICAL_EVENTS_DONE", total: recorded }));
  return { total: recorded };
}

async function runMode(mode, data) {
  if (mode === "campaign") return migrateCampaign(data);
  if (mode === "addresses") return migrateAddresses(data);
  if (mode === "production") return migrateProduction(data);
  if (mode === "tracking") return migrateTracking(data);
  if (mode === "events") return migrateEvents(data);
  throw new Error("Modo de migração inválido");
}

export default async function handler(req) {
  const url = new URL(req.url);
  const expected = env("HISTORICAL_IMPORT_TOKEN");
  const provided = url.searchParams.get("token") || req.headers.get("x-historical-import-token") || "";
  const mode = String(url.searchParams.get("mode") || "").toLowerCase();
  if (!expected || provided !== expected) {
    console.error("Migração histórica recusada: token inválido");
    return;
  }
  if (!VALID_MODES.has(mode)) {
    console.error(`Migração histórica recusada: modo inválido (${mode})`);
    return;
  }
  const startedAt = Date.now();
  try {
    const data = loadMigrationPayload();
    const result = await runMode(mode, data);
    console.log(JSON.stringify({ marker: "HISTORICAL_MIGRATION_DONE", mode, elapsedMs: Date.now() - startedAt, result }));
  } catch (error) {
    console.error(JSON.stringify({ marker: "HISTORICAL_MIGRATION_FAILED", mode, elapsedMs: Date.now() - startedAt, error: String(error?.stack || error) }));
    throw error;
  }
}

export const config = {
  path: "/api/historical-migration-background",
};
