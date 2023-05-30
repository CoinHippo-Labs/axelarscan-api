const _ = require('lodash');

const { getChains } = require('../config');
const { equalsIgnoreCase, split, find } = require('../');

const getOthersChainIds = chain => {
  const chains = Object.keys(getChains());
  const id = find(chain, chains);
  const [_id, version] = split(chain, 'lower', '-');

  return (
    _.concat(
      chains.filter(c => !equalsIgnoreCase(c, id) && c.startsWith(id)),
      version && chains.filter(c => (!equalsIgnoreCase(c, id) && c.startsWith(_id)) || (!c.startsWith(_id) && c.includes(`-${version}`))),
    )
    .filter(c => c && !version)
  );
};

module.exports = {
  getOthersChainIds,
};