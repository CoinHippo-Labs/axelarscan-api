const _ = require('lodash');

const { getAssets } = require('../config');
const { equalsIgnoreCase, split, toArray, find } = require('../');

const getOthersDenoms = denom => {
  const assets = Object.values(getAssets()).map(a => { return { id: a.denom, values: toArray(_.concat(a.denom, a.denoms)) }; });
  const id = find(denom, assets.map(a => a.id));
  return assets.filter(a => !equalsIgnoreCase(a.id, id) && a.values.findIndex(v => split(v, 'lower', '-').filter(s => ['wei'].includes(s)).findIndex(s => split(denom, 'lower', '-').includes(s)) > -1) > -1).flatMap(a => a.values);
};

module.exports = {
  getOthersDenoms,
};