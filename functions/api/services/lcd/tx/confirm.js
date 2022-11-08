const moment = require('moment');
const {
  write,
} = require('../../index');
const {
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      height,
      timestamp,
      logs,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (message) {
        const {
          chain,
          tx_id,
        } = { ...message };

        const created_at =
          moment(timestamp)
            .utc()
            .valueOf();

        const {
          events,
        } = { ...logs?.[i] };

        const event = (events || [])
          .find(e =>
            [
              'ConfirmKeyTransferStarted',
              'ConfirmGatewayTxStarted',
            ].findIndex(s =>
              e?.type?.includes(s)
            ) > -1
          );

        const {
          attributes,
        } = { ...event };

        const {
          poll_id,
          participants,
        } = {
          ...to_json(
            (attributes || [])
              .find(a =>
                a?.key === 'participants'
              )?.value
          ),
        };

        let transaction_id = tx_id;

        transaction_id =
          Array.isArray(transaction_id) ?
            to_hex(transaction_id) :
            transaction_id;

        if (
          poll_id &&
          transaction_id
        ) {
          await write(
            'evm_polls',
            poll_id,
            {
              id: poll_id,
              height,
              created_at: get_granularity(created_at),
              sender_chain: normalize_chain(chain),
              transaction_id,
              participants:
                participants ||
                undefined,
            },
          );

          updated = true;
        }
      }
    }
  } catch (error) {}

  return updated;
};