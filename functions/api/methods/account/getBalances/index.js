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
    const response = await lcd(`/cosmos/bank/v1beta1/balances/${address}`, { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
  
    const {
      balances,
      pagination,
    } = { ...response };

    data = _.uniqBy(
      _.concat(
        toArray(data),
        toArray(balances).map(d => {
          const {
            denom,
            amount,
          } = { ...d };

          const asset_data = getAssetData(denom);

          const {
            symbol,
            decimals,
          } = { ...asset_data };

          d.symbol = symbol;
          d.amount = numberFormatUnits(amount, decimals);
          d.asset_data = asset_data;

          return d;
        }),
      ),
      'denom',
    );

    page_key = pagination?.next_key;
  }

  return {
    data: toArray(data),
    total: toArray(data).length,
  };
};