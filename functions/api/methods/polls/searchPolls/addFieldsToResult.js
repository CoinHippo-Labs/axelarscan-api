const _ = require('lodash');

const { getChainData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { toArray } = require('../../../utils');

module.exports = data => {
  const { prefix_address } = { ...getChainData('axelarnet') };
  return toArray(data).map(d => {
    let { created_at, updated_at } = { ...d };
    const votes = toArray(Object.entries({ ...d }).filter(([k, v]) => k.startsWith(prefix_address)).map(([k, v]) => v));
    created_at = getGranularity(_.minBy(votes, 'created_at')?.created_at) || created_at;
    updated_at = getGranularity(_.maxBy(votes, 'created_at')?.created_at) || updated_at || created_at;
    return { ...d, created_at, updated_at };
  });
};