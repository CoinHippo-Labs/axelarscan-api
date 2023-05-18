const _ = require('lodash');

const lcd = require('../../lcd');
const {
  getAssetData,
} = require('../../../utils/config');
const {
  numberFormatUnits,
} = require('../../../utils/number');
const {
  toArray,
} = require('../../../utils');

module.exports = async params => {
  const {
    address,
  } = { ...params };

  let data;
  let page_key = true;

  while (page_key) {
    const response = await lcd(`/cosmos/staking/v1beta1/delegations/${address}`, { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
  
    const {
      delegation_responses,
      pagination,
    } = { ...response };

    data = _.concat(
      toArray(data),
      toArray(delegation_responses).map(d => {
        const {
          delegation,
          balance,
        } = { ...d };

        const {
          shares,
        } = { ...delegation };

        const {
          denom,
          amount,
        } = { ...balance };

        const asset_data = getAssetData(denom);

        const {
          symbol,
          decimals,
        } = { ...asset_data };

        return {
          ...delegation,
          shares: numberFormatUnits(shares, decimals),
          ...balance,
          symbol,
          amount: numberFormatUnits(amount, decimals),
        };
      }),
    );

    page_key = pagination?.next_key;
  }

  return {
    data: toArray(data),
    total: toArray(data).length,
  };
};