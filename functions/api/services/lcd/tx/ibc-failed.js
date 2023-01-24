const _ = require('lodash');
const {
  read,
  write,
} = require('../../index');
const {
  save_time_spent,
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  to_json,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      logs,
    } = { ...tx_response };

    const transfer_events =
      (logs || [])
        .map(l => {
          const {
            events,
          } = { ...l };

          const e = (events || [])
            .find(e =>
              equals_ignore_case(
                _.last(
                  (e?.type || '')
                    .split('.')
                ),
                'IBCTransferFailed',
              )
            );

          const {
            attributes,
          } = { ...e };

          if (attributes) {
            const transfer_id =
              (
                attributes
                  .find(a =>
                    a?.key === 'id'
                  )?.value ||
                ''
              )
              .split('"')
              .join('');

            if (transfer_id) {
              attributes
                .push(
                  {
                    key: 'transfer_id',
                    value: transfer_id,
                  }
                );
            }
          }

          return {
            ...e,
            attributes,
          };
        })
        .filter(e => e.attributes?.length > 0)
        .map(e => {
          const {
            attributes,
          } = { ...e };

          return (
            Object.fromEntries(
              attributes
                .filter(a =>
                  a?.key &&
                  a.value
                )
                .map(a => {
                  const {
                    key,
                    value,
                  } = { ...a };

                  return [
                    key,
                    to_json(value) ||
                    (typeof value === 'string' ?
                      value
                        .split('"')
                        .join('') :
                      value
                    ),
                  ];
                })
            )
          );
        })
        .filter(e => e.transfer_id);

    for (const record of transfer_events) {
      const {
        transfer_id,
      } = { ...record };

      // cross-chain transfers
      try {
        const _response =
          await read(
            'cross_chain_transfers',
            {
              bool: {
                must: [
                  { exists: { field: 'send.txhash' } },
                  { match: { 'send.status': 'success' } },
                ],
                should: [
                  { match: { 'confirm.transfer_id': transfer_id } },
                  { match: { 'vote.transfer_id': transfer_id } },
                  { match: { transfer_id } },
                ],
                minimum_should_match: 1,
                must_not: [
                  { exists: { field: 'ibc_send.ack_txhash' } },
                ],
              },
            },
            {
              size: 1,
              sort: [{ 'send.created_at.ms': 'desc' }],
            },
          );

        const _data =
          _.head(
            _response?.data
          );

        const {
          send,
          ibc_send,
        } = { ..._data };

        if (
          send?.txhash &&
          send.source_chain
        ) {
          const {
            source_chain,
          } = { ...send };

          const _id = `${send.txhash}_${source_chain}`.toLowerCase();

          await write(
            'cross_chain_transfers',
            _id,
            {
              _data,
              ibc_send: {
                ...ibc_send,
                failed_txhash: txhash,
              },
            },
            true,
          );

          await save_time_spent(
            _id,
          );

          updated = true;
        }
      } catch (error) {}
    }
  } catch (error) {}

  return updated;
};