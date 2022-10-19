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

        const e = events?.find(e =>
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
              attributes.find(a =>
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

      const _response = await read(
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

      if (_.head(_response?.data)) {
        const {
          source,
          ibc_send,
        } = { ..._.head(_response.data) };
        const {
          id,
          recipient_address,
        } = { ...source };

        if (recipient_address) {
          const _id = `${id}_${recipient_address}`.toLowerCase();

          await write(
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
          );
        }
      }
    }
  } catch (error) {}
};