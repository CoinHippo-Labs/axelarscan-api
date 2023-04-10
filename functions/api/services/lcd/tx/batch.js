const moment = require('moment');
const lcd = require('../');

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_response,
  } = { ...lcd_response };

  try {
    const {
      timestamp,
      logs,
    } = { ...tx_response };

    const log = (logs || []).find(l => (l?.events || []).findIndex(e => e?.type === 'sign') > -1);

    if (log) {
      const {
        events,
      } = { ...log };

      const event = events.find(e => e?.type === 'sign');

      const {
        attributes,
      } = { ...event };

      const chain = (attributes || []).find(a => a.key === 'chain')?.value;
      const batch_id = (attributes || []).find(a => a.key === 'batchedCommandID')?.value;

      if (chain && batch_id) {
        await lcd(`/axelar/evm/v1beta1/batched_commands/${chain}/${batch_id}`, { created_at: moment(timestamp).utc().unix() });
      }
    }
  } catch (error) {}
};