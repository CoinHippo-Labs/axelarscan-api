const _ = require('lodash');
const moment = require('moment');
const lcd = require('../../lcd');
const {
  read,
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
      id: 'source_chain',
      type: 'string',
      normalize: s => normalize_chain(s),
    },
    {
      id: 'destination_chain',
      type: 'string',
      normalize: s => normalize_chain(s),
    },
    {
      id: 'recipient_address',
      type: 'string',
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
      source_chain,
    } = { ...lcd_response };

    tx_hash =
      _.head(
        tx_hashes
      );

    if (tx_hash) {
      params.tx_hash = tx_hash;
    }

    if (source_chain) {
      params.source_chain = source_chain;
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
      );

    const {
      result,
    } = { ...response };

    if (data.tx_hash) {
      const _collection = 'cross_chain_transfers';

      const {
        tx_hash,
        deposit_address_link,
      } = { ...data };

      const response =
        await read(
          _collection,
          {
            bool: {
              must: [
                { match: { 'send.txhash': tx_hash } },
                { match: { 'send.recipient_address': deposit_address_link } },
                { exists: { field: 'send.source_chain' } },
              ],
            },
          },
          {
            size: 1,
          },
        );

      const _data =
        _.head(
          response?.data
        );

      if (_data) {
        const {
          send,
        } = { ..._data };
        const {
          txhash,
          source_chain,
        } = { ...send };

        const _id = `${txhash}_${source_chain}`.toLowerCase();

        await write(
          _collection,
          _id,
          {
            ..._data,
            unwrap: data,
            type: 'unwrap',
          },
          true,
        );
      }
    }

    return {
      error: false,
      code: 200,
      method: 'saveDepositForUnwrap',
      _id,
      data,
      result,
    };
  }
};