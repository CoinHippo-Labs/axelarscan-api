const searchTransfers = require('../searchTransfers');

module.exports = async params => {
  let { status } = { ...params };
  status = status || 'confirmed';
  const response = await searchTransfers({ ...params, status, aggs: { users: { cardinality: { field: 'send.sender_address.keyword' } } }, size: 0 }, `transfersTotalActiveUsers_status_${status}`);
  const { aggs } = { ...response };
  const { users } = { ...aggs };
  const { value } = { ...users };
  return value;
};