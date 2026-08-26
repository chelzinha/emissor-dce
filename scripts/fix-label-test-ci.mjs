import fs from 'node:fs';

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`Trecho não encontrado em ${path}`);
  fs.writeFileSync(path, source.replace(before, after), 'utf8');
}

replaceExact(
  'src/matrix-engine.js',
  '        const textCodes = trackingCodesFromText(pageText);',
  '        const textCodes = [...new Set([\n          ...trackingCodesFromText(pageText),\n          ...trackingCodesFromText(pageText.replace(/\\s/g, "")),\n        ])];'
);

replaceExact(
  'src/matrix-engine.js',
  '          if (keepCrops && (!targeted || targetCodes.has(object))) {\n            crops.set(object, selectedCrop.toDataURL("image/png"));\n          }',
  '          if (!targeted || targetCodes.has(object)) {\n            if (keepCrops) crops.set(object, selectedCrop.toDataURL("image/png"));\n          }'
);

replaceExact(
  'src/production-label-generator.js',
  '  const verified = await verifyCrops(audit.crops, ZXing);\n  const failed = verified.filter((row) => !row.ok);\n  const missing = targets.filter((code) => !audit.crops.has(code));\n  if (failed.length || missing.length) {\n    throw new Error(`${failed.length + missing.length} Data Matrix não puderam ser recuperados para a geração.`);\n  }\n  CROP_CACHE.set(cacheKey, audit.crops);\n  return audit.crops;',
  '  const textOnly = new Set(audit.audit\n    .filter((row) => row.origin === \'texto\' && targets.includes(row.object))\n    .map((row) => row.object));\n  const verified = await verifyCrops(audit.crops, ZXing);\n  const failed = verified.filter((row) => !row.ok && !textOnly.has(row.object));\n  const missing = targets.filter((code) => !audit.crops.has(code));\n  if (failed.length || missing.length) {\n    throw new Error(`${failed.length + missing.length} Data Matrix não puderam ser recuperados para a geração.`);\n  }\n  if (targets.length <= 10) CROP_CACHE.set(cacheKey, audit.crops);\n  return audit.crops;'
);

const testPath = 'tests/label-test-loop.test.mjs';
let tests = fs.readFileSync(testPath, 'utf8');
tests = tests
  .replace('/matrixCrops(portalReturnId, trackingCodes, onProgress)/', '/matrixCrops\\(portalReturnId, trackingCodes, onProgress\\)/')
  .replace('/targets.join("\\|")/', '/targets\\.join\\("\\\\|"\\)/')
  .replace('/observer?.disconnect()/', '/observer\\?\\.disconnect\\(\\)/')
  .replace('/sessionStorage.removeItem(RESUME_KEY)/', '/sessionStorage\\.removeItem\\(RESUME_KEY\\)/')
  .replace('/location.reload/', '/location\\.reload/')
  .replace('/elections-label-test-stability.js/', '/elections-label-test-stability\\.js/');
fs.writeFileSync(testPath, tests, 'utf8');
