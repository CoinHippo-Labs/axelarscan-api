const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  read,
} = require('../../index');
const {
  update_link,
  update_source,
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

    const amount_data =
      _.head(
        messages.find(m =>
          m?.amount
        )?.amount
      );

    let record = {
      id: txhash,
      type: 'axelar_transfer',
      status_code: code,
      status: code ?
        'failed' :
        'success',
      height,
      created_at: get_granularity(created_at),
      sender_chain: axelarnet.id,
      sender_address:
        messages
          .find(m =>
            m?.from_address
          )?.from_address,
      recipient_address:
        messages
          .find(m =>
            m?.to_address
          )?.to_address,
      amount: amount_data?.amount,
      denom: amount_data?.denom,
    };

    const {
      recipient_address,
    } = { ...record };
    let {
      amount,
    } = { ...record };

    if (
      recipient_address?.length >= 65 &&
      txhash &&
      amount
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
  } catch (error) {}
};