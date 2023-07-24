const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  const { status } = { ...params };
  const response = await searchTransfers({ ...params, status: status || 'confirmed', aggs: { users: { cardinality: { field: 'send.sender_address.keyword' } } }, size: 0 });
  const { aggs } = { ...response };
  const { users } = { ...aggs };
  const { value } = { ...users };
  return value;
};