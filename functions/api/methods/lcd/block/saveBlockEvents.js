const rpc = require('../../rpc');
const { saveGMP } = require('../../gmp');
const { toArray, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { block } = { ...lcd_response };
  const { header } = { ...block };
  const { height } = { ...header };

  if (height) {
    const { end_block_events } = { ...await rpc('/block_results', { height }) };
    const no_confirmed_events = toArray(end_block_events).filter(e => e.type?.includes('NoEventsConfirmed') && toArray(e.attributes).findIndex(a => ['tx_id'].includes(a.key)) > -1);
    for (const event of no_confirmed_events) {
      const { attributes } = { ...event };
      const { chain, poll_id, tx_id } = { ...Object.fromEntries(toArray(attributes).map(a => [a.key, typeof a.value === 'string' ? normalizeQuote(a.value) : a.value])) };
      await saveGMP(
        {
          event: 'confirm_failed',
          sourceTransactionHash: tx_id,
          poll_id,
          blockNumber: height,
          source_chain: chain,
        },
        chain,
      );
    }
  }
  return lcd_response;
};