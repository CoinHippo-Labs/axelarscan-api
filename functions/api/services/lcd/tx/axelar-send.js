const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../../index');
const {
  update_link,
  update_source,
  normalize_link,
  _update_link,
  _update_send,
} = require('../../transfers/utils');
const {
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
  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      code,
      height,
      timestamp,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

    const created_at =
      moment(timestamp)
        .utc()
        .valueOf();

    const sender_address =
      messages
        .find(m =>
          m?.from_address
        )?.from_address;

    const recipient_address =
      messages
        .find(m =>
          m?.to_address
        )?.to_address;

    const amount_data =
      _.head(
        messages
          .find(m =>
            m?.amount
          )?.amount
      );

    // transfers
    let record = {
      id: txhash,
      type: 'axelar_transfer',
      status_code: code,
      status:
        code ?
          'failed' :
          'success',
      height,
      created_at: get_granularity(created_at),
      sender_chain: axelarnet.id,
      sender_address,
      recipient_address,
      amount: amount_data?.amount,
      denom: amount_data?.denom,
    };

    if (
      recipient_address?.length >= 65 &&
      txhash &&
      amount_data?.amount
    ) {
      const _response =
        await read(
          'deposit_addresses',
          {
            match: { deposit_address: recipient_address },
          },
          {
            size: 1,
          },
        );

      let link = _.head(_response?.data);

      link =
        await update_link(
          link,
          record,
        );

      record =
        await update_source(
          record,
          link,
        );
    }

    // cross-chain transfer
    if (
      txhash &&
      !code &&
      recipient_address?.length >= 65 &&
      amount_data?.amount
    ) {
      let record = {
        txhash,
        height,
        status:
          code ?
            'failed' :
            'success',
        type: 'axelar',
        created_at: get_granularity(created_at),
        source_chain: axelarnet.id,
        sender_address,
        recipient_address,
        denom: amount_data.denom,
        amount: amount_data.amount,
      };

      const _response =
        await read(
          'deposit_addresses',
          {
            match: { deposit_address: recipient_address },
          },
          {
            size: 1,
          },
        );

      let link =
        normalize_link(
          _.head(
            _response?.data
          ),
        );

      link =
        await _update_link(
          link,
          record,
        );

      record =
        await _update_send(
          record,
          link,
          'deposit_address',
        );
    }
  } catch (error) {}
};