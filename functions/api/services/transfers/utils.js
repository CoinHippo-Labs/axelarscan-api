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

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../data')?.chains?.[environment]?.cosmos ||
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
const cosmos_non_axelarnet_chains_data =
  cosmos_chains_data
    .filter(c =>
      c?.id !== axelarnet.id
    );
const assets_data =
  require('../../data')?.assets?.[environment] ||
  [];

const {
  endpoints,
} = { ...config?.[environment] };

const get_distinguish_chain_id = chain => {
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
            equals_ignore_case(
              k,
              chain,
            )
          ) > -1
      );
    });

  const {
    id,
    overrides,
  } = { ...chain_data };

  return (
    _.head(
      Object.entries({ ...overrides })
        .filter(([k, v]) =>
          equals_ignore_case(
            k,
            chain,
          ) &&
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
        equals_ignore_case(
          id,
          chain,
        ) ||
        Object.keys({ ...overrides })
          .findIndex(k =>
            equals_ignore_case(
              k,
              chain,
            )
          ) > -1
      );
    });

  const {
    id,
    overrides,
  } = { ...chain_data };

  const _id =
    equals_ignore_case(
      id,
      chain,
    ) ?
      id :
      Object.keys({ ...overrides })
        .find(k =>
          equals_ignore_case(
            k,
            chain,
          )
        );

  const [
    chain_id,
    chain_version,
  ] = (chain || '')
    .split('-')
    .filter(s => s);

  return (
    _.concat(
      chains_data
        .filter(c =>
          (
            !equals_ignore_case(
              c?.id,
              _id,
            ) &&
            c?.id?.startsWith(_id)
          ) ||
          Object.keys({ ...c?.overrides })
            .findIndex(k =>
              !equals_ignore_case(
                k,
                _id,
              ) &&
              k?.startsWith(_id)
            ) > -1
        )
        .flatMap(c => {
          return (
            _.concat(
              !equals_ignore_case(
                c?.id,
                _id,
              ) &&
              c?.id,
              Object.keys({ ...c?.overrides })
                .filter(k =>
                  !equals_ignore_case(
                    k,
                    _id,
                  ) &&
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
              !equals_ignore_case(
                c?.id,
                _id,
              ) &&
              c?.id?.startsWith(chain_id)
            )
          )
          .map(c => c?.id) :
        [],
    )
    .filter(c => !chain_version)
  );
};

const normalize_link = link => {
  if (link) {
    link = _.cloneDeep(link);

    const {
      original_sender_chain,
      original_recipient_chain,
      sender_chain,
      recipient_chain,
    } = { ...link };

    link = {
      ...link,
      original_source_chain: original_sender_chain,
      original_destination_chain: original_recipient_chain,
      source_chain: sender_chain,
      destination_chain: recipient_chain,
    };

    delete link.original_sender_chain;
    delete link.original_recipient_chain;
    delete link.sender_chain;
    delete link.recipient_chain;
  }

  return link;
}

const update_link = async (
  link,
  send,
  _lcd,
) => {
  const {
    txhash,
    original_destination_chain,
    deposit_address,
    asset,
  } = { ...link };
  let {
    original_source_chain,
    source_chain,
    sender_address,
    denom,
    price,
  } = { ...link };

  if (link) {
    let updated = false;

    if (
      send &&
      !equals_ignore_case(
        sender_address,
        send.sender_address,
      )
    ) {
      sender_address = send.sender_address;
      link.sender_address = sender_address;
      updated = true;
    }

    if (
      equals_ignore_case(
        original_source_chain,
        axelarnet.id,
      ) ||
      cosmos_non_axelarnet_chains_data
        .findIndex(c =>
          c?.overrides?.[original_source_chain]
        ) > -1
    ) {
      const chain_data = cosmos_non_axelarnet_chains_data
        .find(c =>
          send?.sender_address?.startsWith(c?.prefix_address)
        );
      const {
        overrides,
      } = { ...chain_data };

      if (chain_data) {
        original_source_chain =
          Object.values({ ...overrides })
            .find(o =>
              o?.endpoints?.lcd === _lcd ||
              o?.endpoints?.lcds?.includes(_lcd)
            )?.id ||
            _.last(Object.keys({ ...overrides })) ||
            chain_data.id;

        updated =
          updated ||
          link.original_source_chain !== original_source_chain;

        link.original_source_chain = original_source_chain;
      }
    }

    if (send) {
      source_chain =
        normalize_chain(
          cosmos_non_axelarnet_chains_data
            .find(c =>
              send.sender_address?.startsWith(c?.prefix_address)
            )?.id ||
          source_chain ||
          send.source_chain
        );

      updated =
        updated ||
        link.source_chain !== source_chain;

      link.source_chain = source_chain;

      if (!original_source_chain?.startsWith(source_chain)) {
        original_source_chain = source_chain;
        link.original_source_chain = original_source_chain;
        updated = true;
      }
    }

    denom =
      send?.denom ||
      asset ||
      denom;

    if (
      typeof price !== 'number' ||
      price <= 0 ||
      !equals_ignore_case(
        link.denom,
        denom,
      )
    ) {
      const {
        ms,
      } = { ...send?.created_at };

      const response =
        await assets_price(
          {
            chain:
              equals_ignore_case(
                original_source_chain,
                axelarnet.id,
              ) ?
                original_destination_chain :
                original_source_chain,
            denom,
            timestamp:
              (ms ?
                moment(ms) :
                moment()
              )
              .utc()
              .valueOf(),
          },
        );

      const _price =
        _.head(
          response
        )?.price;

      if (typeof _price === 'number') {
        price = _price;
        link.price = price;
        link.denom = denom;
        updated = true;
      }
    }

    if (
      deposit_address &&
      updated
    ) {
      const _id = `${deposit_address}`.toLowerCase();

      await write(
        'deposit_addresses',
        _id,
        link,
      );
    }
  }

  return link;
};

const update_send = async (
  send,
  link,
  data,
  update_only = false,
) => {
  if (send) {
    send.source_chain =
      link?.source_chain ||
      send.source_chain;

    send.destination_chain =
      link?.destination_chain ||
      send.destination_chain;

    send.original_source_chain =
      link?.original_source_chain ||
      normalize_original_chain(
        send.source_chain ||
        link?.source_chain
      );

    send.original_destination_chain =
      link?.original_destination_chain ||
      normalize_original_chain(
        send.destination_chain ||
        link?.destination_chain
      );

    if (link) {
      send.destination_chain =
        normalize_chain(
          link.destination_chain ||
          send.destination_chain
        );

      send.denom =
        send.denom ||
        link.asset ||
        link.denom;

      if (send.denom) {
        const {
          id,
          chain_id,
        } = {
          ...(
            chains_data
              .find(c =>
                equals_ignore_case(
                  c?.id,
                  send.source_chain,
                )
              )
          ),
        };

        const asset_data = assets_data
          .find(a =>
            equals_ignore_case(
              a?.id,
              send.denom,
            ) ||
            (a?.ibc || [])
              .findIndex(i =>
                i?.chain_id === id &&
                equals_ignore_case(
                  i?.ibc_denom,
                  send.denom,
                )
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
          (contracts || [])
            .find(c =>
              c?.chain_id === chain_id
            )?.decimals ||
          (ibc || [])
            .find(i =>
              i?.chain_id === id
            )?.decimals ||
          decimals ||
          (
            [
              asset_data?.id,
              send.denom,
            ].findIndex(s =>
              s?.includes('-wei')
            ) > -1 ?
              18 :
              6
          );

        let _decimals = decimals;

        // custom decimals for non-axelar wrap assets
        if (
          send.token_address &&
          (contracts || [])
            .findIndex(c =>
              c?.chain_id === chain_id &&
              !equals_ignore_case(
                c?.contract_address,
                send.token_address,
              )
            ) < 0
        ) {
          if (
            (
              [
                'uusd',
              ].includes(send.denom) &&
              [
                137,
              ].includes(chain_id)
            ) ||
            (
              [
                'uusdc',
              ].includes(send.denom) &&
              [
                3,
                250,
              ].includes(chain_id)
            )
          ) {
            _decimals = 18;
          }
        }

        if (asset_data) {
          send.denom =
            asset_data.id ||
            send.denom;

          if (typeof send.amount === 'string') {
            send.amount =
              Number(
                formatUnits(
                  BigNumber.from(
                    send.amount
                  )
                  .toString(),
                  _decimals,
                )
              );
          }

          if (
            [
              'uluna',
              'uusd',
            ].includes(send.denom) &&
            send.created_at?.ms <
            moment(
              '20220401',
              'YYYYMMDD',
            )
            .utc()
            .valueOf()
          ) {
            send.fee =
              parseFloat(
                (
                  send.amount * 0.001
                )
                .toFixed(6)
              );
          }

          if (
            typeof send.fee !== 'number' &&
            endpoints?.lcd
          ) {
            const lcd =
              axios.create(
                {
                  baseURL: endpoints.lcd,
                  timeout: 3000,
                },
              );

            const _response =
              await lcd
                .get(
                  '/axelar/nexus/v1beta1/transfer_fee',
                  {
                    params: {
                      source_chain: send.original_source_chain,
                      destination_chain: send.original_destination_chain,
                      amount:
                        `${
                          parseUnits(
                            (
                              send.amount ||
                              0
                            )
                            .toString(),
                            decimals,
                          )
                          .toString()
                        }${asset_data.id}`,
                    },
                  },
                )
                .catch(error => {
                  return {
                    data: {
                      error,
                    },
                  };
                });

            const {
              amount,
            } = { ..._response?.data?.fee };

            if (amount) {
              send.fee =
                Number(
                  formatUnits(
                    BigNumber.from(
                      amount
                    )
                    .toString(),
                    decimals,
                  )
                );
            }
          }
        }
      }

      if (
        typeof send.amount === 'number' &&
        typeof link.price === 'number'
      ) {
        send.value = send.amount * link.price;
      }

      if (
        typeof send.amount === 'number' &&
        typeof send.fee === 'number'
      ) {
        if (send.amount < send.fee) {
          send.insufficient_fee = true;
        }
        else {
          send.insufficient_fee = false;
          send.amount_received = send.amount - send.fee;
        }
      }
    }

    if (
      send.txhash &&
      send.source_chain
    ) {
      const {
        txhash,
        source_chain,
        sender_address,
      } = { ...send };

      const chain_data = cosmos_chains_data
        .find(c =>
          c?.id === source_chain
        );

      const {
        prefix_address,
      } = { ...chain_data };

      if (
        !prefix_address ||
        sender_address?.startsWith(prefix_address)
      ) {
        const _id = `${txhash}_${source_chain}`.toLowerCase();

        await write(
          'cross_chain_transfers',
          _id,
          {
            ...data,
            send,
            link:
              link ||
              undefined,
          },
          update_only,
        )
      };
    }
  }

  return send;
};

const save_time_spent = async (
  id,
  data,
  collection = 'cross_chain_transfers',
) => {
  let time_spent;

  if (
    !data &&
    id
  ) {
    await sleep(0.5 * 1000);

    data =
      await get(
        collection,
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
    send,
    confirm,
    vote,
    command,
    ibc_send,
    axelar_transfer,
    wrap,
    unwrap,
  } = { ...data };
  const {
    source_chain,
    destination_chain,
  } = { ...send };

  const chain_types =
    [
      evm_chains_data
        .findIndex(c =>
          equals_ignore_case(
            c?.id,
            source_chain,
          )
        ) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data
          .findIndex(c =>
            equals_ignore_case(
              c?.id,
              source_chain,
            )
          ) > -1 ?
          'cosmos' :
          equals_ignore_case(
            axelarnet.id,
            source_chain,
          ) ?
            'axelarnet' :
            null,
      evm_chains_data
        .findIndex(c =>
          equals_ignore_case(
            c?.id,
            destination_chain,
          )
        ) > -1 ?
        'evm' :
        cosmos_non_axelarnet_chains_data
          .findIndex(c =>
            equals_ignore_case(
              c?.id,
              destination_chain,
            )
          ) > -1 ?
          'cosmos' :
          equals_ignore_case(
            axelarnet.id,
            destination_chain,
          ) ?
            'axelarnet' :
            null,
    ]
    .filter(t => t);

  const type =
    chain_types.length === 2 ?
      chain_types
        .join('_') :
      undefined;

  if (
    send?.created_at?.ms &&
    wrap?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      wrap_send:
        send.created_at.ms / 1000 -
        wrap.created_at.ms / 1000,
    };
  }

  if (
    confirm?.created_at?.ms &&
    send?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      send_confirm:
        confirm.created_at.ms / 1000 -
        send.created_at.ms / 1000,
    };
  }

  if (
    vote?.created_at?.ms &&
    confirm?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_vote:
        vote.created_at.ms / 1000 -
        confirm.created_at.ms / 1000,
    };
  }

  if (
    command?.block_timestamp &&
    confirm?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_execute:
        command.block_timestamp -
        confirm.created_at.ms / 1000,
    };
  }

  if (
    ibc_send?.received_at?.ms &&
    confirm?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_ibc:
        ibc_send.received_at.ms / 1000 -
        confirm.created_at.ms / 1000,
    };
  }

  if (
    axelar_transfer?.created_at?.ms &&
    confirm?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      confirm_axelar_transfer:
        axelar_transfer.created_at.ms / 1000 -
        confirm.created_at.ms / 1000,
    };
  }

  if (
    command?.block_timestamp &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_execute:
        command.block_timestamp -
        vote.created_at.ms / 1000,
    };
  }

  if (
    ibc_send?.received_at?.ms &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_ibc:
        ibc_send.received_at.ms / 1000 -
        vote.created_at.ms / 1000,
    };
  }

  if (
    axelar_transfer?.created_at?.ms &&
    vote?.created_at?.ms
  ) {
    time_spent = {
      ...time_spent,
      vote_axelar_transfer:
        axelar_transfer.created_at.ms / 1000 -
        vote.created_at.ms / 1000,
    };
  }

  if (
    unwrap?.created_at?.ms &&
    command?.block_timestamp
  ) {
    time_spent = {
      ...time_spent,
      execute_unwrap:
        unwrap.created_at.ms / 1000 -
        command.block_timestamp,
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
          command?.block_timestamp &&
          wrap?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total:
              command.block_timestamp -
              wrap.created_at.ms / 1000,
          };
        }
        else if (
          unwrap?.created_at?.ms &&
          send?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total:
              unwrap.created_at.ms / 1000 -
              send.created_at.ms / 1000,
          };
        }
        else if (
          command?.block_timestamp &&
          send?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total:
              command.block_timestamp -
              send.created_at.ms / 1000,
          };
        }
        break;
      case 'cosmos':
        if (
          ibc_send?.received_at?.ms &&
          wrap?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total:
              ibc_send.received_at.ms / 1000 -
              wrap.created_at.ms / 1000,
          };
        }
        else if (
          ibc_send?.received_at?.ms &&
          send?.created_at?.ms
        ) {
          time_spent = {
            ...time_spent,
            total:
              ibc_send.received_at.ms / 1000 -
              send.created_at.ms / 1000,
          };
        }
        break;
      case 'axelarnet':
        switch (source_chain_type) {
          case 'evm':
            if (
              axelar_transfer?.created_at?.ms &&
              wrap?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total:
                  axelar_transfer.created_at.ms / 1000 -
                  wrap.created_at.ms / 1000,
              };
            }
            else if (
              axelar_transfer?.created_at?.ms &&
              send?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total:
                  axelar_transfer.created_at.ms / 1000 -
                  send.created_at.ms / 1000,
              };
            }
            else if (
              vote?.created_at?.ms &&
              wrap?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total:
                  vote.created_at.ms / 1000 -
                  wrap.created_at.ms / 1000,
              };
            }
            else if (
              vote?.created_at?.ms &&
              send?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total:
                  vote.created_at.ms / 1000 -
                  send.created_at.ms / 1000,
              };
            }
            break;
          default:
            if (
              axelar_transfer?.created_at?.ms &&
              send?.created_at?.ms
            ) {
              time_spent = {
                ...time_spent,
                total:
                  axelar_transfer.created_at.ms / 1000 -
                  send.created_at.ms / 1000,
              };
            }
            else {
              if (time_spent.send_confirm) {
                time_spent = {
                  ...time_spent,
                  total: time_spent.send_confirm,
                };
              }
              else if (time_spent.send_vote) {
                time_spent = {
                  ...time_spent,
                  total: time_spent.send_vote,
                };
              }

              if (
                time_spent.vote_axelar_transfer ||
                time_spent.confirm_axelar_transfer
              ) {
                time_spent = {
                  ...time_spent,
                  total:
                    time_spent.vote_axelar_transfer ||
                    time_spent.confirm_axelar_transfer,
                };
              }
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
  get_distinguish_chain_id,
  get_others_version_chain_ids,
  normalize_link,
  update_link,
  update_send,
  save_time_spent,
};