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
  } = { ...data };
  const {
    sender_chain,
    recipient_chain,
  } = { ...source };

  const chain_types = [
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
  ].filter(t => t);

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

module.exports = {
  saveTimeSpent,
};