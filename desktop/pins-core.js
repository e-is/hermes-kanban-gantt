// src/core/pins-core.ts
function togglePin(pins, slug, pinned) {
  if (!slug) {
    return [...pins];
  }
  const has = pins.includes(slug);
  if (pinned === has) {
    return [...pins];
  }
  return pinned ? [...pins, slug] : pins.filter((item) => item !== slug);
}
function movePin(pins, slug, target) {
  const next = [...pins];
  const from = next.indexOf(slug);
  const to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) {
    return next;
  }
  next.splice(from, 1);
  next.splice(to, 0, slug);
  return next;
}
function normalizePins(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return [...new Set(raw.filter((item) => typeof item === "string" && item.length > 0))];
}
export {
  movePin,
  normalizePins,
  togglePin
};
