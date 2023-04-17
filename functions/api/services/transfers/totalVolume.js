const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');

const {
  get_others_version_chain_ids,
} = require('./utils');
const {
  read,
} = require('../index');

const environment = process.env.ENVIRONMENT || config?.environment;

const assets_data = require('../../data')?.assets?.[environment] || [];

module.exports = async (
  params = {},
) => {
  let response;

  const {
    sourceChain,
    destinationChain,
    asset,
  } = { ...params };
  let {
    fromTime,
    toTime,
    query,
  } = { ...params };

  let must = [];
  let should = [];
  let must_not = [];

  if (sourceChain) {
    must.push({ match_phrase: { 'send.original_source_chain': sourceChain } });

    for (const id of get_others_version_chain_ids(sourceChain)) {
      must_not.push({ match_phrase: { 'send.original_source_chain': id } });
      must_not.push({ match_phrase: { 'send.source_chain': id } });
    }
  }

  if (destinationChain) {
    must.push({ match_phrase: { 'send.original_destination_chain': destinationChain } });

    for (const id of get_others_version_chain_ids(destinationChain)) {
      must_not.push({ match_phrase: { 'send.original_destination_chain': id } });
      must_not.push({ match_phrase: { 'send.destination_chain': id } });
    }
  }

  if (asset) {
    if (asset.endsWith('-wei') && assets_data.findIndex(a => a?.id === `w${asset}`) > -1) {
      must.push(
        {
          bool: {
            should: [
              { match_phrase: { 'send.denom': asset } },
              {
                bool: {
                  must: [
                    { match_phrase: { 'send.denom': `w${asset}` } },
                  ],
                  should: [
                    { match: { type: 'wrap' } },
                    { match: { type: 'unwrap' } },
                    { match: { type: 'erc20_transfer' } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
            minimum_should_match: 1,
          },
        }
      );
    }
    else {
      must.push({ match_phrase: { 'send.denom': asset } });
    }
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime = toTime ? Number(toTime) * 1000 : moment().valueOf();

    must.push({ range: { 'send.created_at.ms': { gte: fromTime, lte: toTime } } });
  }

  if (!query) {
    query = {
      bool: {
        must,
        should,
        must_not,
        minimum_should_match: should.length > 0 ? 1 : 0,
      },
    };
  }

  const _response =
    await read(
      'cross_chain_transfers',
      {
        ...query,
        bool: {
          ...query.bool,
          should:
            _.concat(
              query.bool?.should || [],
              { exists: { field: 'confirm' } },
              { exists: { field: 'vote' } },
            ),
          minimum_should_match: 1,
        },
      },
      {
        aggs: {
          volume: {
            sum: {
              field: 'send.value',
            },
          },
        },
        size: 0,
      },
    );

  const {
    aggs,
  } = { ..._response };

  const {
    volume,
  } = { ...aggs };

  const {
    value,
  } = { ...volume };

  response = value;

  return response;
};