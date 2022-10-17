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
} = require('../../transfers/utils');
const {
  equals_ignore_case,
  get_granularity,
  to_json,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');

module.exports = async (
  lcd_response = {},
) => {
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

    const created_at = moment(timestamp)
      .utc()
      .valueOf();

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
            'AxelarTransferCompleted',
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
            .map(a =>
              [
                a.key,
                a.value,
              ]
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

        amount = Number(
          formatUnits(
            BigNumber.from(amount)
              .toString(),
            decimals,
          )
        );
      }

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
              axelar_transfer: {
                id: txhash,
                type: 'axelar_transfer',
                status_code: code,
                status: code ?
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
          );
        }
      }
    }
  } catch (error) {}
};