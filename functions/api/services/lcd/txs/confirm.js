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
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const records = tx_responses
      .filter(t =>
        !t?.code &&
        [
          'ConfirmTransferKey',
          'ConfirmGatewayTx',
        ].findIndex(s =>
          (t?.tx?.body?.messages || [])
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      )
      .flatMap(t => {
        const {
          timestamp,
          tx,
          logs,
        } = { ...t };
        let {
          height,
        } = { ...t };
        const {
          messages,
        } = { ...tx?.body };

        height = Number(height);

        const _records = [];

        if (messages) {
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
                const record = {
                  height,
                  created_at: get_granularity(created_at),
                  sender_chain: normalize_chain(chain),
                  poll_id,
                  transaction_id,
                  participants,
                };

                _records.push(record);
              }
            }
          }
        }

        return _records;
      })
      .filter(t =>
        t.poll_id &&
        t.transaction_id
      );

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      const {
        height,
        created_at,
        sender_chain,
        poll_id,
        transaction_id,
        participants,
      } = { ...record };

      const data = {
        id: poll_id,
        height,
        created_at,
        sender_chain,
        transaction_id,
        participants:
          participants ||
          undefined,
      };

      if (
        i === 0 ||
        i === records.length - 1
      ) {
        await write(
          'evm_polls',
          poll_id,
          data,
          true,
        );
      }
      else {
        write(
          'evm_polls',
          poll_id,
          data,
          true,
        );
      }
    }
  } catch (error) {}
};