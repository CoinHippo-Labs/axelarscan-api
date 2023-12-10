const { getAddress } = require('ethers');
const _ = require('lodash');

const searchTransfers = require('../searchTransfers');
const { toArray } = require('../../../utils');

module.exports = async params => {
  let output;

  const { orderBy } = { ...params };
  let { size } = { ...params };
  size = size || 65535;
  if (params) {
    delete params.orderBy;
    delete params.size;
  }

  const response = await searchTransfers(
    {
      ...params,
      aggs: {
        users: {
          terms: { field: 'send.sender_address.keyword', size },
          ...(orderBy === 'volume' ? { aggs: { volume: { sum: { field: 'send.value' } }, volume_sort: { bucket_sort: { sort: [{ volume: { order: 'desc' } }] } } } } : { aggs: { volume: { sum: { field: 'send.value' } } } }),
        },
      },
      size: 0,
    },
    `transfersTopUsers_size_${size}_${orderBy}`,
  );
  const { aggs } = { ...response };
  const { users } = { ...aggs };
  const { buckets } = { ...users };

  if (buckets) {
    output = {
      data: _.orderBy(
        toArray(buckets).map(d => {
          const { volume, doc_count } = { ...d };
          let { key } = { ...d };
          try {
            key = key?.startsWith('0x') ? getAddress(key) : key;
          } catch (error) {}
          return {
            key,
            num_txs: doc_count,
            volume: volume?.value || 0,
          };
        }),
        [orderBy || 'num_txs'], ['desc'],
      ),
    };
    output = { ...output, total: output.data.length };
  }
  else {
    output = response;
  }

  return output;
};
