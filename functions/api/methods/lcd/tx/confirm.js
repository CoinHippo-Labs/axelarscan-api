const moment = require('moment');

const {
  write,
} = require('../../../services/index');
const {
  POLL_COLLECTION,
  getChainKey,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const {
  toArray,
  toJson,
  toHex,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx,
    tx_response,
  } = { ...lcd_response };

  const {
    messages,
  } = { ...tx?.body };

  const {
    height,
    timestamp,
    logs,
  } = { ...tx_response };

  if (messages && logs) {
    updated =
      (await Promise.all(
        messages.map((m, i) =>
          new Promise(
            async resolve => {
              const {
                chain,
                tx_id,
              } = { ...m };

              const {
                attributes,
              } = { ...toArray(logs[i]?.events).find(e => ['ConfirmKeyTransferStarted', 'ConfirmGatewayTxStarted'].findIndex(s => e.type?.includes(s)) > -1) };

              const {
                poll_id,
                participants,
              } = { ...toJson(toArray(attributes).find(a => a.key === 'participants')?.value) };

              let _updated;

              if (poll_id && tx_id) {
                await write(
                  POLL_COLLECTION,
                  poll_id,
                  {
                    id: poll_id,
                    height: Number(height),
                    created_at: getGranularity(moment(timestamp).utc()),
                    sender_chain: getChainKey(chain),
                    transaction_id: toHex(tx_id),
                    participants: participants || undefined,
                  },
                  true,
                );
                _updated = true;
              }

              resolve(_updated);
            }
          )
        )
      )).length > 0;
  }

  return updated;
};