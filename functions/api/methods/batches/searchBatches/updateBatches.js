const _ = require('lodash');
const moment = require('moment');

const lcd = require('../../lcd');
const { toArray } = require('../../../utils');

const MAX_CREATED_AT_TIME_DIFF_DAYS = 7;

module.exports = async data => {
  let updated;

  if (toArray(data).length > 0) {
    updated = toArray(
      await Promise.all(
        toArray(data).map(d =>
          new Promise(
            async resolve => {
              const { chain, batch_id, status, commands } = { ...d };
              const { ms } = { ...d.created_at };
              const created_at = ms ? moment(ms).unix() : undefined;
              switch (status) {
                case 'BATCHED_COMMANDS_STATUS_SIGNED':
                case 'BATCHED_COMMANDS_STATUS_SIGNING':
                  if (moment().diff(moment(ms), 'days', true) < MAX_CREATED_AT_TIME_DIFF_DAYS) {
                    if (toArray(commands).filter(c => !c.executed).length > 0 || toArray(commands).filter(c => 'executed' in c).length < 1) {
                      const updated_batch = await lcd(`/axelar/evm/v1beta1/batched_commands/${chain}/${batch_id}`, { index: true, created_at });
                      resolve(!_.isEqual(d, updated_batch));
                    }
                  }
                default:
                  resolve(false);
                  break;
              }
            }
          )
        )
      )
    ).length > 0;
  }

  return updated;
};