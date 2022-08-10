const normalize_obj = object => Array.isArray(object) ? object : Object.fromEntries(Object.entries(object).map(([key, value]) => [key, typeof value === 'object' ? normalizeObject(value) : typeof value === 'boolean' ? value : !isNaN(value) ? Number(value) : value]));

const transfer_collections = [
  'deposit_addresses',
  'transfers',
  'batches',
  'token_sent_events',
  'ibc_channels',
  'tvls',
];

module.exports = {
  normalize_obj,
  transfer_collections,
};