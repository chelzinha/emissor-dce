export function clientTrackingSegments(bucket = {}) {
  const delivered = Math.max(0, Number(bucket.delivered || 0));
  const movement = Math.max(0, Number(bucket.inTransit || 0) + Number(bucket.outForDelivery || 0));
  const attention = Math.max(0, Number(bucket.exception || 0) + Number(bucket.returning || 0) + Number(bucket.returned || 0) + Number(bucket.unknown || 0));
  const awaiting = Math.max(0, Number(bucket.awaitingUpdate || 0));
  const total = Math.max(0, Number(bucket.posted || 0), delivered + movement + attention + awaiting);
  const counts = { delivered, movement, attention, awaiting };
  if (!total) return { total: 0, counts, percentages: { delivered: 0, movement: 0, attention: 0, awaiting: 0 } };
  const raw = {
    delivered: delivered / total * 100,
    movement: movement / total * 100,
    attention: attention / total * 100,
    awaiting: awaiting / total * 100,
  };
  const percentages = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.floor(value)]));
  let missing = 100 - Object.values(percentages).reduce((sum, value) => sum + value, 0);
  Object.keys(raw).sort((a, b) => (raw[b] - percentages[b]) - (raw[a] - percentages[a])).forEach((key) => {
    if (missing > 0) { percentages[key] += 1; missing -= 1; }
  });
  return { total, counts, percentages };
}
