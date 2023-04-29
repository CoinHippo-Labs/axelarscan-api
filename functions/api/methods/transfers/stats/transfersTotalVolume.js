const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  const {
    status,
  } = { ...params };

  const response = await searchTransfers({ ...params, status: status || 'confirmed', aggs: { volume: { sum: { field: 'send.value' } } }, size: 0 });

  const {
    aggs,
  } = { ...response };

  const {
    volume,
  } = { ...aggs };

  const {
    value,
  } = { ...volume };

  return value;
};