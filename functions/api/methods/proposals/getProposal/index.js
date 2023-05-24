const {
  formatUnits,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const getVotes = require('./getVotes');
const lcd = require('../../lcd');
const {
  getAssetData,
} = require('../../../utils/config');
const {
  split,
  toArray,
} = require('../../../utils');

module.exports = async params => {
  const {
    id,
  } = { ...params };

  const response = await lcd(`/cosmos/gov/v1beta1/proposals/${id}`);

  const {
    proposal,
  } = { ...response };

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
  } = { ...proposal };

  const {
    plan,
  } = { ...content };

  const {
    height,
  } = { ...plan };

  const {
    data,
  } = { ...await getVotes(params) };

  return {
    proposal_id: Number(proposal_id),
    type: _.last(split(content?.['@type'], 'normal', '.'))?.replace('Proposal', ''),
    content: { ...content, plan: plan && { ...plan, height: Number(height) } },
    status: status?.replace('PROPOSAL_STATUS_', ''),
    submit_time: moment(submit_time).valueOf(),
    deposit_end_time: moment(deposit_end_time).valueOf(),
    voting_start_time: moment(voting_start_time).valueOf(),
    voting_end_time: moment(voting_end_time).valueOf(),
    total_deposit:
      toArray(total_deposit).map(_d => {
        const {
          denom,
          amount,
        } = { ..._d };

        const {
          symbol,
          decimals,
        } = { ...getAssetData(denom) };

        return {
          ..._d,
          symbol,
          amount: formatUnits(amount, decimals || 6),
        };
      }),
    final_tally_result: Object.fromEntries(Object.entries({ ...final_tally_result }).map(([k, v]) => [k, formatUnits(v, 6)])),
    votes: toArray(data),
  };
};