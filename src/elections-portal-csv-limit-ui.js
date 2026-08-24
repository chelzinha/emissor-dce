export const PORTAL_CSV_MAX_ROWS = 1000;

function normalizeCsvLines(content) {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

export function splitPortalCsv(content, fileName, maxRows = PORTAL_CSV_MAX_ROWS) {
  const lines = normalizeCsvLines(content);
  if (!lines.length) throw new Error('O CSV do Portal está vazio.');
  const header = lines[0];
  const rows = lines.slice(1);
  if (!rows.length) throw new Error('O CSV do Portal não possui cadastros.');
  const limit = Math.max(1, Number(maxRows || PORTAL_CSV_MAX_ROWS));
  const totalParts = Math.ceil(rows.length / limit);
  const originalName = String(fileName || 'portal_postal.csv');
  const baseName = originalName.replace(/\.csv$/i, '') || 'portal_postal';

  return Array.from({ length: totalParts }, (_, index) => {
    const start = index * limit;
    const partRows = rows.slice(start, start + limit);
    const suffix = totalParts > 1
      ? `_parte_${String(index + 1).padStart(2, '0')}_de_${String(totalParts).padStart(2, '0')}`
      : '';
    return {
      index: index + 1,
      totalParts,
      count: partRows.length,
      startRow: start + 1,
      endRow: start + partRows.length,
      fileName: `${baseName}${suffix}.csv`,
      content: `${header}\r\n${partRows.join('\r\n')}\r\n`,
    };
  });
}
