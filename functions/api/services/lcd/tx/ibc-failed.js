const _ = require('lodash');
const {
  read,
  write,
} = require('../../index');
const {
  saveTimeSpent,
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

    const transfer_events = (logs || [])
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
            attributes.push(
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

        return Object.fromEntries(
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
        );
      })
      .filter(e => e.transfer_id);

    for (const record of transfer_events) {
      const {
        transfer_id,
      } = { ...record };

      const _response =
        await read(
          'transfers',
          {
            bool: {
              should: [
                { match: { 'confirm_deposit.transfer_id': transfer_id } },
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
            sort: [{ 'source.created_at.ms': 'desc' }],
          },
        );

      const transfer_data = _.head(_response?.data);
      let token_sent_data;

      if (!transfer_data) {
        const _response =
          await read(
            'token_sent_events',
            {
              bool: {
                should: [
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
              sort: [{ 'event.created_at.ms': 'desc' }],
            },
          );

        token_sent_data = _.head(_response?.data);
      }

      const data =
        transfer_data ||
        token_sent_data;

      if (data) {
        const {
          source,
          event,
          ibc_send,
        } = { ...data };
        const {
          recipient_address,
        } = { ...source };

        const id =
          (
            source ||
            event
          )?.id;

        const _id =
          recipient_address ?
            `${id}_${recipient_address}`.toLowerCase() :
            id;

        if (_id) {
          await write(
            event ?
              'token_sent_events' :
              'transfers',
            _id,
            {
              ibc_send: {
                ...ibc_send,
                failed_txhash: txhash,
              },
            },
            true,
          );

          await saveTimeSpent(
            _id,
            null,
            event ?
              'token_sent_events' :
              undefined,
          );

          updated = true;
        }
      }
    }
  } catch (error) {}

  return updated;
};