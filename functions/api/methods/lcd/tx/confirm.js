const moment = require('moment');

const { write } = require('../../../services/index');
const { POLL_COLLECTION, getChainKey } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { toArray, toJson, toHex } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  let updated = false;

  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { txhash, height, timestamp, logs } = { ...tx_response };

  if (messages && logs) {
    updated = (await Promise.all(
      messages.map((m, i) =>
        new Promise(
          async resolve => {
            const { chain, tx_id } = { ...m };
            const { attributes } = { ...toArray(logs[i]?.events).find(e => ['ConfirmKeyTransferStarted', 'ConfirmGatewayTxStarted', 'ConfirmGatewayTxsStarted'].findIndex(s => e.type?.includes(s)) > -1) };
            let { poll_id, participants } = { ...toJson(toArray(attributes).find(a => a.key === 'participants')?.value) };
            let poll_mappings;
            if (!poll_id) {
              participants = participants || toJson(toArray(attributes).find(a => a.key === 'participants')?.value);
              poll_mappings = toJson(toArray(attributes).find(a => a.key === 'poll_mappings')?.value);
              poll_id = _.head(poll_mappings)?.poll_id;
            }
            else if (tx_id) {
              poll_mappings = [{ tx_id, poll_id }];
            }
            let _updated;
            if (toArray(poll_mappings).length > 0) {
              for (const data of poll_mappings) {
                const { tx_id, poll_id } = { ...data };
                if (poll_id && tx_id) {
                  await write(
                    POLL_COLLECTION,
                    poll_id,
                    {
                      id: poll_id,
                      height: Number(height),
                      created_at: getGranularity(moment(timestamp).utc()),
                      initiated_txhash: txhash,
                      sender_chain: getChainKey(chain),
                      transaction_id: toHex(tx_id),
                      participants: participants || undefined,
                    },
                    true,
                  );
                }
              }
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