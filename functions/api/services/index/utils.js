const {
  TRANSFER_COLLECTION,
  DEPOSIT_ADDRESS_COLLECTION,
  WRAP_COLLECTION,
  UNWRAP_COLLECTION,
  ERC20_TRANSFER_COLLECTION,
  BATCH_COLLECTION,
  COMMAND_EVENT_COLLECTION,
  IBC_CHANNEL_COLLECTION,
  TVL_COLLECTION,
  ASSET_COLLECTION,
  TOKEN_COLLECTION,
} = require('../../utils/config');

const normalizeObject = object => Array.isArray(object) ? object : Object.fromEntries(Object.entries(object).map(([k, v]) => [k, typeof v === 'object' ? normalizeObject(v) : typeof v === 'boolean' ? v : !isNaN(v) ? Number(v) : v]));

const transferCollections = [
  TRANSFER_COLLECTION,
  DEPOSIT_ADDRESS_COLLECTION,
  WRAP_COLLECTION,
  UNWRAP_COLLECTION,
  ERC20_TRANSFER_COLLECTION,
  BATCH_COLLECTION,
  COMMAND_EVENT_COLLECTION,
  IBC_CHANNEL_COLLECTION,
  TVL_COLLECTION,
  ASSET_COLLECTION,
  TOKEN_COLLECTION,
];

module.exports = {
  normalizeObject,
  transferCollections,
};