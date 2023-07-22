const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  const { status } = { ...params };
  const response = await searchTransfers({ ...params, status: status || 'confirmed', aggs: { fee: { sum: { field: 'send.fee_value' } } }, size: 0 });
  const { aggs } = { ...response };
  const { fee } = { ...aggs };
  const { value } = { ...fee };
  return value;
};