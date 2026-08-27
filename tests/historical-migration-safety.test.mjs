import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../apps-script/Api.gs", import.meta.url), "utf8");
const setup = fs.readFileSync(new URL("../apps-script/Setup.gs", import.meta.url), "utf8");
const historical = fs.readFileSync(new URL("../apps-script/HistoricalImport.gs", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../netlify/functions/historical-migration-background.mjs", import.meta.url), "utf8");

test("setupProject preserva abas auxiliares desconhecidas", () => {
  assert.match(setup, /isDisposableDefaultSheet_/);
  assert.doesNotMatch(setup, /expectedNames\.indexOf\(sheet\.getName\(\)\) === -1/);
});

test("migração histórica possui guarda de campanha e preserva outras campanhas", () => {
  assert.match(historical, /HISTORICAL_IMPORT_CAMPAIGN_ID/);
  assert.match(historical, /historicalDeleteCampaignRows_/);
  assert.match(historical, /String\(row\.CAMPAIGN_ID \|\| ''\) === HISTORICAL_IMPORT_CAMPAIGN_ID/);
  assert.doesNotMatch(historical, /clearContent\(\)/);
});

test("ações temporárias estão explicitamente roteadas", () => {
  for (const action of ["reset", "campaign", "addresses", "lot", "tracking", "events", "finance", "finalize"]) {
    assert.match(api, new RegExp(`'historical\\.${action}'`));
  }
});

test("função de migração usa arquivo privado do Drive e valida totais", () => {
  assert.match(background, /ARCHIVE_FILE_ID/);
  assert.match(background, /addresses: 9999/);
  assert.match(background, /objects: 5368/);
  assert.match(background, /tracking: 2353/);
  assert.match(background, /financePostings: 1062/);
  assert.doesNotMatch(background, /encryptedMigrationPayload/);
});
