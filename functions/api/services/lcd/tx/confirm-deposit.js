const {
  BigNumber,
  Contract,
  constants: { AddressZero },
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  read,
  write,
} = require('../../index');
const {
  normalize_link,
  update_link,
  update_send,
  save_time_spent,
} = require('../../transfers/utils');
const {
  sleep,
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
  transfer_actions,
  getTransaction,
  getBlockTime,
  getProvider,
} = require('../../../utils');
const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

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
const cosmos_non_axelarnet_chains_data =
  cosmos_chains_data
    .filter(c =>
      c?.id !== axelarnet.id
    );
const assets_data =
  require('../../../data')?.assets?.[environment] ||
  [];

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
      logs,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

    const message =
      _.head(
        (logs || [])
          .flatMap(l =>
            (l?.events || [])
              .filter(e =>
                equals_ignore_case(
                  e?.type,
                  'message',
                )
              )
          )
      );

    const event =
      _.head(
        (logs || [])
          .flatMap(l =>
            (l?.events || [])
              .filter(e =>
                [
                  'depositConfirmation',
                  'eventConfirmation',
                  'ConfirmDeposit',
                ].findIndex(s =>
                  e?.type?.includes(s)
                ) > -1
              )
          )
      );

    const {
      attributes,
    } = { ...event };

    const type =
      (message?.attributes || [])
        .find(a =>
          a?.key === 'action' &&
          transfer_actions.includes(a.value)
        )?.value ||
      (
        _.last(
          (
            messages
              .find(m =>
                transfer_actions
                  .includes(
                    (
                      _.last(
                        (m?.['@type'] || '')
                          .split('.')
                      ) ||
                      ''
                    )
                    .replace(
                      'Request',
                      '',
                    )
                  )
              )?.['@type'] ||
            ''
          )
          .split('.')
        ) ||
        ''
      )
      .replace(
        'Request',
        '',
      );

    let created_at =
      moment(timestamp)
        .utc()
        .valueOf();

    const deposit_address =
      to_hex(
        messages
          .find(m =>
            m?.deposit_address
          )?.deposit_address ||
        (attributes || [])
          .find(a =>
            [
              'deposit_address',
              'depositAddress',
            ].includes(a?.key)
          )?.value
      );

    const token_address =
      to_hex(
        (attributes || [])
          .find(a =>
            [
              'token_address',
              'tokenAddress',
            ].includes(a?.key)
          )?.value
      );

    const asset =
      (
        (attributes || [])
          .find(a =>
            a?.key === 'asset'
          )?.value ||
        ''
      )
      .split('"')
      .join('');

    const poll_id =
      to_json(
        (attributes || [])
          .find(a =>
            a?.key === 'participants'
          )?.value
      )?.poll_id ||
      to_json(
        (attributes || [])
          .find(a =>
            a?.key === 'poll'
          )?.value
      )?.id;

    let transfer_id =
      Number(
        (attributes || [])
          .find(a =>
            a?.key === 'transferID'
          )?.value
      );

    let transaction_id =
      to_hex(
        (attributes || [])
          .find(a =>
            [
              'tx_id',
              'txID',
            ].includes(a?.key)
          )?.value ||
        _.head(
          (poll_id || '')
            .split('_')
        )
      );

    if (transaction_id === poll_id) {
      transaction_id = null;
    }

    const {
      participants,
    } = {
      ...(
        to_json(
          (attributes || [])
            .find(a =>
              a?.key === 'participants'
            )?.value
        )
      ),
    };

    // cross-chain transfers
    if (
      txhash &&
      !code
    ) {
      if (
        poll_id &&
        !(
          transfer_id &&
          transaction_id
        )
      ) {
        const _response =
          await get(
            'evm_polls',
            poll_id,
          );

        if (_response) {
          transfer_id =
            _response.transfer_id ||
            transfer_id;

          transaction_id =
            _response.transaction_id ||
            transaction_id;
        }
      }

      const source_chain =
        normalize_chain(
          messages
            .find(m =>
              m?.chain
            )?.chain ||
          (attributes || [])
            .find(a =>
              [
                'sourceChain',
                'chain',
              ].includes(a?.key)
            )?.value
        );

      let destination_chain =
        normalize_chain(
          (attributes || [])
            .find(a =>
              [
                'destinationChain',
              ].includes(a?.key)
            )?.value
        );

      if (
        poll_id ||
        transfer_id
      ) {
        const record = {
          txhash,
          height,
          status:
            code ?
              'failed' :
              'success',
          type,
          created_at: get_granularity(created_at),
          source_chain,
          destination_chain,
          deposit_address,
          token_address,
          denom:
            tx_response.denom ||
            messages
              .find(m =>
                m?.denom
              )?.denom ||
            asset,
          amount:
            (attributes || [])
              .find(a =>
                a?.key === 'amount'
              )?.value,
          poll_id,
          transfer_id,
          transaction_id,
          participants,
        };

        switch (type) {
          case 'ConfirmDeposit':
            try {
              // get destination chain from link
              if (!destination_chain) {
                const _response =
                  await read(
                    'deposit_addresses',
                    {
                      match: { deposit_address },
                    },
                    {
                      size: 1,
                    },
                  );

                const link =
                  normalize_link(
                    _.head(
                      _response?.data
                    ),
                  );

                destination_chain =
                  normalize_chain(
                    link?.destination_chain ||
                    destination_chain
                  );
              }

              // command data in evm batch
              let command;

              if (
                destination_chain &&
                transfer_id
              ) {
                const command_id =
                  transfer_id
                    .toString(16)
                    .padStart(
                      64,
                      '0',
                    );

                const _response =
                  await read(
                    'batches',
                    {
                      bool: {
                        must: [
                          { match: { chain: destination_chain } },
                          { match: { command_ids: command_id } },
                        ],
                        should: [
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                          { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                const batch =
                  _.head(
                    _response?.data
                  );

                if (batch) {
                  const {
                    batch_id,
                    commands,
                    created_at,
                  } = { ...batch };

                  const command_data = (commands || [])
                    .find(c =>
                      c?.id === command_id
                    );

                  let {
                    executed,
                    transactionHash,
                    transactionIndex,
                    logIndex,
                    block_timestamp,
                  } = { ...command_data };

                  if (!transactionHash) {
                    const _response =
                      await read(
                        'command_events',
                        {
                          bool: {
                            must: [
                              { match: { chain: destination_chain } },
                              { match: { command_id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );

                    const command_event =
                      _.head(
                        _response?.data
                      );

                    if (command_event) {
                      transactionHash = command_event.transactionHash;
                      transactionIndex = command_event.transactionIndex;
                      logIndex = command_event.logIndex;
                      block_timestamp = command_event.block_timestamp;

                      if (transactionHash) {
                        executed = true;
                      }
                    }
                  }

                  executed =
                    executed ||
                    !!transactionHash;

                  if (!executed) {
                    const chain_data = evm_chains_data
                      .find(c =>
                        equals_ignore_case(
                          c?.id,
                          destination_chain,
                        )
                      );

                    const {
                      chain_id,
                      gateway_address,
                    } = { ...chain_data };

                    if (gateway_address) {
                      try {
                        const gateway_contract =
                          new Contract(
                            gateway_address,
                            IAxelarGateway.abi,
                            getProvider(chain_data),
                          );

                        executed =
                          await gateway_contract
                            .isCommandExecuted(
                              `0x${command_id}`,
                            );
                      } catch (error) {}
                    }
                  }

                  command = {
                    chain: destination_chain,
                    command_id,
                    transfer_id,
                    batch_id,
                    created_at,
                    executed,
                    transactionHash,
                    transactionIndex,
                    logIndex,
                    block_timestamp,
                  };
                }
              }

              const _response =
                await read(
                  'cross_chain_transfers',
                  {
                    bool: {
                      must: [
                        { exists: { field: 'send.txhash' } },
                        { match: { 'send.status': 'success' } },
                        { range: { 'send.created_at.ms': { lte: created_at } } },
                        { match: { 'send.recipient_address': deposit_address } },
                      ],
                      should: [
                        { range: { 'confirm.created_at.ms': { gt: created_at } } },
                        {
                          bool: {
                            must_not: [
                              { exists: { field: 'confirm' } },
                            ],
                          },
                        },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                  {
                    size: 25,
                  },
                );

              let {
                data,
              } = { ..._response };

              if (
                command &&
                (data || [])
                  .length < 1
              ) {
                const _response =
                  await read(
                    'cross_chain_transfers',
                    {
                      bool: {
                        must: [
                          { exists: { field: 'send.txhash' } },
                          { match: { 'send.status': 'success' } },
                          { match: { 'send.recipient_address': deposit_address } },
                        ],
                        should: [
                          { match: { 'confirm.transfer_id': transfer_id } },
                          { match: { 'vote.transfer_id': transfer_id } },
                          { match: { transfer_id } },
                        ],
                        minimum_should_match: 1,
                      },
                    },
                    {
                      size: 25,
                    },
                  );

                data =
                  _response?.data ||
                  [];
              }

              for (const d of data) {
                let {
                  send,
                  link,
                } = { ...d };
                const {
                  txhash,
                  sender_address,
                  recipient_address,
                } = { ...send };
                let {
                  source_chain,
                } = { ...send };

                source_chain =
                  normalize_chain(
                    cosmos_non_axelarnet_chains_data
                      .find(c =>
                        sender_address?.startsWith(c?.prefix_address)
                      )?.id ||
                    source_chain ||
                    record.source_chain
                  );

                send.source_chain = source_chain;
                send.destination_chain = destination_chain;

                const _response =
                  await read(
                    'unwraps',
                    {
                      bool: {
                        must: [
                          { match: { tx_hash: txhash } },
                          { match: { deposit_address_link: recipient_address } },
                          { match: { source_chain } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                let unwrap =
                  _.head(
                    _response?.data
                  );

                if (unwrap) {
                  const {
                    tx_hash_unwrap,
                    destination_chain,
                  } = { ...unwrap };

                  const chain_data = evm_chains_data
                    .find(c =>
                      equals_ignore_case(
                        c?.id,
                        destination_chain,
                      )
                    );

                  if (
                    tx_hash_unwrap &&
                    chain_data
                  ) {
                    const provider = getProvider(chain_data);

                    const data =
                      await getTransaction(
                        provider,
                        tx_hash_unwrap,
                        destination_chain,
                      );

                    const {
                      blockNumber,
                      from,
                    } = { ...data?.transaction };

                    if (blockNumber) {
                      const block_timestamp =
                        await getBlockTime(
                          provider,
                          blockNumber,
                        );

                      unwrap = {
                        ...unwrap,
                        height: blockNumber,
                        type: 'evm',
                        created_at:
                          get_granularity(
                            moment(
                              block_timestamp * 1000
                            )
                            .utc()
                          ),
                        sender_address: from,
                      };
                    }
                  }
                }

                const type =
                  unwrap ?
                    'unwrap' :
                    'deposit_address';

                const data = {
                  type,
                  unwrap:
                    unwrap ||
                    undefined,
                };

                link =
                  await update_link(
                    link,
                    send,
                  );

                send =
                  await update_send(
                    send,
                    link,
                    data,
                    true,
                  );

                if (source_chain) {
                  const _id = `${txhash}_${source_chain}`.toLowerCase();

                  await sleep(0.5 * 1000);

                  await write(
                    'cross_chain_transfers',
                    _id,
                    {
                      ...d,
                      ...data,
                      send,
                      link,
                      confirm: record,
                      command:
                        command ||
                        undefined,
                    },
                  );

                  await save_time_spent(
                    _id,
                  );
                }
              }
            } catch (error) {}
            break;
          case 'ConfirmERC20Deposit':
            try {
              const {
                source_chain,
                destination_chain,
                deposit_address,
                token_address,
                transaction_id,
              } = { ...record };
              let {
                denom,
                amount,
              } = { ...record };

              if (transaction_id) {
                const chain_data = evm_chains_data
                  .find(c =>
                    equals_ignore_case(
                      c?.id,
                      source_chain,
                    )
                  );

                const {
                  chain_id,
                } = { ...chain_data };

                if (chain_id) {
                  const provider = getProvider(chain_data);

                  if (provider) {
                    const transaction =
                      await provider
                        .getTransaction(
                          transaction_id,
                        );

                    const {
                      blockNumber,
                      from,
                      to,
                      input,
                    } = { ...transaction };

                    if (blockNumber) {
                      let _amount;

                      const asset_data = assets_data
                        .find(a =>
                          (a?.contracts || [])
                            .findIndex(c =>
                              c?.chain_id === chain_id &&
                              [
                                to,
                                token_address,
                              ].findIndex(_a =>
                                equals_ignore_case(
                                  c?.contract_address,
                                  _a,
                                )
                              ) > -1
                            ) > -1
                        );

                      if (
                        !asset_data ||
                        !amount
                      ) {
                        const receipt =
                          await provider
                            .getTransactionReceipt(
                              transaction_id,
                            );

                        const {
                          logs,
                        } = { ...receipt };

                        _amount =
                          _.head(
                            (logs || [])
                              .filter(l =>
                                // !denom ||
                                assets_data
                                  .findIndex(a =>
                                    equals_ignore_case(
                                      a?.id,
                                      denom,
                                    ) &&
                                    (a?.contracts || [])
                                      .findIndex(c =>
                                        c?.chain_id === chain_id &&
                                        equals_ignore_case(
                                          c?.contract_address,
                                          l?.address,
                                        )
                                      ) > -1
                                  ) > -1
                              )
                              .map(l =>
                                l?.data
                              )
                              .filter(d =>
                                d?.length >= 64
                              )
                              .map(d => {
                                d =
                                  d
                                    .substring(
                                      d.length - 64,
                                    )
                                    .replace(
                                      '0x',
                                      '',
                                    )
                                    .replace(
                                      /^0+/,
                                      '',
                                    );

                                if (!d) {
                                  d =
                                    AddressZero
                                      .replace(
                                        '0x',
                                        '',
                                      );
                                }

                                return d;
                              })
                              .filter(d => {
                                try {
                                  d =
                                    BigNumber.from(
                                      `0x${d}`
                                    );

                                  return true;
                                } catch (error) {
                                  return false;
                                }
                              })
                          );
                      }

                      denom =
                        asset_data?.id ||
                        denom;

                      amount =
                        amount ||
                        BigNumber.from(
                          `0x${
                            _amount ||
                            (transaction.data || '')
                              .substring(
                                10 + 64,
                              ) ||
                            (input || '')
                              .substring(
                                10 + 64
                              ) ||
                            '0'
                          }`
                        )
                        .toString();

                      const block_timestamp =
                        await getBlockTime(
                          provider,
                          blockNumber,
                        );

                      if (block_timestamp) {
                        created_at = block_timestamp * 1000;
                      }

                      let send = {
                        txhash: transaction_id,
                        height: blockNumber,
                        status: 'success',
                        type: 'evm',
                        created_at: get_granularity(created_at),
                        source_chain,
                        destination_chain,
                        sender_address: from,
                        recipient_address: deposit_address,
                        token_address,
                        denom,
                        amount,
                      };

                      const _response =
                        await read(
                          'deposit_addresses',
                          {
                            match: { deposit_address },
                          },
                          {
                            size: 1,
                          },
                        );

                      let link =
                        _.head(
                          _response?.data
                        );

                      link =
                        await update_link(
                          link,
                          send,
                        );

                      send =
                        await update_send(
                          send,
                          link,
                        );

                      if (
                        send.txhash &&
                        send.source_chain
                      ) {
                        const {
                          txhash,
                          source_chain,
                          recipient_address,
                          amount,
                        } = { ...send };

                        const _response =
                          await read(
                            'unwraps',
                            {
                              bool: {
                                must: [
                                  { match: { tx_hash: txhash } },
                                  { match: { deposit_address_link: recipient_address } },
                                  { match: { source_chain } },
                                ],
                              },
                            },
                            {
                              size: 1,
                            },
                          );

                        let unwrap =
                          _.head(
                            _response?.data
                          );

                        if (unwrap) {
                          const {
                            tx_hash_unwrap,
                            destination_chain,
                          } = { ...unwrap };

                          const chain_data = evm_chains_data
                            .find(c =>
                              equals_ignore_case(
                                c?.id,
                                destination_chain,
                              )
                            );

                          if (
                            tx_hash_unwrap &&
                            chain_data
                          ) {
                            const provider = getProvider(chain_data);

                            const data =
                              await getTransaction(
                                provider,
                                tx_hash_unwrap,
                                destination_chain,
                              );

                            const {
                              blockNumber,
                              from,
                            } = { ...data?.transaction };

                            if (blockNumber) {
                              const block_timestamp =
                                await getBlockTime(
                                  provider,
                                  blockNumber,
                                );

                              unwrap = {
                                ...unwrap,
                                height: blockNumber,
                                type: 'evm',
                                created_at:
                                  get_granularity(
                                    moment(
                                      block_timestamp * 1000
                                    )
                                    .utc()
                                  ),
                                sender_address: from,
                              };
                            }
                          }
                        }

                        const type =
                          unwrap ?
                            'unwrap' :
                            'deposit_address';

                        const data = {
                          type,
                          unwrap:
                            unwrap ||
                            undefined,
                        };

                        const _id = `${txhash}_${source_chain}`.toLowerCase();

                        await sleep(0.5 * 1000);

                        await write(
                          'cross_chain_transfers',
                          _id,
                          {
                            ...data,
                            send: {
                              ...send,
                              amount,
                            },
                            link:
                              link ||
                              undefined,
                            confirm: record,
                          },
                        );

                        await save_time_spent(
                          _id,
                        );
                      }
                    }
                  }
                }
              }
            } catch (error) {}
            break;
          default:
            break;
        }
      }

      if (
        poll_id &&
        transaction_id
      ) {
        await write(
          'evm_polls',
          poll_id,
          {
            id: poll_id,
            height,
            created_at: get_granularity(created_at),
            sender_chain: source_chain,
            transaction_id,
            participants:
              participants ||
              undefined,
          },
          true,
        );
      }
    }
  } catch (error) {}
};