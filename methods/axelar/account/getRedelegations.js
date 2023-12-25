const _ = require('lodash');

const { getLCD } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');
const { toArray } = require('../../../utils/parser');
const { toNumber, formatUnits } = require('../../../utils/number');

module.exports = async params => {
  const { address } = { ...params };
  if (!address?.startsWith('axelar')) return;

  let data = [];
  let nextKey = true;
  while (nextKey) {
    const { redelegation_responses, pagination } = { ...await request(createInstance(getLCD(), { gzip: true }), { path: `/cosmos/staking/v1beta1/delegators/${address}/redelegations`, params: { 'pagination.key': nextKey && typeof nextKey !== 'boolean' ? nextKey : undefined } }) };
    data = _.orderBy(_.concat(toArray(data), toArray(redelegation_responses).flatMap(d => {
      const { redelegation } = { ...d };
      const { entries } = { ...redelegation };

      return toArray(entries).map(e => {
        const { creation_height } = { ...e };
        let { initial_balance, shares_dst } = { ...e };
        initial_balance = formatUnits(initial_balance, 6);
        shares_dst = formatUnits(shares_dst, 6);
        return { ...redelegation, entries: undefined, ...e, creation_height: toNumber(creation_height), initial_balance, shares_dst, amount: shares_dst - initial_balance };
      });
    })), ['creation_height', 'amount'], ['desc', 'desc']);
    nextKey = pagination?.next_key;
  }
  return { data, total: data.length };
};