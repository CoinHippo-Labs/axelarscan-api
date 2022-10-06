const _ = require('lodash');
const config = require('config-yml');
const {
  get,
  write,
} = require('../index');
const {
  equals_ignore_case,
  sleep,
} = require('../../utils');

const collection = 'transfers';

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);

// save time spent
const saveTimeSpent = async (
  id,
  data,
) => {
  let time_spent;

  if (
    !data &&
    id
  ) {
    await sleep(0.5 * 1000);

    data = await get(
      'transfers',
      id,
    );
  }
  else if (
    !id &&
    data
  ) {
    id = data.id;
  }

  const {
    source,
    confirm_deposit,
    vote,
    sign_batch,
    ibc_send,
    axelar_transfer,
  } = { ...data };
  const {
    sender_chain,
    recipient_chain,
  } = { ...source };

  const chain_types =
    [
      evm_chains_data.findIndex(c => equals_ignore_case(c?.id, sender_chain)) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data.findIndex(c => equals_ignore_case(c?.id, sender_chain)) > -1 ?
          'cosmos' :
          equals_ignore_case(axelarnet.id, sender_chain) ?
            'axelarnet' :
            null,
      evm_chains_data.findIndex(c => equals_ignore_case(c?.id, recipient_chain)) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data.findIndex(c => equals_ignore_case(c?.id, recipient_chain)) > -1 ?
          'cosmos' :
          equals_ignore_case(axelarnet.id, recipient_chain) ?
            'axelarnet' :
            null,
    ]
    .filter(t => t);

  const type = chain_types.length === 2 ?
    chain_types.join('_') :
    undefined;

  if (
    confirm_deposit?.created_at?.ms &&
    source?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      send_confirm: confirm_deposit.created_at.ms / 1000 - source.created_at.ms / 1000,
    };
  }

  if (
    vote?.created_at?.ms &&
    confirm_deposit?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_vote: vote.created_at.ms / 1000 - confirm_deposit.created_at.ms / 1000,
    };
  }

  if (
    sign_batch?.block_timestamp &&
    confirm_deposit?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_sign: sign_batch.block_timestamp - confirm_deposit.created_at.ms / 1000,
    };
  }

  if (
    ibc_send?.received_at?.ms &&
    confirm_deposit?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_ibc: ibc_send.received_at.ms / 1000 - confirm_deposit.created_at.ms / 1000,
    };
  }

  if (
    axelar_transfer?.created_at?.ms &&
    confirm_deposit?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_axelar_transfer: axelar_transfer.created_at.ms / 1000 - confirm_deposit.created_at.ms / 1000,
    };
  }

  if (
    sign_batch?.block_timestamp &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_sign: sign_batch.block_timestamp - vote.created_at.ms / 1000,
    };
  }

  if (
    ibc_send?.received_at?.ms &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_ibc: ibc_send.received_at.ms / 1000 - vote.created_at.ms / 1000,
    };
  }

  if (
    axelar_transfer?.created_at?.ms &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_axelar_transfer: axelar_transfer.created_at.ms / 1000 - vote.created_at.ms / 1000,
    };
  }

  if (
    type &&
    time_spent
  ) {
    const source_chain_type = chain_types[0],
      destination_chain_type = chain_types[1];

    switch (destination_chain_type) {
      case 'evm':
        if (
          sign_batch?.block_timestamp &&
          source?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total: sign_batch.block_timestamp - source.created_at.ms / 1000,
          };
        }
        break;
      case 'cosmos':
        if (
          ibc_send?.received_at?.ms &&
          source?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total: ibc_send.received_at.ms / 1000 - source.created_at.ms / 1000,
          };
        }
        break;
      case 'axelarnet':
        switch (source_chain_type) {
          case 'evm':
            if (
              vote?.created_at?.ms &&
              source?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total: vote.created_at.ms / 1000 - source.created_at.ms / 1000,
              };
            }
            break;
          default:
            if (time_spent.send_confirm) {
              time_spent = {
                ...time_spent,
                total: time_spent.send_confirm,
              };
            }
            break;

          if (
            time_spent.vote_axelar_transfer ||
            time_spent.confirm_axelar_transfer
          ) {
            time_spent = {
              ...time_spent,
              total: time_spent.vote_axelar_transfer ||
                time_spent.confirm_axelar_transfer,
            };
          }
        }
        break;
      default:
        break;
    }

    time_spent = {
      ...time_spent,
      source_chain_type,
      destination_chain_type,
      type,
    };
  }

  // save time spent data
  if (time_spent) {
    await write(
      collection,
      id,
      {
        time_spent,
      },
      true,
    );
  }
};

const get_distinguish_chain_id = chain => {
  const chain_data = chains_data
    .find(c => {
      const {
        id,
        overrides,
      } = { ...c };

      return equals_ignore_case(id, chain) ||
        Object.keys({ ...overrides })
          .findIndex(k =>
            equals_ignore_case(k, chain)
          ) > -1;
    });

  const {
    id,
    overrides,
  } = { ...chain_data };

  return (
    _.head(
      Object.entries({ ...overrides })
        .filter(([k, v]) =>
          equals_ignore_case(k, chain) &&
          Object.keys({ ...v }).length > 0
        )
        .map(([k, v]) => k)
    ) ||
    id ||
    chain
  );
};

const get_others_version_chain_ids = chain => {
  const chain_data = chains_data
    .find(c => {
      const {
        id,
        overrides,
      } = { ...c };

      return equals_ignore_case(id, chain) ||
        Object.keys({ ...overrides })
          .findIndex(k =>
            equals_ignore_case(k, chain)
          ) > -1;
    });

  const {
    id,
    overrides,
  } = { ...chain_data };

  const _id = equals_ignore_case(id, chain) ?
    id :
    Object.keys({ ...overrides })
      .find(k =>
        equals_ignore_case(k, chain)
      );

  return chains_data
    .filter(c =>
      (
        !equals_ignore_case(c?.id, _id) &&
        c?.id?.startsWith(_id)
      ) ||
      Object.keys({ ...c?.overrides })
        .findIndex(k =>
          !equals_ignore_case(k, _id) &&
          k?.startsWith(_id)
        ) > -1
    )
    .flatMap(c => {
      return _.concat(
        !equals_ignore_case(c?.id, _id) &&
          c?._id,
        Object.keys({ ...c?.overrides })
          .filter(k =>
            !equals_ignore_case(k, _id) &&
            k?.startsWith(_id)
          ),
      )
      .filter(id => id);
    });
};

module.exports = {
  saveTimeSpent,
  get_distinguish_chain_id,
  get_others_version_chain_ids,
};