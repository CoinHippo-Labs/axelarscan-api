const {
  BigNumber,
  utils: { formatUnits },
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
  write,
} = require('../../index');
const {
  saveTimeSpent,
  save_time_spent,
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  to_json,
  get_granularity,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );

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
      code,
      height,
      timestamp,
      logs,
    } = { ...tx_response };

    const created_at =
      moment(timestamp)
        .utc()
        .valueOf();

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
                'AxelarTransferCompleted',
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
        recipient,
        asset,
        transfer_id,
      } = { ...record };
      const {
        denom,
      } = { ...to_json(asset) };
      let {
        amount,
      } = { ...to_json(asset) };

      if (amount) {
        const decimals = 6;

        amount =
          Number(
            formatUnits(
              BigNumber.from(
                amount
              )
              .toString(),
              decimals,
            )
          );
      }

      // transfer
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
              axelar_transfer: {
                id: txhash,
                type: 'axelar_transfer',
                status_code: code,
                status:
                  code ?
                    'failed' :
                    'success',
                height,
                created_at: get_granularity(created_at),
                recipient_chain: axelarnet.id,
                recipient_address: recipient,
                denom,
                amount,
                transfer_id,
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

      // cross-chain transfer
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
              },
            },
            {
              size: 1,
              sort: [{ 'send.created_at.ms': 'desc' }],
            },
          );

        const {
          send,
        } = {
          ...(
            _.head(
              _response?.data
            )
          ),
        };

        if (
          send?.txhash &&
          send.source_chain
        ) {
          const {
            txhash,
            source_chain,
          } = { ...send };

          const _id = `${txhash}_${source_chain}`.toLowerCase();

          await write(
            'cross_chain_transfers',
            _id,
            {
              axelar_transfer: {
                txhash,
                height,
                status:
                  code ?
                    'failed' :
                    'success',
                type: 'axelar_transfer',
                created_at: get_granularity(created_at),
                destination_chain: axelarnet.id,
                recipient_address: recipient,
                denom,
                amount,
                transfer_id,
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