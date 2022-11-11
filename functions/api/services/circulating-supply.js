const moment = require('moment');
const config = require('config-yml');
const total_supply = require('./total-supply');
const {
  equals_ignore_case,
} = require('../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  supply,
} = { ...config?.[environment] };
const {
  max_supply,
  initial_unlocked_percent,
} = { ...supply };

const asset = 'uaxl';

const calculate_vesting = config => {
  const {
    total_unlock_percent,
    vesting_period,
    vesting_start,
    vesting_until,
  } = { ...config };

  const total =
    max_supply *
    total_unlock_percent /
    100;

  const current_time = moment();

  const vesting_start_time =
    moment(
      vesting_start,
      'YYYY-MM-DD',
    )
    .startOf('day');

  const vesting_until_time =
    moment(
      vesting_until,
      'YYYY-MM-DD',
    )
    .startOf('day');

  const unlocked =
    current_time.valueOf() >=
    vesting_until_time.valueOf() ?
      total :
      current_time.valueOf() <=
      vesting_start_time.valueOf() ?
        0 :
        total *
        current_time
          .diff(
            vesting_start_time,
            `${vesting_period}s`,
          ) /
        vesting_until_time
          .diff(
            vesting_start_time,
            `${vesting_period}s`,
          );

  return {
    total,
    unlocked,
    config,
  };
};

module.exports = async (
  params = {},
) => {
  let {
    debug,
  } = { ...params };

  debug =
    typeof debug === 'boolean' ?
      debug :
      equals_ignore_case(
        debug,
        'true',
      );

  const current_total_supply =
    await total_supply(
      {
        asset,
      },
    );

  const inflation_rewards =
    typeof current_total_supply === 'number' &&
    current_total_supply > max_supply ?
      current_total_supply - max_supply :
      0;

  const initial_unlocked =
    max_supply *
    (
      initial_unlocked_percent /
      100
    );

  const community_sale = calculate_vesting(supply?.community_sale);
  const community_programs = calculate_vesting(supply?.community_programs);
  const company_operations = calculate_vesting(supply?.company_operations);
  const backers = calculate_vesting(supply?.backers);
  const team = calculate_vesting(supply?.team);

  const circulating_supply =
    inflation_rewards +
    initial_unlocked +
    community_sale?.unlocked +
    community_programs?.unlocked +
    company_operations?.unlocked +
    backers?.unlocked +
    team?.unlocked;

  return debug ?
    {
      circulating_supply,
      inflation_rewards,
      initial_unlocked,
      community_sale,
      community_programs,
      company_operations,
      backers,
      team,
    } :
    circulating_supply;
};