const {
  BigNumber,
  utils: { formatUnits, parseUnits },
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  write,
} = require('../index');
const assets_price = require('../assets-price');
const {
  sleep,
  equals_ignore_case,
  normalize_original_chain,
  normalize_chain,
} = require('../../utils');

const collection = 'transfers';

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data =
  cosmos_chains_data
    .filter(c => c?.id !== axelarnet.id);
const assets_data = require('../../data')?.assets?.[environment] ||
  [];

const {
  endpoints,
} = { ...config?.[environment] };

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
      evm_chains_data.findIndex(c =>
        equals_ignore_case(c?.id, sender_chain)
      ) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data.findIndex(c =>
          equals_ignore_case(c?.id, sender_chain)
        ) > -1 ?
          'cosmos' :
          equals_ignore_case(axelarnet.id, sender_chain) ?
            'axelarnet' :
            null,
      evm_chains_data.findIndex(c =>
        equals_ignore_case(c?.id, recipient_chain)
      ) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data.findIndex(c =>
          equals_ignore_case(c?.id, recipient_chain)
        ) > -1 ?
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

      return (
        equals_ignore_case(id, chain) ||
        Object.keys({ ...overrides })
          .findIndex(k =>
            equals_ignore_case(k, chain)
          ) > -1
      );
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

  const [
    chain_id,
    chain_version,
  ] = (chain || '')
    .split('-')
    .filter(s => s);

  return _.concat(
    chains_data
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
        return (
          _.concat(
            !equals_ignore_case(c?.id, _id) &&
            c?.id,
            Object.keys({ ...c?.overrides })
              .filter(k =>
                !equals_ignore_case(k, _id) &&
                k?.startsWith(_id)
              ),
          )
          .filter(id => id)
        );
      }),
    chain_version ?
      chains_data
        .filter(c =>
          (
            !c?.id?.startsWith(chain_id) &&
            c?.id?.includes(`-${chain_version}`)
          ) ||
          (
            !equals_ignore_case(c?.id, _id) &&
            c?.id?.startsWith(chain_id)
          )
        )
        .map(c => c?.id) :
      [],
  );
};

const update_link = async (
  link,
  source,
  _lcd,
) => {
  const {
    id,
    original_recipient_chain,
    asset,
  } = { ...link };
  let {
    original_sender_chain,
    sender_chain,
    sender_address,
    denom,
    price,
  } = { ...link };

  if (link) {
    let updated = false;

    if (
      source &&
      !equals_ignore_case(sender_address, source.sender_address)
    ) {
      sender_address = source.sender_address;
      link.sender_address = sender_address;
      updated = true;
    }

    if (
      equals_ignore_case(original_sender_chain, axelarnet.id) ||
      cosmos_non_axelarnet_chains_data.findIndex(c =>
        c?.overrides?.[original_sender_chain]
      ) > -1
    ) {
      const chain_data = cosmos_non_axelarnet_chains_data.find(c =>
        source?.sender_address?.startsWith(c?.prefix_address)
      );
      const {
        overrides,
      } = { ...chain_data };

      if (chain_data) {
        original_sender_chain =
          Object.values({ ...overrides })
            .find(o =>
              o?.endpoints?.lcd === _lcd ||
              o?.endpoints?.lcds?.includes(_lcd)
            )?.id ||
            _.last(Object.keys({ ...overrides })) ||
            chain_data.id;

        updated = updated ||
          link.original_sender_chain !== original_sender_chain;

        link.original_sender_chain = original_sender_chain;
      }
    }

    if (source) {
      sender_chain = normalize_chain(
        cosmos_non_axelarnet_chains_data.find(c =>
          source?.sender_address?.startsWith(c?.prefix_address)
        )?.id ||
        sender_chain ||
        source.sender_chain
      );

      updated = updated ||
        link.sender_chain !== sender_chain;

      link.sender_chain = sender_chain;

      if (!original_sender_chain?.startsWith(sender_chain)) {
        original_sender_chain = sender_chain;
        link.original_sender_chain = original_sender_chain;
        updated = true;
      }
    }

    denom =
      source?.denom ||
      asset ||
      denom;

    if (
      typeof price !== 'number' ||
      price <= 0 ||
      !equals_ignore_case(link.denom, denom)
    ) {
      const response = await assets_price(
        {
          chain: equals_ignore_case(original_sender_chain, axelarnet.id) ?
            original_recipient_chain :
            original_sender_chain,
          denom,
          timestamp:
            moment(
              source?.created_at?.ms ||
              undefined
            )
            .utc()
            .valueOf(),
        },
      );

      const _price = _.head(response)?.price;

      if (typeof _price === 'number') {
        price = _price;
        link.price = price;
        link.denom = denom;
        updated = true;
      }
    }

    if (updated) {
      await write(
        'deposit_addresses',
        id,
        link,
      );
    }
  }

  return link;
};

