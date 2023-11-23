const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  let { status } = { ...params };
  status = status || 'confirmed';
  const response = await searchTransfers({ ...params, status, aggs: { fee: { sum: { field: 'send.fee_value' } } }, size: 0 }, `transfersTotalFee_status_${status}`);
  const { aggs } = { ...response };
  const { fee } = { ...aggs };
  const { value } = { ...fee };
  return value;
};