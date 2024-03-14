const { aggregate } = require('./utils');
const { getAssetsList, getLCD } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');
const { bech32ToBech32, toArray } = require('../../../utils/parser');

module.exports = async params => {
  let { address, assetsData } = { ...params };
  if (!address?.startsWith('axelar')) return;
  const prefix = 'axelarvaloper';
  if (!address.startsWith(prefix)) {
    try {
      address = bech32ToBech32(address, prefix);
    } catch (error) {
      return;
    }
  }

  const { commission } = { ...await request(createInstance(getLCD(), { gzip: true }), { path: `/cosmos/distribution/v1beta1/validators/${address}/commission` }) };
  assetsData = assetsData || (commission ? await getAssetsList() : undefined);
  return await aggregate(toArray(commission?.commission), assetsData);
};