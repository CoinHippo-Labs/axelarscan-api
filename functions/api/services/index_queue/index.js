const config = require('config-yml');
const lcd = require('../lcd');
const {
  read,
} = require('../index');
const {
  sleep,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  index_queue,
} = { ...config?.[environment] };

let {
  max_index_round_count,
  concurrent_index_records,
  delay_ms_per_batch,
  max_records_synchronous,
} = { ...index_queue };

max_index_round_count =
  max_index_round_count ||
  5;
concurrent_index_records =
  concurrent_index_records ||
  10;
delay_ms_per_batch =
  delay_ms_per_batch ||
  1000;
max_records_synchronous =
  max_records_synchronous ||
  200;

module.exports = async (
  context,
  remain_ms_to_exit = 2000,
) => {
  while (
    !context ||
    context.getRemainingTimeInMillis() > remain_ms_to_exit
  ) {
    const response =
      await read(
        'txs_index_queue',
        {
          // match_all: {},
          bool: {
            should: [
              {
                bool: {
                  must_not: [
                    { exists: { field: 'count' } },
                  ],
                },
              },
              {
                range: {
                  count: {
                    lt: max_index_round_count,
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        {
          size: concurrent_index_records,
          sort: [{ updated_at: 'asc' }],
        },
      );

    const {
      total,
    } = { ...response };
    let {
      data,
    } = { ...response };

    if (Array.isArray(data)) {
      data = data
        .filter(d => d?.txhash)
        .map(d => d.txhash);
    }

    if (
      Array.isArray(data) &&
      data.length > 0
    ) {
      if (total > max_records_synchronous) {
        for (const txhash of data) {
          lcd(
            `/cosmos/tx/v1beta1/txs/${txhash}`,
          );
        }

        await sleep(delay_ms_per_batch);
      }
      else {
        for (const txhash of data) {
          await lcd(
            `/cosmos/tx/v1beta1/txs/${txhash}`,
          );
        }
      }
    }
    else {
      await sleep(delay_ms_per_batch);
    }
  }
};