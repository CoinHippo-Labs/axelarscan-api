const {
  read,
} = require('../../../services/index');
const {
  sleep,
} = require('../../../utils');

module.exports = async (
  collection,
  query,
  params,
  delay_ms = 0,
) => {
  await sleep(delay_ms);
  return await read(collection, query, params);
};