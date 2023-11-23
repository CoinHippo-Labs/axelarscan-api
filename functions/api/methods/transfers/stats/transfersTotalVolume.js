const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  let { status } = { ...params };
  status = status || 'confirmed';
  const response = await searchTransfers({ ...params, status, aggs: { volume: { sum: { field: 'send.value' } } }, size: 0 }, `transfersTotalVolume_status_${status}`);
  const { aggs } = { ...response };
  const { volume } = { ...aggs };
  const { value } = { ...volume };
  return value;
};