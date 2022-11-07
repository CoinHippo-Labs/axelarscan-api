const _ = require('lodash');
const moment = require('moment');
const {
  write,
} = require('../../index');
const rpc = require('../../rpc');

module.exports = async (
  lcd_response = {},
) => {
  let response;

  const {
    block,
    block_id,
  } = { ...lcd_response };
  const {
    header,
    data,
    last_commit,
  } = { ...block };
  const {
    height,
  } = { ...header };
  const {
    txs,
  } = { ...data };
  const {
    hash,
  } = { ...block_id };

  await write(
    'blocks',
    height,
    {
      ...header,
      hash,
      num_txs: txs?.length,
    },
  );

  if (last_commit) {
    const {
      height,
      signatures,
    } = { ...last_commit };

    if (
      height &&
      signatures
    ) {
      const {
        timestamp,
      } = { ..._.head(signatures) };

      await write(
        'uptimes',
        height,
        {
          height: Number(height),
          timestamp:
            moment(timestamp)
              .valueOf(),
          validators:
            signatures
              .map(s =>
                s?.validator_address
              ),
        },
      );
    }
  }

  const _response =
    await rpc(
      '/block_results',
      {
        height,
      },
    );

  const {
    begin_block_events,
    end_block_events,
  } = { ..._response };

  response = {
    ...lcd_response,
    begin_block_events,
    end_block_events,
  };

  return response;
};