const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const {
  UPTIME_COLLECTION,
} = require('../../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);

  // search data
  output = await search(UPTIME_COLLECTION, query, _params);

  return output;
};