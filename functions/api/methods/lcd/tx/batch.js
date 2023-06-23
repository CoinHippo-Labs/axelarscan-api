const moment = require('moment');

const lcd = require('../');
const { toArray } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { tx_response } = { ...lcd_response };
  const { timestamp, logs } = { ...tx_response };
  const { events } = { ...toArray(logs).find(l => toArray(l.events).findIndex(e => e.type === 'sign') > -1) };
  const { attributes } = { ...toArray(events).find(e => e.type === 'sign') };
  const chain = toArray(attributes).find(a => a.key === 'chain')?.value;
  const batch_id = toArray(attributes).find(a => a.key === 'batchedCommandID')?.value;
  if (chain && batch_id) {
    await lcd(`/axelar/evm/v1beta1/batched_commands/${chain}/${batch_id}`, { index: true, created_at: moment(timestamp).utc().unix() });
  }
};