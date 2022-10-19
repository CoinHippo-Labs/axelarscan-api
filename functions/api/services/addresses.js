const _ = require('lodash');
const config = require('config-yml');
const {
  read,
} = require('./index');
const rpc = require('./rpc');
const {
  equals_ignore_case,
} = require('../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');

module.exports = async (
  params = {},
) => {
  let {
    blocks_per_query,
  } = { ...params };

  blocks_per_query =
    Number(blocks_per_query) ||
    250000;

  const status = await rpc(
    '/status',
  );

  let {
    earliest_block_height,
    latest_block_height,
  } = { ...status };

  earliest_block_height = Number(earliest_block_height);
  latest_block_height = Number(latest_block_height);

  status.earliest_block_height = earliest_block_height;
  status.latest_block_height = latest_block_height;

  let data;

  if (
    typeof earliest_block_height === 'number' &&
    typeof latest_block_height === 'number' &&
    earliest_block_height < latest_block_height
  ) {
    for (let i = earliest_block_height; i <= latest_block_height; i += blocks_per_query) {
      const from_height = i > latest_block_height ?
        latest_block_height :
        i;
      const to_height = from_height + blocks_per_query;

      const _response = await read(
        'txs',
        {
          range: {
            height: {
              gte: from_height,
              lt: to_height,
            },
          },
        },
        {
          aggs: {
            addresses: {
              terms: {
                field: 'addresses.keyword',
                size: 65535,
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
        buckets,
      } = { ...aggs?.addresses };

      data = _.uniqBy(
        _.concat(
          (buckets || [])
            .filter(d =>
              d?.key?.startsWith(`${axelarnet.prefix_address}1`) &&
              d.key.length < 65 &&
              d.doc_count
            )
            .map(d => {
              const {
                key,
                doc_count,
              } = { ...d };

              const _num_txs =
                data?.find(_d =>
                  equals_ignore_case(_d.address, key)
                )?.num_txs ||
                0;

              return {
                address: key.toLowerCase(),
                num_txs: doc_count + _num_txs,
              };
            }),
          data ||
          [],
        ),
        'address',
      );
    }
  }

  return {
    status,
    total:
      data?.length ||
      0,
    data,
  };
};