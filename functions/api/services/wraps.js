const moment = require('moment');

const {
  read,
  write,
} = require('./index');
const {
  equals_ignore_case,
} = require('../utils');

module.exports = async (
  params = {},
) => {
  const {
    depositAddress,
    txHash,
    txHashWrap,
    sourceChain,
    destinationChain,
    recipientAddress,
    status,
    from,
    size,
    sort,
  } = { ...params };
  let {
    query,
    fromTime,
    toTime,
  } = { ...params };

  const must = [];
  const should = [];
  const must_not = [];

  if (depositAddress) {
    must.push({ match: { deposit_address: depositAddress } });
  }

  if (txHash) {
    must.push({ match: { tx_hash: txHash } });
  }

  if (txHashWrap) {
    must.push({ match: { tx_hash_wrap: txHashWrap } });
  }

  if (sourceChain) {
    must.push({ match: { source_chain: sourceChain } });
  }

  if (destinationChain) {
    must.push({ match: { destination_chain: destinationChain } });
  }

  if (recipientAddress) {
    must.push({ match: { recipient_address: recipientAddress } });
  }

  if (status) {
    switch (status) {
      case 'to_update':
        must.push({ exists: { field: 'tx_hash' } });
        must.push({ exists: { field: 'tx_hash_wrap' } });
        must.push({ exists: { field: 'source_chain' } });
        must.push({ exists: { field: 'destination_chain' } });
        must.push({
          bool: {
            should: [
              {
                bool: {
                  must_not: [
                    { exists: { field: 'num_update_time' } },
                  ],
                },
              },
              { range: { num_update_time: { lt: 2 } } },
            ],
            minimum_should_match: 1,
          },
        });
        break;
      default:
        break;
    }
  }

  if (fromTime) {
    fromTime = Number(fromTime) * 1000;
    toTime = toTime ? Number(toTime) * 1000 : moment().valueOf();

    must.push({ range: { 'updated_at': { gte: fromTime, lte: toTime } } });
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

  const response =
    await read(
      'wraps',
      query,
      {
        from: typeof from === 'number' ? from : 0,
        size: typeof size === 'number' ? size : 25,
        sort: sort || [{ 'updated_at': 'desc' }],
        track_total_hits: true,
      },
    );

  const {
    data,
  } = { ...response };

  if (Array.isArray(data)) {
    if (status === 'to_update') {
      for (const d of data) {
        const {
          id,
        } = { ...d };
        let {
          num_update_time,
        } = { ...d };

        num_update_time = (typeof num_update_time === 'number' ? num_update_time : -1) + 1;

        const _d = {
          ...d,
          num_update_time,
        };

        await write('wraps', id, _d, true);

        const index = data.findIndex(_d => equals_ignore_case(_d?.id, id));

        if (index > -1) {
          data[index] = _d;
        }
      }
    }

    response.data = data;
  }

  return response;
};