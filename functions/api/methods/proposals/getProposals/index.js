const { formatUnits } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const lcd = require('../../lcd');
const { getAssetData } = require('../../../utils/config');
const { split, toArray } = require('../../../utils');

module.exports = async () => {
  let data;

  let page_key = true;
  while (page_key) {
    const response = await lcd('/cosmos/gov/v1beta1/proposals', { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
    const { proposals, pagination } = { ...response };

    data = _.orderBy(
      _.uniqBy(
        _.concat(
          toArray(data),
          toArray(proposals).map(d => {
            const {
              proposal_id,
              content,
              status,
              submit_time,
              deposit_end_time,
              voting_start_time,
              voting_end_time,
              total_deposit,
              final_tally_result,
            } = { ...d };
            const { plan } = { ...content };
            const { height } = { ...plan };

            d.proposal_id = Number(proposal_id);
            d.type = _.last(split(content?.['@type'], 'normal', '.'))?.replace('Proposal', '');
            d.content = { ...content, plan: plan && { ...plan, height: Number(height) } };
            d.status = status?.replace('PROPOSAL_STATUS_', '');
            d.submit_time = moment(submit_time).valueOf();
            d.deposit_end_time = moment(deposit_end_time).valueOf();
            d.voting_start_time = moment(voting_start_time).valueOf();
            d.voting_end_time = moment(voting_end_time).valueOf();
            d.total_deposit = toArray(total_deposit).map(_d => {
              const { denom, amount } = { ..._d };
              const { ymbol, decimals } = { ...getAssetData(denom) };
              return {
                ..._d,
                symbol,
                amount: formatUnits(amount, decimals || 6),
              };
            });
            d.final_tally_result = Object.fromEntries(Object.entries({ ...final_tally_result }).map(([k, v]) => [k, formatUnits(v, 6)]));

            return d;
          })
        ),
        'proposal_id',
      ),
      ['proposal_id'], ['desc'],
    );

    page_key = pagination?.next_key;
  }

  return {
    data: toArray(data),
    total: toArray(data).length,
  };
};