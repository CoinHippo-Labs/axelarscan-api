const _ = require('lodash');

const {
  getChainData,
} = require('../../../utils/config');
const {
  equalsIgnoreCase,
  toArray,
} = require('../../../utils');

const getTime = object => ((object?.received_at?.ms || object?.created_at?.ms) / 1000) || object?.block_timestamp;

module.exports = data => {
  let output;

  if (data) {
    const time_spent_pairs = [
      {
        a: 'wrap',
        b: 'send',
      },
      {
        a: 'erc20_transfer',
        b: 'send',
      },
      {
        a: 'send',
        b: 'confirm',
      },
      {
        a: 'confirm',
        b: 'vote',
      },
      {
        a: 'confirm',
        b: 'command',
        field: 'confirm_execute',
      },
      {
        a: 'confirm',
        b: 'ibc_send',
        field: 'confirm_ibc',
      },
      {
        a: 'confirm',
        b: 'axelar_transfer',
      },
      {
        a: 'vote',
        b: 'command',
        field: 'vote_execute',
      },
      {
        a: 'vote',
        b: 'ibc_send',
        field: 'vote_ibc',
      },
      {
        a: 'vote',
        b: 'axelar_transfer',
      },
      {
        a: 'command',
        b: 'unwrap',
        field: 'execute_unwrap',
      },
      {
        a: 'send',
        b: 'command',
        field: 'total',
      },
      {
        a: 'send',
        b: 'ibc_send',
        field: 'total',
      },
      {
        a: 'send',
        b: 'axelar_transfer',
        field: 'total',
      },
      {
        a: 'send',
        b: 'unwrap',
        field: 'total',
      },
      {
        a: 'wrap',
        b: 'command',
        field: 'total',
      },
      {
        a: 'wrap',
        b: 'ibc_send',
        field: 'total',
      },
      {
        a: 'wrap',
        b: 'axelar_transfer',
        field: 'total',
      },
      {
        a: 'erc20_transfer',
        b: 'command',
        field: 'total',
      },
      {
        a: 'erc20_transfer',
        b: 'ibc_send',
        field: 'total',
      },
      {
        a: 'erc20_transfer',
        b: 'axelar_transfer',
        field: 'total',
      },
    ];

    const {
      send,
    } = { ...data };
    const {
      source_chain,
      destination_chain,
    } = { ...send };

    const chain_types = toArray([source_chain, destination_chain].map(c => getChainData(c)?.id === 'axelarnet' ? 'axelarnet' : getChainData(c)?.chain_type));
    const type = chain_types.length === 2 ? chain_types.join('_') : undefined;

    const time_spent =
      Object.fromEntries(
        time_spent_pairs
          .filter(p => {
            const {
              a,
              b,
            } = { ...p };

            const timestampA = getTime(data[a]);
            const timestampB = getTime(data[b]);

            return typeof timestampA === 'number' && !isNaN(timestampA) && typeof timestampB === 'number' && !isNaN(timestampB) && timestampB > timestampA;
          })
          .map(p => {
            const {
              a,
              b,
            } = { ...p };
            let {
              field,
            } = { ...p };

            field = field || `${a}_${b}`;

            const timestampA = getTime(data[a]);
            const timestampB = getTime(data[b]);

            return [field, timestampB - timestampA];
          })
      );

    output = {
      ...time_spent,
      source_chain_type: type && _.head(chain_types),
      destination_chain_type: type && _.last(chain_types),
      type,
    };
  }

  return output;
};