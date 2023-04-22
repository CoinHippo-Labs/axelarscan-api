const _ = require('lodash');
const moment = require('moment');

const {
  write,
} = require('../../../services/index');
const {
  HEARTBEAT_COLLECTION,
} = require('../../../utils/config');
const {
  toArray,
} = require('../../../utils');

const NUM_BLOCKS_PER_HEARTBEAT = 50;
const FRACTION_HEARTBEAT_BLOCK = 1;

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx,
    tx_response,
  } = { ...lcd_response };

  const {
    body,
    signatures,
  } = { ...tx };

  const {
    messages,
  } = { ...body };

  const {
    txhash,
    height,
    timestamp,
  } = { ...tx_response };

  const sender = _.head(toArray(messages).map(m => m.sender));
  const period_height = height - ((height % NUM_BLOCKS_PER_HEARTBEAT) || NUM_BLOCKS_PER_HEARTBEAT) + FRACTION_HEARTBEAT_BLOCK;

  if (sender && period_height) {
    await write(
      HEARTBEAT_COLLECTION,
      [sender, period_height].join('_'),
      {
        txhash,
        height,
        period_height,
        timestamp: moment(timestamp).utc().valueOf(),
        signatures,
        sender,
        key_ids: _.uniq(toArray(toArray(messages).flatMap(m => m.inner_message?.key_ids))),
      },
    );
  }
};