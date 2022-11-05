const {
  BigNumber,
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
  saveTimeSpent,
  update_link,
  update_source,
} = require('../../transfers/utils');
const {
  sleep,
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
  transfer_actions,
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
                transfer_actions.includes(
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

    let created_at =
      moment(timestamp)
        .utc()
        .valueOf();

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

    const {
      participants,
    } = {
      ...to_json(
        (attributes || [])
          .find(a =>
            a?.key === 'participants'
          )?.value
      ),
    };

    const record = {
      id: txhash,
      type,
      status_code: code,
      status: code ?
        'failed' :
        'success',
      height,
      created_at: get_granularity(created_at),
      user: messages
        .find(m =>
          m?.sender
        )?.sender,
      module:
        (attributes || [])
          .find(a =>
            a?.key === 'module'
          )?.value ||
        (type === 'ConfirmDeposit' ?
          axelarnet.id :
          'evm'
        ),
      sender_chain:
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
        ),
      recipient_chain:
        normalize_chain(
          (attributes || [])
            .find(a =>
              [
                'destinationChain',
              ].includes(a?.key)
            )?.value
        ),
      deposit_address,
      token_address,
      amount:
        (attributes || [])
          .find(a =>
            a?.key === 'amount'
          )?.value,
      denom:
        tx_response.denom ||
        messages
          .find(m =>
            m?.denom
          )?.denom ||
        asset,
      transfer_id:
        Number(
          (attributes || [])
            .find(a =>
              a?.key === 'transferID'
            )?.value
        ),
      poll_id,
      transaction_id,
      participants,
    };

    const {
      id,
      status_code,
    } = { ...record };
    let {
      recipient_chain,
      transfer_id,
    } = { ...record };

    if (
      id &&
      !status_code &&
      (
        poll_id ||
        transfer_id
      )
    ) {
      if (
        poll_id &&
        !(
          transaction_id &&
          transfer_id
        )
      ) {
        const _response =
          await get(
            'evm_polls',
            poll_id,
          );

        if (_response) {
          transaction_id =
            _response.transaction_id ||
            transaction_id;

          transfer_id =
            _response.transfer_id ||
            transfer_id;

          record.transaction_id = transaction_id;
          record.transfer_id = transfer_id;
        }
      }

      switch (type) {
        case 'ConfirmDeposit':
          try {
            if (!recipient_chain) {
              const _response =
                !recipient_chain &&
                await read(
                  'deposit_addresses',
                  {
                    match: { deposit_address },
                  },
                  {
                    size: 1,
                  },
                );

              const link = _.head(_response?.data);

              recipient_chain =
                normalize_chain(
                  link?.recipient_chain ||
                  recipient_chain
                );
            }

            let sign_batch;

            if (
              recipient_chain &&
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
                        { match: { chain: recipient_chain } },
                        { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                        { match: { command_ids: command_id } },
                      ],
                    },
                  },
                  {
                    size: 1,
                  },
                );

              const batch = _.head(_response?.data);

              if (batch) {
                const {
                  batch_id,
                  commands,
                  created_at,
                } = { ...batch };

                const command = (commands || [])
                  .find(c =>
                    c?.id === command_id
                  );

                let {
                  executed,
                  transactionHash,
                  transactionIndex,
                  logIndex,
                  block_timestamp,
                } = { ...command };

                executed =
                  executed ||
                  !!transactionHash;

                if (!executed) {
                  const chain_data = evm_chains_data
                    .find(c =>
                      equals_ignore_case(c?.id, recipient_chain)
                    );

                  const provider = getProvider(chain_data);

                  const {
                    chain_id,
                    gateway_address,
                  } = { ...chain_data };

                  const gateway_contract =
                    gateway_address &&
                    new Contract(
                      gateway_address,
                      IAxelarGateway.abi,
                      provider,
                    );

                  try {
                    if (gateway_contract) {
                      executed =
                        await gateway_contract
                          .isCommandExecuted(
                            `0x${command_id}`,
                          );
                    }
                  } catch (error) {}
                }

                if (!transactionHash) {
                  const _response =
                    await read(
                      'command_events',
                      {
                        bool: {
                          must: [
                            { match: { chain: recipient_chain } },
                            { match: { command_id } },
                          ],
                        },
                      },
                      {
                        size: 1,
                      },
                    );

                  const command_event = _.head(__response?.data);

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

                sign_batch = {
                  chain: recipient_chain,
                  batch_id,
                  created_at,
                  command_id,
                  transfer_id,
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
                'transfers',
                {
                  bool: {
                    must: [
                      { match: { 'source.status_code': 0 } },
                      { match: { 'source.recipient_address': deposit_address } },
                      { range: { 'source.created_at.ms': { lte: created_at } } },
                    ],
                    should: [
                      { range: { 'confirm_deposit.created_at.ms': { gt: created_at } } },
                      { bool: {
                        must_not: [
                          { exists: { field: 'confirm_deposit' } },
                        ],
                      } },
                    ],
                    minimum_should_match: 1,
                  },
                },
                {
                  size: 100,
                },
              );

            let {
              data
            } = { ..._response };

            data = (data || [])
              .filter(t => t?.source?.id);

            if (
              data.length < 1 &&
              sign_batch
            ) {
              const _response =
                await read(
                  'transfers',
                  {
                    bool: {
                      must: [
                        { match: { 'source.recipient_address': deposit_address } },
                      ],
                      should: [
                        { match: { 'confirm_deposit.transfer_id': transfer_id } },
                        { match: { 'vote.transfer_id': transfer_id } },
                        { match: { transfer_id } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                  {
                    size: 100,
                  },
                );

              data = (_response?.data || [])
                .filter(t => t?.source?.id);
            }

            for (const d of data) {
              let {
                source,
                link,
              } = { ...d };
              const {
                id,
                sender_address,
                recipient_address,
              } = { ...source };
              let {
                sender_chain,
              } = { ...source };

              sender_chain =
                normalize_chain(
                  cosmos_non_axelarnet_chains_data
                    .find(c =>
                      sender_address?.startsWith(c?.prefix_address)
                    )?.id ||
                  sender_chain ||
                  record.sender_chain
                );

              source.sender_chain = sender_chain;
              source.recipient_chain = recipient_chain;

              link =
                await update_link(
                  link,
                  source,
                );

              source =
                await update_source(
                  source,
                  link,
                  true,
                );

              if (recipient_address) {
                const _id = `${id}_${recipient_address}`.toLowerCase();

                await sleep(0.5 * 1000);

                await write(
                  'transfers',
                  _id,
                  {
                    ...d,
                    source,
                    link,
                    confirm_deposit: record,
                    sign_batch:
                      sign_batch ||
                      undefined,
                  },
                );

                await saveTimeSpent(
                  _id,
                );
              }
            }
          } catch (error) {}
          break;
        case 'ConfirmERC20Deposit':
          try {
            const {
              sender_chain,
              recipient_chain,
              deposit_address,
              transaction_id,
            } = { ...record };
            let {
              amount,
              denom,
            } = { ...record };

            if (transaction_id) {
              const chain_data = evm_chains_data
                .find(c =>
                  equals_ignore_case(
                    c?.id,
                    sender_chain,
                  )
                );

              const provider = getProvider(chain_data);

              const {
                chain_id,
              } = { ...chain_data };

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

              const asset_data = assets_data
                .find(a =>
                  (a?.contracts || [])
                    .findIndex(c =>
                      c?.chain_id === chain_id &&
                      equals_ignore_case(
                        c?.contract_address,
                        to,
                      )
                    ) > -1
                );

              let _amount;

              if (!asset_data) {
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
                      .map(l => l?.data)
                      .filter(d => d?.length >= 64)
                      .map(d =>
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
                          )
                      )
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

              if (blockNumber) {
                amount =
                  BigNumber.from(
                    `0x${
                      (transaction.data || '')
                        .substring(
                          10 + 64,
                        ) ||
                      (input || '')
                        .substring(
                          10 + 64
                        ) ||
                      _amount ||
                      '0'
                    }`
                  )
                  .toString() ||
                  amount;

                denom =
                  asset_data?.id ||
                  denom;

                const block_timestamp =
                  await getBlockTime(
                    provider,
                    blockNumber,
                  );

                if (block_timestamp) {
                  created_at = block_timestamp * 1000;
                }

                let source = {
                  id: transaction_id,
                  type: 'evm_transfer',
                  status_code: 0,
                  status: 'success',
                  height: blockNumber,
                  created_at: get_granularity(created_at),
                  sender_chain,
                  recipient_chain,
                  sender_address: from,
                  recipient_address: deposit_address,
                  amount,
                  denom,
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

                let link = _.head(_response?.data);

                link =
                  await update_link(
                    link,
                    source,
                  );

                source =
                  await update_source(
                    source,
                    link,
                  );

                const {
                  id,
                  recipient_address,
                } = { ...source };

                if (recipient_address) {
                  const _id = `${id}_${recipient_address}`.toLowerCase();

                  const {
                    amount,
                  } = { ...source };

                  await sleep(0.5 * 1000);

                  await write(
                    'transfers',
                    _id,
                    {
                      source: {
                        ...source,
                        amount,
                      },
                      link:
                        link ||
                        undefined,
                      confirm_deposit: record,
                    },
                  );

                  await saveTimeSpent(
                    _id,
                  );
                }
              }
            }
          } catch (error) {}
          break;
        default:
          break;
      }
    }
  } catch (error) {}
};