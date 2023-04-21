const generateQuery = require('./generateQuery');
const generateReadParams = require('./generateReadParams');
const search = require('./search');
const updateWraps = require('./updateWraps');
const {
  WRAP_COLLECTION,
} = require('../../../../utils/config');

module.exports = async (
  params = {},
) => {
  let output;

  const query = generateQuery(params);
  const _params = generateReadParams(params);

  // search data
  output = await search(WRAP_COLLECTION, query, _params);

  if (await updateWraps(WRAP_COLLECTION, output?.data, params)) {
    output = await search(WRAP_COLLECTION, query, _params, 0.5 * 1000);
  }

  return output;
};