const update_source = async (
  source,
  link,
) => {
  if (source) {
    source.sender_chain =
      link?.sender_chain ||
      source.sender_chain;

    source.recipient_chain =
      link?.recipient_chain ||
      source.recipient_chain;

    source.original_sender_chain =
      link?.original_sender_chain ||
      normalize_original_chain(
        source.sender_chain ||
        link?.sender_chain
      );

    source.original_recipient_chain =
      link?.original_recipient_chain ||
      normalize_original_chain(
        source.recipient_chain ||
        link?.recipient_chain
      );

    if (link) {
      source.recipient_chain =
        normalize_chain(
          link.recipient_chain ||
          source.recipient_chain
        );

      source.denom =
        source.denom ||
        link.asset ||
        link.denom;

      if (source.denom) {
        const {
          id,
          chain_id,
        } = { ...chains_data.find(c => equals_ignore_case(c?.id, source.sender_chain)) };

        const asset_data = assets_data.find(a =>
          equals_ignore_case(a?.id, source.denom) ||
          a?.ibc?.findIndex(i =>
            i?.chain_id === id &&
            equals_ignore_case(i?.ibc_denom, source.denom)
          ) > -1
        );

        const {
          contracts,
          ibc,
        } = { ...asset_data };
        let {
          decimals,
        } = { ...asset_data };

        decimals =
          contracts?.find(c =>
            c?.chain_id === chain_id
          )?.decimals ||
          ibc?.find(i =>
            i?.chain_id === id
          )?.decimals ||
          decimals ||
          18;

        if (asset_data) {
          source.denom =
            asset_data.id ||
            source.denom;

          if (typeof source.amount === 'string') {
            source.amount = Number(
              formatUnits(
                BigNumber.from(source.amount)
                  .toString(),
                decimals,
              )
            );
          }

          if (
            typeof !source.fee !== 'number' &&
            endpoints?.lcd
          ) {
            const lcd = axios.create(
              {
                baseURL: endpoints.lcd,
              },
            );

            const _response = await lcd.get(
              '/axelar/nexus/v1beta1/transfer_fee',
              {
                params: {
                  source_chain: source.original_sender_chain,
                  destination_chain: source.original_recipient_chain,
                  amount: `${
                    parseUnits(
                      (source.amount || 0)
                        .toString(),
                      decimals,
                    )
                    .toString()
                  }${asset_data.id}`,
                },
              },
            ).catch(error => { return { data: { error } }; });

            const {
              amount,
            } = { ..._response?.data?.fee };

            if (amount) {
              source.fee = Number(
                formatUnits(
                  BigNumber.from(amount)
                    .toString(),
                  decimals,
                )
              );
            }
          }
        }
      }

      if (
        typeof source.amount === 'number' &&
        typeof link.price === 'number'
      ) {
        source.value = source.amount * link.price;
      }

      if (
        typeof source.amount === 'number' &&
        typeof source.fee === 'number'
      ) {
        if (source.amount < source.fee) {
          source.insufficient_fee = true;
        }
        else {
          source.insufficient_fee = false;
          source.amount_received = source.amount - source.fee;
        }
      }
    }

    if (source.recipient_address) {
      await write(
        'transfers',
        `${source.id}_${source.recipient_address}`.toLowerCase(),
        {
          source,
          link: link ||
            undefined,
        },
      );
    }
  }

  return source;
};

module.exports = {
  saveTimeSpent,
  get_distinguish_chain_id,
  get_others_version_chain_ids,
  update_link,
  update_source,
};