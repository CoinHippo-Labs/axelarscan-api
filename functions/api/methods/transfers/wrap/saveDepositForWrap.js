const moment = require('moment');

const {
  write,
} = require('../../../services/index');
const {
  WRAP_COLLECTION,
  getChainKey,
} = require('../../../utils/config');

const fields = [
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
    id: 'source_chain',
    type: 'string',
    normalize: s => getChainKey(s),
  },
  {
    id: 'destination_chain',
    type: 'string',
    normalize: s => getChainKey(s),
  },
  {
    id: 'recipient_address',
    type: 'string',
  },
];

module.exports = async (
  params = {},
) => {
  if (
    fields.findIndex(f => {
      const {
        id,
        type,
        required,
      } = { ...f };

      const value = params[id];
      const is_type_valid = !type || typeof value === type;

      return !(required ? value && is_type_valid : value === undefined || is_type_valid);
    }) > -1
  ) {
    return {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else if (fields.findIndex(f => f.is_key) < 0) {
    return {
      error: true,
      code: 500,
      message: 'wrong api configuration',
    };
  }
  else {
    const data =
      Object.fromEntries(
        fields.map(f => {
          const {
            id,
            normalize,
          } = { ...f };

          const value = typeof normalize === 'function' ? normalize(params[id]) : params[id];

          return [id, value];
        })
      );

    const _id = fields.filter(f => f.is_key && params[f.id]).map(f => params[f.id].toLowerCase()).join('_');
    const response = await write(WRAP_COLLECTION, _id, { ...data, updated_at: moment().valueOf() });

    const {
      result,
    } = { ...response };

    return {
      error: false,
      code: 200,
      method: 'saveDepositForWrap',
      _id,
      data,
      result,
    };
  }
};