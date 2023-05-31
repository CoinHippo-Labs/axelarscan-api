const normalizeResult = require('./normalizeResult');
const rpc = require('../../rpc');

module.exports = async (lcd_response = {}) => {
  const { block } = { ...lcd_response };
  const { header } = { ...block };
  const { height } = { ...header };

  if (height) {
    const { begin_block_events, end_block_events } = { ...await rpc('/block_results', { height }) };
    lcd_response.begin_block_events = begin_block_events;
    lcd_response.end_block_events = end_block_events;
  }
  return normalizeResult(lcd_response);
};