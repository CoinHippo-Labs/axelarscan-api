const _ = require('lodash');
const moment = require('moment');
const lcd = require('../../lcd');
const {
  write,
} = require('../../index');
const {
  normalize_chain,
} = require('../../../utils');

const fields =
  [
    {
      id: 'deposit_address',
      type: 'string',
      required: true,
      is_key: true,
    },
    {
      id: 'tx_hash',
      type: 'string',
      required: true,
      is_key: true,
    },
    {
      id: 'deposit_address_link',
      type: 'string',
      required: true,
    },
    {
      id: 'tx_hash_unwrap',
      type: 'string',
      required: true,
    },
    {
      id: 'destination_chain',
      type: 'string',
      normalize: s => normalize_chain(s),
    },
  ];

module.exports = async (
  params = {},
  collection = 'unwraps',
) => {
  if (
    !params.tx_hash &&
    params.tx_hash_msg_update_client
  ) {
    const {
      tx_hash_msg_update_client,
    } = { ...params };
    let {
      tx_hash,
    } = { ...params };

    const lcd_response =
      await lcd(
        `/cosmos/tx/v1beta1/txs/${tx_hash_msg_update_client}`,
      );

    const {
      tx_hashes,
    } = { ...lcd_response };

    tx_hash =
      _.head(
        tx_hashes
      );

    if (tx_hash) {
      params.tx_hash = tx_hash;
    }
  }

  if (
    fields
      .findIndex(f => {
        const {
          id,
          type,
          required,
        } = { ...f };

        const value = params[id];

        return (
          !(
            required ?
              value &&
              (
                !type ||
                typeof value === type
              ) :
              value === undefined ||
              (
                !type ||
                typeof value === type
              )
          )
        );
      }) > -1
  ) {
    return {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else if (
    fields
      .findIndex(f =>
        f?.is_key
      ) < 0
  ) {
    return {
      error: true,
      code: 500,
      message: 'wrong api configuration',
    };
  }
  else {
    const data =
      Object.fromEntries(
        fields
          .map(f => {
            const {
              id,
              normalize,
            } = { ...f };

            const value =
              typeof normalize === 'function' ?
                normalize(params[id]) :
                params[id];

            return [
              id,
              value,
            ];
          })
      );

    const _id =
      fields
        .filter(f =>
          f?.is_key &&
          params[f.id]
        )
        .map(f =>
          params[f.id]
            .toLowerCase()
        )
        .join('_');

    const response =
      await write(
        collection,
        _id,
        {
          ...data,
          updated_at:
            moment()
              .valueOf(),
        },
        true,
      );

    const {
      result,
    } = { ...response };

    return {
      error: false,
      code: 200,
      method: 'saveUnwrap',
      _id,
      data,
      result,
    };
  }
};