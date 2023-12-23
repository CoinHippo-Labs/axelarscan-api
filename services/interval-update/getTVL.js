const { getTVL } = require('../../methods');
const { getAssetsList } = require('../../utils/config');

module.exports = async params => {
  const { id } = { ...params };
  return Object.fromEntries(await Promise.all((await getAssetsList()).filter(d => !id || d.id === id).map(d =>
    new Promise(async resolve => resolve([id.d, await getTVL({ asset: d.id, force_update: true })]))
  )));
};