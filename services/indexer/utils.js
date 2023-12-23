const { equalsIgnoreCase, toBoolean } = require('../../utils/string');

const normalizeSearchObject = object => {
  try { object = JSON.parse(object); } catch (error) {}
  if (Array.isArray(object)) return object;
  return Object.fromEntries(
    Object.entries({ ...object }).map(([k, v]) => {
      switch (typeof v) {
        case 'object':
          v = normalizeSearchObject(v);
          break;
        case 'boolean':
          break;
        default:
          v = !isNaN(v) ? Number(v) : v;
          break;
      }
      return [k, v];
    })
  );
};

const normalizeSearchObjects = params => {
  if (params) {
    ['query', 'aggs', 'sort', 'fields'].forEach(f => {
      if (params[f]) params[f] = normalizeSearchObject(params[f]);
    });
  }
  return params;
};

const normalizeSearchParams = params => {
  let { path, use_raw_data, update_only, track_total_hits, height } = { ...params };
  path = path || '';
  use_raw_data = toBoolean(use_raw_data);
  update_only = toBoolean(update_only);
  track_total_hits = toBoolean(track_total_hits);
  if (!isNaN(height)) height = Number(height);
  return { ...params, path, use_raw_data, update_only, track_total_hits, height };
};

const removeFieldsFromParams = params => {
  if (params) {
    delete params.collection;
    delete params.id;
    delete params.method;
    delete params.path;
    delete params.use_raw_data;
    delete params.update_only;
    delete params.track_total_hits;
  }
  return params;
};

module.exports = {
  normalizeSearchObject,
  normalizeSearchObjects,
  normalizeSearchParams,
  removeFieldsFromParams,
};