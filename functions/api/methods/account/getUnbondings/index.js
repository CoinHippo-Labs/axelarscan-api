const _ = require('lodash');

const lcd = require('../../lcd');
const { numberFormatUnits } = require('../../../utils/number');
const { toArray } = require('../../../utils');

module.exports = async params => {
  const { address } = { ...params };
  let data;
  let page_key = true;
  while (page_key) {
    const response = await lcd(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`, { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
    const { unbonding_responses, pagination } = { ...response };
    data = _.concat(
      toArray(data),
      toArray(unbonding_responses).flatMap(d => {
        const { entries } = { ...d };
        return toArray(entries).map(e => {
          const { creation_height } = { ...e };
          let { initial_balance, balance } = { ...e };
          initial_balance = numberFormatUnits(initial_balance);
          balance = numberFormatUnits(balance);
          return {
            ...d,
            entries: undefined,
            ...e,
            creation_height: Number(creation_height),
            initial_balance,
            balance,
            amount: balance,
          };
        });
      }),
    );
    page_key = pagination?.next_key;
  }
  return {
    data: toArray(data),
    total: toArray(data).length,
  };
};