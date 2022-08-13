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

// initial service name
const service_name = 'log-scraper';

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

const merge_data = (
  _data,
  attributes,
  initial_data = {},
) => {
  const data = initial_data;
  if (_data && attributes) {
    attributes.forEach(a => {
      try {
        const {
          id,
          primary_key,
          pattern_start,
          pattern_end,
          type,
          hard_value,
        } = { ...a };
        const from = pattern_start ?
          _data.indexOf(pattern_start) + pattern_start.length :
          0;
        const to = typeof pattern_end === 'string' && _data.indexOf(pattern_end) > -1 ?
          _data.indexOf(pattern_end) :
          _data.length;

        if ('hard_value' in a) {
          data[id] = hard_value;
        }
        else {
          data[id] = _data.substring(from, to)?.trim();
          data[id] = type === 'date' ?
            Number(moment(data[id]).format('X')) :
            type === 'number' ?
              Number(data[id]) :
              type?.startsWith('array') ?
                data[id].replace('[', '')
                  .replace(']', '')
                  .split('"')
                  .join('')
                  .split('\\n')
                  .join('')
                  .split('\\')
                  .join('')
                  .split(',')
                  .map(e => e?.trim())
                  .filter(e => e)
                  .map(e => type?.includes('number') ?
                    Number(e) :
                    e
                  ).filter(e => e) :
                type === 'json' ?
                  JSON.parse(data[id]) :
                  data[id];
        }
        if (primary_key) {
          data.id = data[id];
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
  if (data && collection && api && (data.id || collection.endsWith('keygens'))) {
    if (typeof data.snapshot === 'number') {
      // request api
      let response = await api.get('', {
        params: {
          module: 'cli',
          cmd: `axelard q snapshot info ${data.snapshot} -oj`,
          cache: true,
          cache_timeout: 5,
        },
      }).catch(error => { return { data: { error } }; });
      // handle error
      if (response?.data && !response.data.stdout && response.data.stderr && moment().diff(moment(data.timestamp * 1000), 'day') <= 1) {
        response = await api.get('', {
          params: {
            module: 'cli',
            cmd: 'axelard q snapshot info latest -oj',
            cache: true,
            cache_timeout: 5,
          },
        }).catch(error => { return { data: { error } }; });
      }
      if (response?.data?.stdout) {
        try {
          const snapshot_data = JSON.parse(response.data.stdout);
          if (!data.height) {
            data.height = Number(snapshot_data.height);
          }
          data.id = `${data.key_id}_${data.height}`;
          data.snapshot = snapshot_data.counter;
          data.snapshot_validators = snapshot_data;
        } catch (error) {}
      }
    }
    if (data.key_id) {
      // request api
      const response = await api.get('', {
        params: {
          module: 'cli',
          cmd: `axelard q multisig key ${data.key_id} -oj`,
          cache: true,
          cache_timeout: 15,
        },
      }).catch(error => { return { data: { error } }; });
      if (response?.data?.stdout) {
        try {
          const key_data = JSON.parse(response.data.stdout);
          if (key_data) {
            if (key_data.role) {
              if (!key_data.role.includes('KEY_ROLE_UNSPECIFIED')) {
                data.key_role = key_data.role;
              }
            }
            if (key_data.multisig_key) {
              if (key_data.multisig_key.threshold && !['sign_attempts'].includes(collection)) {
                data.threshold = Number(key_data.multisig_key.threshold) - 1;
              }
            }
            else {
              if (!isNaN(key_data.threshold_weight)) {
                data.threshold_weight = Number(key_data.threshold_weight);
                data.threshold = data.threshold_weight;
              }
              data = {
                ...data,
                ...key_data,
                height: key_data.started_at ? Number(key_data.started_at) : data.height,
                started_at: !isNaN(key_data.started_at) ? Number(key_data.started_at) : undefined,
                bonded_weight: data.bonded_weight || (!isNaN(key_data.bonded_weight) ? Number(key_data.bonded_weight) : undefined),
                participants: key_data?.participants.map(p => {
                  return {
                    ...p,
                    weight: !isNaN(p?.weight) ? Number(p.weight) : undefined,
                  };
                }) || [],
              };
            }
          }
        } catch (error) {}
      }
    }
    if (data.id) {
      if (is_update) {
        await sleep(delay_sec * 1000);
      }
      log('debug', service_name, 'index', { collection, id: data.id });
      // request api
      await api.post('', {
        module: 'index',
        collection,
        method: 'update',
        path: is_update ? `/${collection}/_update/${data.id}` : undefined,
        id: data.id,
        ...data,
      }).catch(error => { return { data: { error } }; });
    }
  }
};

module.exports = async () => {
  if (config?.[environment]?.endpoints?.api) {
    // initial api
    const api = axios.create({ baseURL: config[environment].endpoints.api });

    // setup log stream
    const tail = new TailFile(`/home/axelard/.axelar${['testnet', 'devnet', 'testnet-2'].includes(environment) ? `_${environment}` : ''}/logs/axelard.log`, { encoding: 'utf8', startPos: 0 })
      .on('tail_error', error => log('error', service_name, 'tail error', { ...error }));

    // initial temp variables
    let height,
      snapshot = 0,
      exclude_validators = {},
      last_batch;

    const keygen_patterns = ['keygen session started', 'setting key'];

    try {
      await tail.start();
      const splitter = readline.createInterface({ input: tail });
      // subscribe log data
      splitter.on('line', async chunk => {
        // initial data
        const data = chunk.toString('utf8').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
        // block
        if (data.includes('executed block height=')) {
          const attributes = [
            {
              id: 'height',
              pattern_start: 'executed block height=',
              pattern_end: ' module=',
              type: 'number',
            },
          ];
          height = merge_data(data, attributes).height;
          log('debug', service_name, 'block', { height });
        }
        // participations
        else if (data.includes('next sign: sig_id')) {
          const attributes = [
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
          log('debug', service_name, 'next sign');
          const sign = merge_data(data, attributes);
          if (sign) {
            sign._height = height;
            if (sign.participants) {
              sign.participants = sign.participants.filter(a => a?.startsWith('axelarvaloper'));
            }
            if (sign.non_participants) {
              sign.non_participants = sign.non_participants.filter(a => a).map(a => {
                const pattern_start = 'operator_address: ';
                const pattern_end = 'consensus_pubkey:';
                const from = pattern_start ? a.indexOf(pattern_start) + pattern_start.length : 0;
                const to = typeof pattern_end === 'string' && a.indexOf(pattern_end) > -1 ? a.indexOf(pattern_end) : a.length;
                a = a.substring(from, to).trim();
                return a;
              }).filter(a => a?.startsWith('axelarvaloper'));
            }
            if (sign.sig_id) {
              // request api
              const response = await api.get('', {
                params: {
                  module: 'lcd',
                  path: '/cosmos/tx/v1beta1/txs',
                  events: `sign.sigID='${sign.sig_id}'`,
                },
              }).catch(error => { return { data: { error } }; });
              if (response?.data?.tx_responses?.[0]?.height) {
                sign.height = Number(response.data.tx_responses[0].height);
              }
            }
            if (!sign.height && sign._height) {
              sign.height = sign._height;
            }
            delete sign._height;
          }
          await save(sign, 'sign_attempts', api);
        }
        else if (data.includes('" sigID=') && data.includes('articipants')) {
          const attributes = [
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
          log('debug', service_name, 'next sign');
          const sign = merge_data(data, attributes);
          if (sign) {
            sign._height = height;
            if (sign.participants) {
              sign.participants = sign.participants.filter(a => a?.startsWith('axelarvaloper'));
            }
            if (sign.non_participants) {
              sign.non_participants = sign.non_participants.filter(a => a).map(a => {
                const pattern_start = 'operator_address: ';
                const pattern_end = 'consensus_pubkey:';
                const from = pattern_start ? a.indexOf(pattern_start) + pattern_start.length : 0;
                const to = typeof pattern_end === 'string' && a.indexOf(pattern_end) > -1 ? a.indexOf(pattern_end) : a.length;
                a = a.substring(from, to).trim();
                return a;
              }).filter(a => a?.startsWith('axelarvaloper'));
            }
            if (sign.sig_id) {
              // request api
              const response = await api.get('', {
                params: {
                  module: 'lcd',
                  path: '/cosmos/tx/v1beta1/txs',
                  events: `sign.sigID='${sign.sig_id}'`,
                },
              }).catch(error => { return { data: { error } }; });
              if (response?.data?.tx_responses?.[0]?.height) {
                sign.height = Number(response.data.tx_responses[0].height);
              }
            }
            if (!sign.height && sign._height) {
              sign.height = sign._height;
            }
            delete sign._height;
          }
          await save(sign, 'sign_attempts', api, true, 1);
        }
        else if (data.includes(' excluding validator ') && data.includes(' from snapshot ')) {
          const attributes = [
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
          log('debug', service_name, 'keygen excluding validator');
          const exclude_validator_data = merge_data(data, attributes);
          if (typeof exclude_validator_data?.snapshot === 'number') {
            snapshot = exclude_validator_data.snapshot;
          }
          exclude_validators[snapshot] = _.concat(exclude_validators[snapshot] || [], exclude_validator_data);
        }
        else if (data.includes('new Keygen: key_id')) {
          const attributes = [
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
          log('debug', service_name, 'new keygen');
          const keygen = merge_data(data, attributes);
          keygen.height = height + 1;
          if (!snapshot) {
            // request api
            const response = await api.post('', {
              module: 'index',
              collection: 'keygens',
              method: 'search',
              query: { range: { height: { lt: keygen.height } } },
              sort: [{ height: 'desc' }],
              size: 1,
            }).catch(error => { return { data: { error } }; });
            if (response?.data?.data?.[0]) {
              snapshot = response.data.data[0].snapshot + 1;
              keygen.snapshot = snapshot;
            }
          }
          else {
            keygen.snapshot = snapshot;
            keygen.snapshot_non_participant_validators = {
              validators: _.uniqBy(exclude_validators[keygen.snapshot] || [], 'validator'),
            };
          }
          snapshot++;
          exclude_validators = {};
          await save(keygen, 'keygens', api);
        }
        else if (data.includes('multisig keygen ') && data.includes(' timed out')) {
          const attributes = [
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
          log('debug', service_name, 'keygen failed');
          const keygen = merge_data(data, attributes);
          // request api
          const response = await api.post('', {
            module: 'index',
            collection: 'keygens',
            method: 'search',
            query: { match_phrase: { 'key_id': keygen.key_id } },
            size: 1,
          }).catch(error => { return { data: { error } }; });
          if (response?.data?.data?.[0]) {
            keygen.id = response.data.data[0]._id;
          }
          keygen.failed = true;
          await save(keygen, 'keygens', api, true);
        }
        else if (keygen_patterns.findIndex(s => data.includes(s)) > -1) {
          const attributes = [
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
          log('debug', service_name, keygen_patterns.find(s => data.includes(s)));
          const keygen = merge_data(data, attributes);
          keygen.height = height + 1;
          if (keygen.participant_addresses) {
            // request api
            const response = await api.get('', {
              params: {
                module: 'lcd',
                path: `/cosmos/base/tendermint/v1beta1/validatorsets/${keygen.height}`,
              },
            }).catch(error => { return { data: { error } }; });
            if (response?.data?.validators) {
              const {
                validators,
              } = { ...response.data };
              keygen.non_participants = validators.filter(v => !keygen.participant_addresses.includes(v?.address));
            }
          }
          await save(keygen, 'keygens', api);
        }
        // transfers
        else if (data.includes('deposit confirmed on chain ')) {
          const attributes = [
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
          log('debug', service_name, 'confirm deposit - evm');
          const confirm = merge_data(data, attributes);
          if (confirm) {
            confirm.chain = confirm.chain?.toLowerCase();
            if (confirm.tx_id && confirm.deposit_address && confirm.transfer_id) {
              // get exist transfer
              const id = confirm.tx_id;
              let query = {
                bool: {
                  must: [
                    { match: { 'source.id': id } },
                    { match: { 'source.recipient_address': confirm.deposit_address } },
                  ],
                },
              };
              // request api
              let response = await api.post('', {
                module: 'index',
                collection: 'transfers',
                method: 'search',
                query,
                size: 1,
              }).catch(error => { return { data: { error } }; });
              if (response?.data?.data?.[0]) {
                const transfer = response.data.data[0];
                if (transfer.confirm_deposit) {
                  transfer.confirm_deposit.transfer_id = confirm.transfer_id;
                }
                if (transfer.vote) {
                  transfer.vote.transfer_id = confirm.transfer_id;
                }
                // sign batch
                let sign_batch;
                const command_id = confirm.command_id || confirm.transfer_id.toString(16).padStart(64, '0');
                query = {
                  bool: {
                    must: [
                      { match: { chain: confirm.chain } },
                      { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                      { match: { command_ids: command_id } },
                    ],
                  },
                };
                // request api
                response = await api.post('', {
                  module: 'index',
                  collection: 'batches',
                  method: 'search',
                  query,
                  size: 1,
                }).catch(error => { return { data: { error } }; });
                if (response?.data?.data?.[0]) {
                  const batch = response.data.data[0];
                  if (batch) {
                    sign_batch = {
                      chain: confirm.chain,
                      batch_id: batch.batch_id,
                      command_id,
                      transfer_id: confirm.transfer_id,
                    };
                  }
                }
                log('debug', service_name, 'save transfer', { chain: confirm.chain, tx_hash: id, transfer_id: confirm.transfer_id });
                // request api
                await api.post('', {
                  module: 'index',
                  collection: 'transfers',
                  method: 'update',
                  path: `/transfers/_update/${id}`,
                  id,
                  ...transfer,
                  sign_batch,
                }).catch(error => { return { data: { error } }; });
              }
            }
          }
        }
        else if (data.includes('signing command ')) {
          const attributes = [
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
          log('debug', service_name, 'sign batch');
          const batch = merge_data(data, attributes);
          if (batch?.batch_id && batch.chain) {
            batch.chain = batch.chain.toLowerCase();
            if (last_batch && !(last_batch.batch_id === batch.batch_id && last_batch.chain === batch.chain)) {
              log('debug', service_name, 'get batch', { batch_id: batch.batch_id });
              // request api
              api.get('', {
                params: {
                  module: 'cli',
                  cmd: `axelard q evm batched-commands ${last_batch.chain} ${last_batch.batch_id} -oj`,
                  created_at: last_batch.timestamp,
                  cache: true,
                  cache_timeout: 1,
                },
              }).catch(error => { return { data: { error } }; });
            }
            last_batch = batch;
          }
        }
      });
    } catch (error) {
      log('error', service_name, 'on error', { ...error });
    }
  }
};