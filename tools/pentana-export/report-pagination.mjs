export function reportPagination(info) {
  info = info.replaceAll('\u00a0', ' ');
  const rows = info.match(/Row\s+\d+\s+of\s+(\d+)/i);
  const pages = info.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (!rows || !pages) return null;
  const result = { total: Number(rows[1]), page: Number(pages[1]), pages: Number(pages[2]) };
  if (result.page < 1 || result.pages < result.page) return null;
  return result;
}
export function loadedReportPage(info, values) {
  const page = reportPagination(info);
  if (!page) return null;
  const nonblank = values.map(value => value.trim()).filter(Boolean);
  const capacity = Math.max(values.length, Math.ceil(page.total / page.pages));
  const expected = page.pages === 1 ? page.total : Math.min(capacity, page.total - (page.page - 1) * capacity);
  if (expected < 0 || nonblank.length !== expected || new Set(nonblank).size !== nonblank.length) return null;
  return { ...page, values: nonblank, capacity };
}
