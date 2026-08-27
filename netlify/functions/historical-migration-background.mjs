import { callOperationsAppsScript } from "./_shared/operations-apps-script.mjs";
import { env } from "./_shared/constants.mjs";

const MIGRATION_USER = Object.freeze({
  id: "b1b4bfe1-766b-41ab-80d8-fd5082f10b7b",
  email: "chelzinha@gmail.com",
});

const CAMPAIGN_ID = "d0a9470d-79dd-425f-9bd3-c6230c4693e5";
const ARCHIVE_FILE_ID = "1LIfkP0Iw0X5ww5EA4gJKfbFapUQytq6e";
const VALID_MODES = new Set([
  "reset", "campaign", "addresses", "production", "tracking", "events", "finance", "finalize",
]);

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

function archivePayload(entryName) {
  return {
    campaignId: CAMPAIGN_ID,
    archiveFileId: ARCHIVE_FILE_ID,
    entryName,
  };
}

async function migrateReset() {
  return callWithRetry("historical.reset", { campaignId: CAMPAIGN_ID });
}

async function migrateCampaign() {
  return callWithRetry("historical.campaign", archivePayload("campaign.json.gz"));
}

async function migrateAddresses() {
  let inserted = 0;
  for (let index = 0; index < 14; index += 1) {
    const entryName = `addresses-${String(index).padStart(2, "0")}.json.gz`;
    const result = await callWithRetry("historical.addresses", archivePayload(entryName));
    inserted += Number(result?.rows?.inserted || 0);
    console.log(JSON.stringify({ marker: "HISTORICAL_ADDRESS_CHUNK", entryName, result }));
  }
  return { expected: 9999, inserted };
}

async function migrateProduction() {
  let objects = 0;
  let volumes = 0;
  for (let index = 0; index < 16; index += 1) {
    const entryName = `lot-${String(index).padStart(2, "0")}.json.gz`;
    const result = await callWithRetry("historical.lot", archivePayload(entryName));
    objects += Number(result?.objects?.inserted || 0);
    volumes += Number(result?.volumes?.inserted || 0);
    console.log(JSON.stringify({ marker: "HISTORICAL_LOT_DONE", entryName, result }));
  }
  return { expectedObjects: 5368, objects, expectedVolumes: 28, volumes };
}

async function migrateTracking() {
  let inserted = 0;
  for (let index = 0; index < 4; index += 1) {
    const entryName = `tracking-${String(index).padStart(2, "0")}.json.gz`;
    const result = await callWithRetry("historical.tracking", archivePayload(entryName));
    inserted += Number(result?.inserted || 0);
  }
  return { expected: 2353, inserted };
}

async function migrateEvents() {
  return callWithRetry("historical.events", archivePayload("events.json.gz"));
}

async function migrateFinance() {
  let inserted = 0;
  for (let index = 0; index < 2; index += 1) {
    const entryName = `finance-${String(index).padStart(2, "0")}.json.gz`;
    const result = await callWithRetry("historical.finance", archivePayload(entryName));
    inserted += Number(result?.postings?.inserted || 0);
  }
  return { expected: 1062, inserted };
}

async function migrateFinalize() {
  return callWithRetry("historical.finalize", {
    campaignId: CAMPAIGN_ID,
    expected: {
      addresses: 9999,
      portalExports: 16,
      portalReturns: 16,
      objects: 5368,
      batches: 16,
      volumes: 28,
      tracking: 2353,
      events: 134,
      dailySummaries: 7,
      financePostings: 1062,
    },
  });
}

async function runMode(mode) {
  if (mode === "reset") return migrateReset();
  if (mode === "campaign") return migrateCampaign();
  if (mode === "addresses") return migrateAddresses();
  if (mode === "production") return migrateProduction();
  if (mode === "tracking") return migrateTracking();
  if (mode === "events") return migrateEvents();
  if (mode === "finance") return migrateFinance();
  if (mode === "finalize") return migrateFinalize();
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
    const result = await runMode(mode);
    console.log(JSON.stringify({
      marker: "HISTORICAL_MIGRATION_DONE",
      mode,
      elapsedMs: Date.now() - startedAt,
      result,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      marker: "HISTORICAL_MIGRATION_FAILED",
      mode,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.stack || error),
    }));
    throw error;
  }
}

export const config = {
  path: "/api/historical-migration-background",
};
