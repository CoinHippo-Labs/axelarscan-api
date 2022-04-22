const normalize_obj = object => Array.isArray(object) ? object : Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === 'object' ? normalizeObject(value) : typeof value === 'boolean' ? value : !isNaN(value) ? Number(value) : value]));

module.exports = {
  normalize_obj,
};