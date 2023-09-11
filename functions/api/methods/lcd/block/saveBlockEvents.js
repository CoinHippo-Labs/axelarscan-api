const moment = require('moment');

const rpc = require('../../rpc');
const { saveGMP } = require('../../gmp');
const { getChainKey } = require('../../../utils/config');
const { toArray, toHex, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { block } = { ...lcd_response };
  const { header } = { ...block };
  const { time } = { ...header };
  let { height } = { ...header };

  if (height) {
    height = Number(height);
    const { end_block_events } = { ...await rpc('/block_results', { height }) };
    const no_confirmed_events = toArray(end_block_events).filter(e => e.type?.includes('NoEventsConfirmed') && toArray(e.attributes).findIndex(a => ['tx_id'].includes(a.key)) > -1);
    for (const event of no_confirmed_events) {
      const { attributes } = { ...event };
      const _attributes = Object.fromEntries(toArray(attributes).map(a => [a.key, typeof a.value === 'string' ? normalizeQuote(a.value) : a.value]));
      const { poll_id } = { ..._attributes };
      let { chain, tx_id } = { ..._attributes };
      chain = getChainKey(chain) || chain;
      tx_id = toHex(tx_id);
      await saveGMP(
        {
          event: 'confirm_failed',
          sourceTransactionHash: tx_id,
          poll_id,
          blockNumber: height,
          block_timestamp: time ? moment(time).unix() : undefined,
          source_chain: chain,
        },
        chain,
      );
    }
  }
  return lcd_response;
};