const { write } = require('../../../services/index');
const { BLOCK_COLLECTION } = require('../../../utils/config');
const { toArray } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { block, block_id } = { ...lcd_response };
  const { header, data } = { ...block };
  const { height } = { ...header };
  const { txs } = { ...data };
  const { hash } = { ...block_id };

  if (height && hash) {
    await write(BLOCK_COLLECTION, height, { ...header, hash, num_txs: toArray(txs).length }, false, false);
  }
  return lcd_response;
};