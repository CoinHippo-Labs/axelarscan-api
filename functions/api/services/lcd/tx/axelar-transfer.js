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
        } = { ..._data };

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
              ..._data,
              axelar_transfer: {
                txhash,
                height,
                status:
                  code ?
                    'failed' :
                    'success',
                type: 'axelar',
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