const {
  formatUnits,
} = require('ethers');

const lcd = require('../lcd');
const {
  getAssetData,
} = require('../../utils/config');

module.exports = async (
  params = {},
) => {
  const {
    asset,
  } = { ...params };

  const asset_data = getAssetData(asset || 'uaxl');

  const {
    decimals,
    addresses,
  } = { ...asset_data };

  const {
    ibc_denom,
  } = { ...addresses?.axelarnet };

  const response = ibc_denom && await lcd(`/cosmos/bank/v1beta1/supply/${ibc_denom}`);

  const {
    amount,
  } = { ...response?.amount };

  return !isNaN(amount) && decimals ? Number(formatUnits(BigInt(amount), decimals)) : response;
};