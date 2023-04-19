const _ = require('lodash');
const moment = require('moment');

const {
  write,
} = require('../../../services/index');
const {
  UPTIME_COLLECTION,
} = require('../../../utils/config');
const {
  toArray,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  const {
    block,
  } = { ...lcd_response };

  const {
    last_commit,
  } = { ...block };

  const {
    height,
    signatures,
  } = { ...last_commit };

  if (height && signatures) {
    const {
      timestamp,
    } = { ..._.head(signatures) };

    await write(
      UPTIME_COLLECTION,
      height,
      {
        height: Number(height),
        timestamp: moment(timestamp).valueOf(),
        validators: toArray(signatures).map(s => s.validator_address),
      },
    );
  }

  return lcd_response;
};