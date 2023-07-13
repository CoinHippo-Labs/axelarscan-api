const moment = require('moment');

const rpc = require('../rpc');
const { deleteByQuery } = require('../../services/index');
const { BLOCK_COLLECTION, LCD_CACHE_COLLECTION } = require('../../utils/config');

const COLLECTIONS = [BLOCK_COLLECTION];
const CACHE_COLLECTIONS = [LCD_CACHE_COLLECTION];
const NUM_BLOCKS_STORE = 100000;
const CACHE_AGE_SECONDS = 300;

module.exports = async () => {
  if (COLLECTIONS.length > 0) {
    const response = await rpc('/status');
    let { latest_block_height } = { ...response };
    latest_block_height = Number(latest_block_height);
    if (latest_block_height > NUM_BLOCKS_STORE) {
      for (const collection of COLLECTIONS) {
        await deleteByQuery(collection, { range: { height: { lt: latest_block_height - NUM_BLOCKS_STORE } } });
      }
    }
  }
  for (const collection of CACHE_COLLECTIONS) {
    await deleteByQuery(collection, { range: { updated_at: { lt: moment().subtract(CACHE_AGE_SECONDS, 'seconds').unix() } } });
  }
  return;
};