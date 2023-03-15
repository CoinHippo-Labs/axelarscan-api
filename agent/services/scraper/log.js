const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const readline = require('readline');
const TailFile = require('@logdna/tail-file');
const {
  log,
  sleep,
} = require('../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const service_name = 'log-scraper';

const {
  endpoints,
} = { ...config?.[environment] };

const construct = (
  raw_data,
  attributes,
  initial_data = {},
) => {
  let data = {
    ...initial_data,
  };

  if (
    raw_data &&
    attributes
  ) {
    attributes
      .forEach(a => {
        try {
          const {
            id,
            primary_key,
            pattern_start,
            pattern_end,
            type,
            hard_value,
          } = { ...a };

          const from =
            pattern_start ?
              raw_data.indexOf(pattern_start) +
              pattern_start.length :
              0;

          const to =
            typeof pattern_end === 'string' &&
            raw_data.indexOf(pattern_end) > -1 ?
              raw_data.indexOf(pattern_end) :
              raw_data.length;

          if ('hard_value' in a) {
            data = {
              ...data,
              [id]: hard_value,
            };
          }
          else {
            data = {
              ...data,
              [id]:
                (
                  raw_data
                    .substring(
                      from,
                      to,
                    ) ||
                    ''
                )
                .trim(),
            };

            data = {
              ...data,
              [id]:
                type === 'date' ?
                  Number(
                    moment(data[id])
                      .format('X')
                  ) :
                  type === 'number' ?
                    Number(data[id]) :
                    type?.startsWith('array') ?
                      data[id]
                        .replace(
                          '[',
                          '',
                        )
                        .replace(
                          ']',
                          '',
                        )
                        .split('"')
                        .join('')
                        .split('\\n')
                        .join('')
                        .split('\\')
                        .join('')
                        .split(',')
                        .map(e => e?.trim())
                        .filter(e => e)
                        .map(e =>
                          type?.includes('number') ?
                            Number(e) :
                            e
                        )
                        .filter(e => e) :
                      type === 'json' ?
                        JSON.parse(
                          data[id]
                        ) :
                        data[id],
            };
          }

          if (primary_key) {
            data = {
              ...data,
              id: data[id],
            };
          }
        } catch (error) {}
      });
  }

  return data;
};

const save = async (
  data,
  collection,
  api,
  is_update = false,
  delay_sec = 0,
) => {
  const {
    key_id,
    timestamp,
  } = { ...data };
  let {
    id,
    height,
    snapshot,
    snapshot_validators,
    key_role,
    threshold,
    threshold_weight,
    bonded_weight,
    participants,
  } = { ...data };

  if (
    data &&
    collection &&
    api &&
    (
      id ||
      collection.endsWith('keygens')
    )
  ) {
    if (typeof snapshot === 'number') {
      let response =
        await api
          .get(
            '',
            {
              params: {
                module: 'cli',
                cmd: `axelard q snapshot info ${snapshot} -oj`,
                cache: true,
                cache_timeout: 5,
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
        stderr,
      } = { ...response?.data };
      let {
        stdout,
      } = { ...response?.data };

      // handle error
      if (
        !stdout &&
        stderr &&
        moment()
          .diff(
            moment(
              timestamp * 1000
            ),
            'day',
          ) <= 1
      ) {
        response =
          await api
            .get(
              '',
              {
                params: {
                  module: 'cli',
                  cmd: 'axelard q snapshot info latest -oj',
                  cache: true,
                  cache_timeout: 5,
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

        stdout = response?.data?.stdout;
      }

      if (stdout) {
        try {
          const snapshot_data =
            JSON.parse(
              stdout
            );

          if (!height) {
            height = Number(snapshot_data.height);
          }

          id = `${key_id}_${height}`;
          snapshot = snapshot_data.counter;
          snapshot_validators = snapshot_data;

          data = {
            ...data,
            id,
            height,
            snapshot,
            snapshot_validators,
          };
        } catch (error) {}
      }
    }

    if (key_id) {
      const response =
        await api
          .get(
            '',
            {
              params: {
                module: 'cli',
                cmd: `axelard q multisig key ${key_id} -oj`,
                cache: true,
                cache_timeout: 15,
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
        stdout,
      } = { ...response?.data };

      if (stdout) {
        try {
          const key_data =
            JSON.parse(
              stdout
            );

          if (key_data) {
            const {
              role,
              multisig_key,
              started_at,
            } = { ...key_data };

            if (
              role &&
              !role.includes('KEY_ROLE_UNSPECIFIED')
            ) {
              key_role = role;
            }

            if (multisig_key) {
              if (
                multisig_key.threshold &&
                !['sign_attempts'].includes(collection)
              ) {
                threshold = Number(multisig_key.threshold) - 1;
              }
            }
            else {
              if (!isNaN(key_data.threshold_weight)) {
                threshold_weight = Number(key_data.threshold_weight);
                threshold = threshold_weight;
              }

              bonded_weight =
                bonded_weight ||
                (
                  !isNaN(key_data.bonded_weight) ?
                    Number(key_data.bonded_weight) :
                    undefined
                );

              participants = (key_data.participants || [])
                .map(p => {
                  let {
                    weight,
                  } = { ...p };

                  weight =
                    !isNaN(weight) ?
                      Number(weight) :
                      undefined;

                  return {
                    ...p,
                    weight,
                  };
                });

              data = {
                ...data,
                ...key_data,
                height:
                  started_at ?
                    Number(started_at) :
                    height,
                started_at:
                  !isNaN(started_at) ?
                    Number(started_at) :
                    undefined,
                bonded_weight,
                participants,
              };
            }

            data = {
              ...data,
              key_role,
              threshold,
              threshold_weight,
            };
          }
        } catch (error) {}
      }
    }

    if (id) {
      if (is_update) {
        await sleep(delay_sec * 1000);
      }

      log(
        'debug',
        service_name,
        'index',
        {
          collection,
          id,
        },
      );

      await api
        .post(
          '',
          {
            module: 'index',
            collection,
            method: 'update',
            path:
              is_update ?
                `/${collection}/_update/${id}` :
                undefined,
            id,
            ...data,
          },
        )
        .catch(error => {
          return {
            data: {
              error,
            },
          };
        });
    }
  }
};

module.exports = async () => {
  if (endpoints?.api) {
    // initial api
    const api =
      axios.create(
        {
          baseURL: endpoints.api,
          timeout: 10000,
        },
      );

    // setup log stream
    const tail = new TailFile(
      `/home/axelard/.axelar${
        [
          'testnet',
          'testnet-2',
        ].includes(environment) ?
          `_${environment}` :
          ''
      }/logs/axelard.log`,
      {
        encoding: 'utf8',
        startPos: 0,
      }
    )
    .on(
      'tail_error',
      error =>
        log(
          'error',
          service_name,
          'tail error',
          { ...error },
        ),
    );

    // initial temp variables
    let height,
      snapshot = 0,
      exclude_validators = {},
      last_batch;

    const keygen_patterns =
      [
        'keygen session started',
        'setting key',
      ];

    try {
      await tail.start();
      const splitter = readline
        .createInterface(
          {
            input: tail,
          }
        );

      // subscribe log data
      splitter
        .on(
          'line',
          async chunk => {
            const data =
              chunk
                .toString('utf8')
                .replace(
                  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
                  '',
                )
                .trim();

            // block
            if (data.includes('executed block height=')) {
              const attributes =
                [
                  {
                    id: 'height',
                    pattern_start: 'executed block height=',
                    pattern_end: ' module=',
                    type: 'number',
                  },
                ];

              height =
                construct(
                  data,
                  attributes,
                ).height;

              log(
                'debug',
                service_name,
                'block',
                {
                  height,
                },
              );
            }
            // participations
            else if (data.includes('next sign: sig_id')) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'sig_id',
                    primary_key: true,
                    pattern_start: 'sig_id [',
                    pattern_end: '] key_id',
                  },
                  {
                    id: 'key_id',
                    pattern_start: 'key_id [',
                    pattern_end: '] message',
                  },
                  {
                    id: 'non_participant_shares',
                    pattern_start: 'nonParticipantShareCounts=',
                    pattern_end: ' nonParticipants=',
                    type: 'array_number',
                  },
                  {
                    id: 'non_participants',
                    pattern_start: 'nonParticipants=',
                    pattern_end: ' participantShareCounts=',
                    type: 'array',
                  },
                  {
                    id: 'participant_shares',
                    pattern_start: 'participantShareCounts=',
                    pattern_end: ' participants=',
                    type: 'array_number',
                  },
                  {
                    id: 'participants',
                    pattern_start: 'participants=',
                    pattern_end: ' payload=',
                    type: 'array',
                  },
                  {
                    id: 'result',
                    hard_value: true,
                  },
                ];

              log(
                'debug',
                service_name,
                'next sign',
              );

              let obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                const _height = height;
                const {
                  sig_id,
                } = { ...obj };
                let {
                  participants,
                  non_participants,
                } = { ...obj };

                participants = (participants || [])
                  .filter(a =>
                    a?.startsWith('axelarvaloper')
                  );

                non_participants = (non_participants || [])
                  .filter(a => a)
                  .map(a => {
                    const pattern_start = 'operator_address: ',
                      pattern_end = 'consensus_pubkey:';

                    const from =
                      pattern_start ?
                        a.indexOf(pattern_start) +
                        pattern_start.length :
                        0;

                    const to =
                      typeof pattern_end === 'string' &&
                      a.indexOf(pattern_end) > -1 ?
                        a.indexOf(pattern_end) :
                        a.length;

                    return (
                      a
                        .substring(
                          from,
                          to,
                        )
                        .trim()
                    );
                  })
                  .filter(a =>
                    a.startsWith('axelarvaloper')
                  );

                if (sig_id) {
                  const response =
                    await api
                      .get(
                        '',
                        {
                          params: {
                            module: 'lcd',
                            path: '/cosmos/tx/v1beta1/txs',
                            events: `sign.sigID='${sig_id}'`,
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
                    tx_responses,
                  } = { ...response?.data };

                  if (_.head(tx_responses)?.height) {
                    obj.height = Number(_.head(tx_responses).height);
                  }
                }

                if (
                  !obj.height &&
                  _height
                ) {
                  obj.height = _height;
                }

                obj = {
                  ...obj,
                  participants,
                  non_participants,
                };

                await save(
                  obj,
                  'sign_attempts',
                  api,
                );
              }
            }
            else if (
              data.includes('" sigID=') &&
              data.includes('articipants')
            ) {
              const attributes =
                [
                  {
                    id: 'sig_id',
                    primary_key: true,
                    pattern_start: 'sigID=',
                    pattern_end: ' timeout=',
                  },
                  {
                    id: 'non_participant_shares',
                    pattern_start: 'nonParticipantShareCounts=',
                    pattern_end: ' nonParticipants=',
                    type: 'array_number',
                  },
                  {
                    id: 'non_participants',
                    pattern_start: 'nonParticipants=',
                    pattern_end: ' participantShareCounts=',
                    type: 'array',
                  },
                  {
                    id: 'participant_shares',
                    pattern_start: 'participantShareCounts=',
                    pattern_end: ' participants=',
                    type: 'array_number',
                  },
                  {
                    id: 'participants',
                    pattern_start: 'participants=',
                    pattern_end: ' payload=',
                    type: 'array',
                  },
                ];

              log(
                'debug',
                service_name,
                'next sign',
              );

              let obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                const _height = height;
                const {
                  sig_id,
                } = { ...obj };
                let {
                  participants,
                  non_participants,
                } = { ...obj };

                participants = (participants || [])
                  .filter(a =>
                    a?.startsWith('axelarvaloper')
                  );

                non_participants = (non_participants || [])
                  .filter(a => a)
                  .map(a => {
                    const pattern_start = 'operator_address: ',
                      pattern_end = 'consensus_pubkey:';

                    const from =
                      pattern_start ?
                        a.indexOf(pattern_start) +
                        pattern_start.length :
                        0;

                    const to =
                      typeof pattern_end === 'string' &&
                      a.indexOf(pattern_end) > -1 ?
                        a.indexOf(pattern_end) :
                        a.length;

                    return (
                      a
                        .substring(
                          from,
                          to,
                        )
                        .trim()
                    );
                  })
                  .filter(a =>
                    a.startsWith('axelarvaloper')
                  );

                if (sig_id) {
                  const response =
                    await api
                      .get(
                        '',
                        {
                          params: {
                            module: 'lcd',
                            path: '/cosmos/tx/v1beta1/txs',
                            events: `sign.sigID='${sig_id}'`,
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
                    tx_responses,
                  } = { ...response?.data };

                  if (_.head(tx_responses)?.height) {
                    obj.height = Number(_.head(tx_responses).height);
                  }
                }

                if (
                  !obj.height &&
                  _height
                ) {
                  obj.height = _height;
                }

                obj = {
                  ...obj,
                  participants,
                  non_participants,
                };

                await save(
                  obj,
                  'sign_attempts',
                  api,
                  true,
                  1,
                );
              }
            }
            else if (
              data.includes(' excluding validator ') &&
              data.includes(' from snapshot ')
            ) {
              const attributes =
                [
                  {
                    id: 'validator',
                    pattern_start: ' excluding validator ',
                    pattern_end: ' from snapshot ',
                  },
                  {
                    id: 'snapshot',
                    pattern_start: ' from snapshot ',
                    pattern_end: ' due to [',
                    type: 'number',
                  },
                ];

              log(
                'debug',
                service_name,
                'keygen excluding validator',
              );

              const obj =
                construct(
                  data,
                  attributes,
                );

              if (typeof obj?.snapshot === 'number') {
                snapshot = obj.snapshot;
              }

              exclude_validators[snapshot] =
                _.concat(
                  exclude_validators[snapshot] ||
                  [],
                  obj,
                );
            }
            else if (data.includes('new Keygen: key_id')) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'key_id',
                    pattern_start: 'key_id [',
                    pattern_end: '] threshold [',
                  },
                ];

              log(
                'debug',
                service_name,
                'new keygen',
              );

              const obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                obj.height = height + 1;

                if (!snapshot) {
                  const response =
                    await api
                      .post(
                        '',
                        {
                          module: 'index',
                          collection: 'keygens',
                          method: 'search',
                          query: {
                            range: { height: { lt: obj.height } },
                          },
                          size: 1,
                          sort: [{ height: 'desc' }],
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
                    data,
                  } = { ...response?.data };

                  if (typeof _.head(data)?.snapshot === 'number') {
                    snapshot = _.head(data).snapshot + 1;
                  }
                }
                else {
                  obj.snapshot_non_participant_validators = {
                    validators:
                      _.uniqBy(
                        exclude_validators[snapshot] ||
                        [],
                        'validator',
                      ),
                  };
                }

                obj.snapshot = snapshot;

                snapshot++;
                exclude_validators = {};

                await save(
                  obj,
                  'keygens',
                  api,
                );
              }
            }
            else if (
              data.includes('multisig keygen ') &&
              data.includes(' timed out')
            ) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'key_id',
                    pattern_start: 'multisig keygen ',
                    pattern_end: ' timed out',
                  },
                ];

              log(
                'debug',
                service_name,
                'keygen failed',
              );

              let obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                const {
                  key_id,
                } = { ...obj };

                const response =
                  await api
                    .post(
                      '',
                      {
                        module: 'index',
                        collection: 'keygens',
                        method: 'search',
                        query: {
                          match_phrase: { key_id },
                        },
                        size: 1,
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
                  _id,
                } = { ..._.head(response?.data?.data) };

                obj = {
                  ...obj,
                  id: _id,
                  failed: true,
                };

                await save(
                  obj,
                  'keygens',
                  api,
                  true,
                );
              }
            }
            else if (
              keygen_patterns.findIndex(s =>
                data.includes(s)
              ) > -1
            ) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'bonded_weight',
                    pattern_start: 'bonded_weight=',
                    pattern_end: ' expires_at=',
                    type: 'number',
                  },
                  {
                    id: 'key_id',
                    pattern_start: 'key_id=',
                    pattern_end: ' keygen_threshold=',
                  },
                  {
                    id: 'keygen_threshold',
                    pattern_start: 'keygen_threshold=',
                    pattern_end: ' module=',
                  },
                  {
                    id: 'participant_count',
                    pattern_start: 'participant_count=',
                    pattern_end: ' participants=',
                    type: 'number',
                  },
                  {
                    id: 'participant_addresses',
                    pattern_start: 'participants=',
                    pattern_end: ' participants_weight=',
                    type: 'array',
                  },
                  {
                    id: 'participants_weight',
                    pattern_start: 'participants_weight=',
                    pattern_end: ' signing_threshold=',
                    type: 'number',
                  },
                  {
                    id: 'signing_threshold',
                    pattern_start: 'signing_threshold=',
                    pattern_end: null,
                  },
                ];

              log(
                'debug',
                service_name,
                keygen_patterns
                  .find(s =>
                    data.includes(s)
                  ),
              );

              let obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                obj.height = height + 1;

                const {
                  participant_addresses,
                } = { ...obj };
                let {
                  non_participants,
                } = { ...obj };

                if (participant_addresses) {
                  const response =
                    await api
                      .get(
                        '',
                        {
                          params: {
                            module: 'lcd',
                            path: `/cosmos/base/tendermint/v1beta1/validatorsets/${obj.height}`,
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
                    validators,
                  } = { ...response?.data };

                  non_participants = (validators || [])
                    .filter(v =>
                      !participant_addresses.includes(v?.address)
                    );
                }

                obj = {
                  ...obj,
                  non_participants,
                };

                await save(
                  obj,
                  'keygens',
                  api,
                );
              }
            }
            // cross-chain transfers
            else if (data.includes('deposit confirmed on chain ')) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'chain',
                    pattern_start: 'on chain ',
                    pattern_end: ' for ',
                  },
                  {
                    id: 'tx_id',
                    pattern_start: ' for ',
                    pattern_end: ' to ',
                  },
                  {
                    id: 'deposit_address',
                    pattern_start: ' to ',
                    pattern_end: ' with transfer ID ',
                  },
                  {
                    id: 'transfer_id',
                    pattern_start: ' with transfer ID ',
                    pattern_end: ' and command ID ',
                    type: 'number',
                  },
                  {
                    id: 'command_id',
                    pattern_start: ' and command ID ',
                    pattern_end: ' module=',
                  },
                ];

              log(
                'debug',
                service_name,
                'confirm deposit - evm',
              );

              const obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                const {
                  tx_id,
                  deposit_address,
                  transfer_id,
                } = { ...obj };
                let {
                  chain,
                  command_id,
                } = { ...obj };

                chain =
                  (chain || '')
                    .toLowerCase();

                command_id =
                  command_id ||
                  transfer_id
                    .toString(16)
                    .padStart(
                      64,
                      '0',
                    );

                if (
                  tx_id &&
                  deposit_address &&
                  transfer_id
                ) {
                  let response =
                    await api
                      .post(
                        '',
                        {
                          module: 'index',
                          collection: 'cross_chain_transfers',
                          method: 'search',
                          query: {
                            bool: {
                              must: [
                                { match: { 'send.txhash': tx_id } },
                                { match: { 'send.recipient_address': confirm.deposit_address } },
                              ],
                            },
                          },
                          size: 1,
                        },
                      )
                      .catch(error => {
                        return {
                          data: {
                            error,
                          },
                        };
                      });

                  const transfer_data =
                    _.head(
                      response?.data?.data
                    );

                  if (transfer_data) {
                    const {
                      send,
                      confirm,
                      vote,
                    } = { ...transfer_data };
                    let {
                      command,
                    } = { ...transfer_data };
                    const {
                      txhash,
                      source_chain,
                    } = { ...send };

                    if (
                      txhash &&
                      source_chain
                    ) {
                      if (confirm) {
                        confirm.transfer_id = transfer_id;
                      }

                      if (vote) {
                        vote.transfer_id = transfer_id;
                      }

                      response =
                        await api
                          .post(
                            '',
                            {
                              module: 'index',
                              collection: 'batches',
                              method: 'search',
                              query: {
                                bool: {
                                  must: [
                                    { match: { chain } },
                                    { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                                    { match: { command_ids: command_id } },
                                  ],
                                },
                              },
                              size: 1,
                            },
                          )
                          .catch(error => {
                            return {
                              data: {
                                error,
                              },
                            };
                          });

                      const batch_data =
                        _.head(
                          response?.data?.data
                        );

                      const {
                        batch_id,
                      } = { ...batch_data };

                      if (batch_id) {
                        command = {
                          chain,
                          batch_id,
                          transfer_id,
                          command_id,
                        };
                      }

                      log(
                        'debug',
                        service_name,
                        'save transfer',
                        {
                          chain,
                          tx_hash: tx_id,
                          transfer_id,
                          command_id,
                        },
                      );

                      const _id = `${txhash}_${source_chain}`.toLowerCase();

                      await api
                        .post(
                          '',
                          {
                            module: 'index',
                            collection: 'cross_chain_transfers',
                            method: 'update',
                            path: `/cross_chain_transfers/_update/${_id}`,
                            id: _id,
                            ...transfer_data,
                            confirm,
                            vote,
                            command,
                          },
                        )
                        .catch(error => {
                          return {
                            data: {
                              error,
                            },
                          };
                        });
                    }
                  }
                }
              }
            }
            else if (data.includes('signing command ')) {
              const attributes =
                [
                  {
                    id: 'timestamp',
                    pattern_start: '',
                    pattern_end: ' ',
                    type: 'date',
                  },
                  {
                    id: 'batch_id',
                    pattern_start: 'in batch ',
                    pattern_end: ' for chain',
                  },
                  {
                    id: 'chain',
                    pattern_start: 'for chain ',
                    pattern_end: ' using key',
                  },
                ];

              log(
                'debug',
                service_name,
                'sign batch',
              );

              let obj =
                construct(
                  data,
                  attributes,
                );

              if (obj) {
                const {
                  batch_id,
                } = { ...obj };
                let {
                  chain,
                } = { ...obj };

                if (
                  batch_id &&
                  chain
                ) {
                  chain = chain.toLowerCase();

                  if (
                    last_batch &&
                    !(
                      last_batch.batch_id === batch_id &&
                      last_batch.chain === chain
                    )
                  ) {
                    log(
                      'debug',
                      service_name,
                      'get batch',
                      {
                        batch_id,
                      },
                    );

                    api
                      .get(
                        '',
                        {
                          params: {
                            module: 'lcd',
                            path: `/axelar/evm/v1beta1/batched_commands/${last_batch.chain}/${last_batch.batch_id}`,
                            created_at: last_batch.timestamp,
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
                  }

                  obj = {
                    ...obj,
                    chain,
                  };

                  last_batch = obj;
                }
              }
            }
          },
        );
    } catch (error) {
      log(
        'error',
        service_name,
        'on error',
        {
          ...error,
        },
      );
    }
  }
};