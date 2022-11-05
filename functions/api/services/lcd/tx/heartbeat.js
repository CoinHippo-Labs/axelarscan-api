const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  write,
} = require('../../index');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  num_blocks_per_heartbeat,
  fraction_heartbeat_block,
} = { ...config?.[environment] };

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      height,
      timestamp,
    } = { ...tx_response };
    const {
      signatures,
    } = { ...tx };
    const {
      messages,
    } = { ...tx?.body };

    const record = {
      txhash,
      height,
      period_height:
        height -
        (
          (height % num_blocks_per_heartbeat) ||
          num_blocks_per_heartbeat
        ) +
        fraction_heartbeat_block,
      timestamp:
        moment(timestamp)
          .utc()
          .valueOf(),
      signatures,
      sender:
        _.head(
          messages
            .map(m =>
              m?.sender
            )
        ),
      key_ids:
        _.uniq(
          messages
            .flatMap(m =>
              m?.inner_message?.key_ids ||
              []
            )
        ),
    };

    const {
      sender,
      period_height,
    } = { ...record };

    if (sender) {
      await write(
        'heartbeats',
        `${sender}_${period_height}`,
        record,
      );
    }
  } catch (error) {}
};