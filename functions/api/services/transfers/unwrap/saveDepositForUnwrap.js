const {
  write,
} = require('../../index');

const fields =
  [
    {
      id: 'deposit_address',
      type: 'string',
      required: true,
      is_key: true,
    },
    {
      id: 'deposit_address_link',
      type: 'string',
      required: true,
      is_key: true,
    },
    {
      id: 'source_chain',
      type: 'string',
    },
    {
      id: 'destination_chain',
      type: 'string',
    },
    {
      id: 'recipient_address',
      type: 'string',
    },
  ];

module.exports = async (
  params = {},
  collection = 'unwrap',
) => {
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
            } = { ...f };

            const value = params[id];

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
        data,
      );

    const {
      result,
    } = { ...response };

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