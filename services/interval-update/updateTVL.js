const _ = require('lodash');

const { getTVL } = require('../../methods');
const { getAssetsList, getITSAssets } = require('../../utils/config');
const { toArray } = require('../../utils/parser');

module.exports = async params => {
  const { id } = { ...params };
  return Object.fromEntries(await Promise.all(toArray(_.concat(await getAssetsList(), await getITSAssets())).filter(d => !id || d.id === id).map(d =>
    new Promise(async resolve => resolve([d.id, await getTVL({ asset: d.id, force_update: true })]))
  )));
};