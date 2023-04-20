const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const {
  HEARTBEAT_COLLECTION,
} = require('../../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);

  // search data
  output = await search(HEARTBEAT_COLLECTION, query, _params);

  return output;
};