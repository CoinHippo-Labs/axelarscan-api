const _ = require('lodash');

const lcd = require('../../lcd');
const { numberFormatUnits } = require('../../../utils/number');
const { toArray } = require('../../../utils');

module.exports = async params => {
  const { address } = { ...params };
  let data;
  let page_key = true;
  while (page_key) {
    const response = await lcd(`/cosmos/staking/v1beta1/delegators/${address}/redelegations`, { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
    const { redelegation_responses, pagination } = { ...response };
    data = _.concat(
      toArray(data),
      toArray(redelegation_responses).flatMap(d => {
        const { redelegation } = { ...d };
        const { entries, validator_src_address, validator_dst_address } = { ...redelegation };
        return toArray(entries).map(e => {
          const { creation_height } = { ...e };
          let { initial_balance, shares_dst } = { ...e };
          initial_balance = numberFormatUnits(initial_balance);
          shares_dst = numberFormatUnits(shares_dst);
          return {
            ...redelegation,
            entries: undefined,
            ...e,
            creation_height: Number(creation_height),
            initial_balance,
            shares_dst,
            amount: shares_dst - initial_balance,
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