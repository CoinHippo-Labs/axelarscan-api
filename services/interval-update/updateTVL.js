const _ = require('lodash');
const moment = require('moment');

const { getTVL } = require('../../methods');
const { getAssetsList, getITSAssetsList } = require('../../utils/config');
const { toArray } = require('../../utils/parser');

module.exports = async params => {
  // run every 10 minutes
  if (moment().minutes() % 10 !== 0) return;
  const data = {};
  for (const d of toArray(_.concat(await getAssetsList(), await getITSAssetsList())).filter(d => !params?.id || d.id === params.id)) {
    data[d.id] = await getTVL({ asset: d.id, force_update: true });
  }
  return data;
};