exports.handler = async (event, context, callback) => {
  // import module for http request
  const axios = require('axios');
  // import module for date time
  const moment = require('moment');
  // import lodash
  const _ = require('lodash');
  // import config
  const config = require('config-yml');
  // import modules for crypto
  const atob = require('atob');
  const { bech32 } = require('bech32');
  const { tmhash } = require('tendermint/lib/hash');
  // import utils
  const { to_json } = require('./utils');
  // import libs
  const { tx_manager } = require('./lib/object/tx')();
  const { denomer } = require('./lib/object/denom')();
  const { chain_manager } = require('./lib/object/chain')();
  const { lastHeartbeatBlock, firstHeartbeatBlock } = require('./lib/object/hb')();

  // constants
  const prefix_consensus = 'axelarvalcons';
  const prefix_account = 'axelar';
  const chunk_uptimes_size = 1000;

  // initial environment
  const environment = process.env.ENVIRONMENT || config?.environment;
  // initial requester
  const requester = axios.create({ baseURL: config?.[environment]?.endpoints?.api });
  const avg_block_time_ms = config?.[environment]?.avg_block_time_ms || 6000;
  const snapshot_block_size = config?.[environment]?.snapshot_block_size || 10000;
  const num_blocks_per_heartbeat = config?.[environment]?.num_blocks_per_heartbeat || 50;
  const max_miss = config?.[environment]?.max_miss || 17500;

  const base64ToHex = s => {
    s = typeof s === 'string' ? s : '';
    const raw = atob(s);
    let result = '';
    for (let i = 0; i < raw.length; i++) {
      const hex = raw.charCodeAt(i).toString(16);
      result = `${result}${hex.length === 2 ? '' : '0'}${hex}`;
    }
    return result.toUpperCase();
  };

  const hexToBech32 = (address, prefix) => bech32.encode(prefix, bech32.toWords(Buffer.from(address, 'hex')));

  const base64ToBech32 = (address, prefix) => hexToBech32(base64ToHex(address), prefix);

  const bech32ToBech32 = (address, prefix) => bech32.encode(prefix, bech32.decode(address).words);

  const pubKeyToBech32 = (pubKey, prefix) => hexToBech32(tmhash(Buffer.from(pubKey, 'base64')).slice(0, 20).toString('hex').toUpperCase(), prefix);

  const delegatorAddress = address => bech32ToBech32(address, prefix_account);

  const stakingDelegationsAddress = async (operator_address, delegator_address, params) => {
    const path = `/cosmos/staking/v1beta1/validators/${operator_address}/delegations/${delegator_address}`;
    const response = await requester.get('', { params: { module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    return response?.data;
  };

  const validatorSelfDelegation = async validator_data => {
    if (validator_data) {
      if (validator_data.delegator_address && typeof validator_data.self_delegation !== 'number') {
        const response = await stakingDelegationsAddress(validator_data.operator_address, validator_data.delegator_address);
        validator_data.self_delegation = Number(response?.delegation_response?.delegation?.shares || 0);
      }
    }
    return validator_data;
  };

  const validators = async params => {
    const path = '/cosmos/staking/v1beta1/validators';

    let response = await requester.get('', { params: { ...params, module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    if (response?.data?.validators) {
      const _validators = response.data.validators;
      for (let i = 0; i < _validators.length; i++) {
        let _validator = _validators[i];
        if (_validator) {
          _validator.delegator_address = delegatorAddress(_validator.operator_address);
          if (_validator.consensus_pubkey?.key) {
            _validator.consensus_address = pubKeyToBech32(_validator.consensus_pubkey.key, prefix_consensus);
          }
          if (_validator.delegator_address && typeof _validator.self_delegation !== 'number') {
            _validator = await validatorSelfDelegation(_validator);
          }
          _validator.tokens = Number(_validator.tokens);
          _validator.delegator_shares = Number(_validator.delegator_shares);
        }
        _validators[i] = _validator;
      }
      response = { data: _validators, pagination: response.data.pagination };
    }

    return response;
  };

  const uptimes = async params => {
    const path = '/uptimes/_search';
    params = {
      size: 0,
      ...params,
      module: 'index',
      index: 'uptimes',
      method: 'search',
    };

    let response = await requester.post('', { ...params, path })
      .catch(error => { return { data: { error } }; });
    if (response?.data?.aggs?.uptimes?.buckets) {
      response = {
        data: Object.fromEntries(response.data.aggs.uptimes.buckets.map(record => [base64ToBech32(record.key, prefix_consensus), record.doc_count])),
        total: response.data.total,
      };
    }
    return response;
  };

  const evmVotes = async params => {
    const path = '/evm_votes/_search';
    params = {
      size: 0,
      ...params,
      module: 'index',
      index: 'evm_votes',
      method: 'search',
    };

    let response = await requester.post('', { ...params, path })
      .catch(error => { return { data: { error } }; });
    if (response?.data?.aggs?.votes?.buckets) {
      response = {
        data: Object.fromEntries(response.data.aggs.votes.buckets.map(record => [
          record.key,
          {
            chains: Object.fromEntries((record.chains?.buckets || []).map(c => [
              c.key,
              {
                confirms: Object.fromEntries((c.confirms?.buckets || []).map(cf => [cf.key_as_string, cf.doc_count])),
                total: c.doc_count,
              },
            ])),
            total: record.doc_count,
          },
        ])),
        total: response.data.total,
      };
    }
    return response;
  };

  const axelard = async params => {
    const response = await requester.get('', { params: { ...params, module: 'cli' } })
      .catch(error => { return { data: { results: null, error } }; });
    return response?.data;
  };

  const transactions = async (params, denoms) => {
    const path = '/cosmos/tx/v1beta1/txs';
    let response = await requester.get('', { params: { ...params, module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    if (response?.data?.tx_responses) {
      response.data.tx_responses = response.data.tx_responses.map(record => {
        const activities = tx_manager.activities(record, denoms);
        return {
          ...record,
          height: Number(record.height),
          status: tx_manager.status(record),
          type: tx_manager.type(record),
          fee: tx_manager.fee(record, denoms),
          symbol: tx_manager.symbol(record, denoms),
          gas_used: tx_manager.gas_used(record),
          gas_limit: tx_manager.gas_limit(record),
          memo: tx_manager.memo(record),
          activities,
        };
      });
      response = { data: response.data.tx_responses, pagination: response.data.pagination, total: response.data.pagination && Number(response.data.pagination.total) };
    }
    return response;
  };

  const transactionsByEvents = async (events, isUnlimit, denoms) => {
    const page_size = 100, max_size = 1000;
    let pageKey = true, total = 1000, loop_count = 0, txs = [];

    while ((pageKey || total) && txs.length < total && (isUnlimit || txs.length < max_size) && (loop_count < Math.ceil((isUnlimit ? total : max_size) / page_size))) {
      const _pageKey = (isUnlimit || total <= max_size) && pageKey && typeof pageKey === 'string' ? pageKey : undefined;
      const _offset = total + (total % page_size === 0 ? 0 : page_size - (total % page_size)) - txs.length;

      const response = await transactions({
        events,
        'pagination.key': _pageKey,
        'pagination.limit': page_size,
        'pagination.offset': _pageKey ? undefined :
          txs.length > 0 && _offset >= page_size ? _offset > total ? total : _offset :
            txs.length,
      }, denoms);

      txs = _.uniqBy(_.concat(txs, response?.data || []), 'txhash');
      pageKey = response?.pagination?.next_key;
      total = response?.pagination && Number(response.pagination.total);
      loop_count++;
    }
    return _.orderBy(_.uniqBy(txs, 'txhash'), ['timestamp', 'height'], ['desc', 'desc']);
  };

  const slashSigningInfos = async params => {
    const path = '/cosmos/slashing/v1beta1/signing_infos';
    const response = await requester.get('', { params: { ...params, module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    return response?.data;
  };

  const bankBalances = async (address, params) => {
    const path = `/cosmos/bank/v1beta1/balances/${address}`;
    const response = await requester.get('', { params: { ...params, module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    return { balances: response?.data?.balances, pagination: response?.data?.pagination };
  };

  const allBankBalances = async (address, params) => {
    let pageKey = true, data = [];
    while (pageKey) {
      const response = await bankBalances(address, { ...params, 'pagination.key': pageKey && typeof pageKey === 'string' ? pageKey : undefined });
      data = _.uniqBy(_.concat(data, response.balances || []), 'denom');
      pageKey = response?.pagination?.next_key;
    }
    return { data };
  };

  const heartbeats = async params => {
    const path = '/heartbeats/_search';
    params = {
      size: 0,
      ...params,
      module: 'index',
      index: 'heartbeats',
      method: 'search',
    };

    let response = await requester.post('', { ...params, path })
      .catch(error => { return { data: { error } }; });
    if (response?.data?.aggs?.heartbeats?.buckets) {
      response = {
        data: Object.fromEntries(response.data.aggs.heartbeats.buckets.map(record => [record.key, record.heightgroup?.buckets && record.heightgroup?.buckets.length <= 100000 ? record.heightgroup.buckets.length : record.doc_count])),
        total: response.data.total,
      };
    }
    return response;
  };

  const searchKeygens = async params => {
    const path = '/keygens/_search';
    params = {
      ...params,
      module: 'index',
      index: 'keygens',
      method: 'search',
    };

    const response = await requester.post('', { ...params, path })
      .catch(error => { return { data: { error } }; });
    return response;
  };

  const signAttempts = async params => {
    const path = '/sign_attempts/_search';
    params = {
      ...params,
      module: 'index',
      index: 'sign_attempts',
      method: 'search',
    };

    const response = await requester.post('', { ...params, path })
      .catch(error => { return { data: { error } }; });
    return response;
  };

  const slashingParams = async params => {
    const path = '/cosmos/slashing/v1beta1/params';
    const response = await requester.get('', { params: { ...params, module: 'lcd', path } })
      .catch(error => { return { data: { error } }; });
    return response?.data;
  };

  const uptimesForJailed = async (from_block, to_block) => {
    const size = chunk_uptimes_size;
    let data;
    const response = await uptimes({
      query: { range: { height: { gte: from_block, lte: to_block } } },
      sort: [{ height: 'desc' }],
      size,
      _source: false,
      fields: ['height', 'timestamp', 'validators'],
    });

    if (response?.data?.data) {
      data = _.orderBy(_.concat(data || [], response.data.data.map(uptime => {
        return {
          ...uptime?.fields,
          height: uptime?.fields?.height?.[0],
          timestamp: uptime?.fields?.timestamp?.[0],
          validators: uptime?.fields?.validators?.map(v => base64ToBech32(v, prefix_consensus)),
        };
      })), ['height'], ['desc']);
    }
    return data || [];
  };

  const jailedInfo = (data, from_block, to_block) => {
    if (data) {
      const min = _.minBy(data, 'height')?.height;
      const max = _.maxBy(data, 'height')?.height;
      if (min && max && max >= min) {
        const _data = [];
        for (let i = min; i <= max; i++) {
          const block = data.find(b => b?.height === i);
          _data.push(block || { height: i, up: false });
        }
        data = _.slice(_.orderBy(_data, ['height'], ['desc']), 0, (to_block - from_block + 1));
      }
    }
    data = _.orderBy(data || [], ['height'], ['asc']);
    return { data };
  };

  const allValidators = async (from_block, to_block, denoms, avg_block_time_ms = 6000) => {
    let response, pageKey = true, data = [];
    while (pageKey) {
      response = await validators({ 'pagination.key': pageKey && typeof pageKey === 'string' ? pageKey : undefined });
      data = _.orderBy(_.uniqBy(_.concat(data, response?.data || []), 'operator_address'), ['description.moniker'], ['asc']);
      pageKey = response?.pagination?.next_key;
    }
    data = data.filter(v => !['genesis'].includes(v?.description?.moniker));

    response = await uptimes({
      aggs: { uptimes: { terms: { field: 'validators.keyword', size: data.length } } },
      query: { range: { height: { gte: from_block, lte: to_block } } },
    });

    const total_blocks = to_block - from_block + 1 > snapshot_block_size ? to_block - from_block + 1 : snapshot_block_size;
    if (response?.data) {
      data = data.map(v => {
        return {
          ...v,
          uptime: typeof response.data[v?.consensus_address] === 'number' ? response.data[v.consensus_address] * 100 / (response.total || (to_block - from_block + 1)) : 0,
        };
      }).map(v => {
        return {
          ...v,
          uptime: typeof v.uptime === 'number' ? v.uptime > 100 ? 100 : v.uptime < 0 ? 0 : v.uptime : undefined,
        };
      }).map(v => {
        const up_blocks = typeof response.data[v?.consensus_address] === 'number' ? response.data[v.consensus_address] : 0;
        let missed_blocks = typeof v?.uptime === 'number' && from_block && to_block && (
          (total_blocks * (1 - v.uptime / 100))
          -
          (to_block - from_block + 1 > total_blocks ? 0 : total_blocks - (to_block - from_block + 1))
        );
        missed_blocks = missed_blocks < 0 ? 0 : missed_blocks;
        return {
          ...v,
          up_blocks,
          missed_blocks,
        };
      });
    }

    response = await axelard({ cmd: 'axelard q tss deactivated-operators -oj', cache: true, cache_timeout: 15 });
    if (to_json(response?.stdout)) {
      const deregistering_addresses = to_json(response.stdout).operator_addresses || [];
      data = _.orderBy(data.map(v => {
        return {
          ...v,
          deregistering: deregistering_addresses.includes(v.operator_address) || (['genesis'].includes(v.description.moniker) && !['BOND_STATUS_BONDED'].includes(v.status)),
        };
      }), ['deregistering', 'description.moniker'], ['asc', 'asc']);
    }

    response = await axelard({ cmd: 'axelard q snapshot validators -oj', cache: true, cache_timeout: 5 });
    if (to_json(response?.stdout)) {
      const illegible_addresses = to_json(response.stdout).validators?.filter(v => Object.values(v?.tss_illegibility_info || {}).findIndex(v => v) > -1);
      data = _.orderBy(data.map(v => {
        return {
          ...v,
          illegible: illegible_addresses.findIndex(_v => _v.operator_address === v.operator_address) > -1,
          tss_illegibility_info: illegible_addresses?.find(_v => _v.operator_address === v.operator_address)?.tss_illegibility_info,
        };
      }), ['deregistering', 'description.moniker'], ['asc', 'asc']);
    }

    response = await transactionsByEvents(`message.action='RegisterProxy'`, true, denoms);
    if (response) {
      data = data.map(v => {
        const tx = response.find(_tx => _tx && !_tx.code && _tx.activities?.findIndex(a => a?.sender === v?.operator_address) > -1);
        return {
          ...v,
          start_proxy_height: (tx?.height && Number(tx.height)) || v?.start_proxy_height,
          broadcaster_address: tx?.activities?.find(a => a?.sender === v?.operator_address)?.address,
        };
      });
    }
    if (data) {
      const should_have_broadcaster_data = data.filter(v => !v.broadcaster_address);
      for (let i = 0; i < should_have_broadcaster_data.length; i++) {
        const v = should_have_broadcaster_data[i];
        response = await axelard({ cmd: `axelard q snapshot proxy ${v.operator_address}`, cache: true, cache_timeout: 5 });
        if (to_json(response?.stdout)) {
          v.broadcaster_address = to_json(response.stdout).address;
        }
      }
    }

    pageKey = true;
    while (pageKey) {
      response = await slashSigningInfos({ 'pagination.key': pageKey && typeof pageKey === 'string' ? pageKey : undefined });
      const infos = response?.info;
      data = data.map(v => {
        if (infos?.findIndex(info => info?.address === v?.consensus_address) > -1) {
          const info = infos.find(info => info?.address === v?.consensus_address);
          return {
            ...v,
            start_height: Number(info.start_height),
            start_proxy_height: info.start_proxy_height || Number(info.start_height),
            jailed_until: info.jailed_until && moment(info.jailed_until).valueOf(),
            tombstoned: typeof info.tombstoned === 'boolean' ? info.tombstoned : undefined,
            missed_blocks_counter: Number(info.missed_blocks_counter),
          };
        }
        return v;
      });
      pageKey = response?.pagination?.next_key;
    }

    response = await requester.get('', { params: { module: 'data', collection: 'chains' } })
      .catch(error => { return { data: null }; });
    const chains = response?.data?.evm || [];
    const ids = chains.map(c => c?.id);
    const supported_chains = {};
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      response = await axelard({ cmd: `axelard q nexus chain-maintainers ${chain_manager.maintainer_id(id, chains)} -oj`, cache: true, cache_timeout: 5 });
      if (to_json(response?.stdout)?.maintainers) {
        supported_chains[id] = to_json(response.stdout).maintainers;
      }
    }
    data = data.map(v => {
      return {
        ...v,
        supported_chains: Object.entries(supported_chains).filter(([key, value]) => value?.includes(v?.operator_address)).map(([key, value]) => key),
      };
    });

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v) {
        v.broadcaster_registration = !v.tss_illegibility_info?.no_proxy_registered && v?.broadcaster_address ? true : false;
        v.num_block_before_registered = v.broadcaster_registration ? typeof v?.start_proxy_height === 'number' && typeof v?.start_height === 'number' ? v.start_proxy_height >= v.start_height ? v.start_proxy_height - v.start_height : 0 : null : null;
        if (v?.broadcaster_address) {
          response = await allBankBalances(v.broadcaster_address);
          if (response?.data) {
            v.broadcaster_funded = _.head(response.data.filter(b => b?.denom === 'uaxl').map(b => { return { amount: denomer.amount(b.amount, b.denom, denoms), denom: denomer.symbol(b.denom, denoms) } }));
          }
        }
        else {
          v.broadcaster_funded = null;
        }
        data[i] = v;
      }
    }

    response = await heartbeats({
      aggs: {
        heartbeats: {
          terms: { field: 'sender.keyword', size: data.length },
          aggs: {
            heightgroup: {
              terms: { field: 'height_group', size: Math.ceil(total_blocks / num_blocks_per_heartbeat) },
            },
          },
        },
      },
      query: {
        bool: {
          must: [
            { range: { height: { gte: firstHeartbeatBlock(from_block), lte: to_block } } },
          ],
        },
      },
    });
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const _last = lastHeartbeatBlock(to_block);
      const _first = firstHeartbeatBlock(from_block);

      const totalHeartbeats = Math.floor((_last - _first) / num_blocks_per_heartbeat) + 1;
      const up_heartbeats = response?.data?.[v?.broadcaster_address] || 0;
      let missed_heartbeats = totalHeartbeats - up_heartbeats;
      missed_heartbeats = missed_heartbeats < 0 ? 0 : missed_heartbeats;
      let heartbeats_uptime = totalHeartbeats > 0 ? up_heartbeats * 100 / totalHeartbeats : 0;
      heartbeats_uptime = heartbeats_uptime > 100 ? 100 : heartbeats_uptime;

      v.total_heartbeats = totalHeartbeats;
      v.up_heartbeats = up_heartbeats;
      v.missed_heartbeats = missed_heartbeats;
      v.heartbeats_uptime = heartbeats_uptime;
      data[i] = v;
    }

    response = await evmVotes({
      aggs: {
        votes: {
          terms: { field: 'sender.keyword', size: 10000 },
          aggs: {
            chains: {
              terms: { field: 'sender_chain.keyword', size: 1000 },
              aggs: {
                confirms: {
                  terms: { field: 'confirmed' },
                },
              },
            },
          },
        },
      },
      query: {
        bool: {
          must: [
            { range: { height: { gte: from_block, lte: to_block } } },
          ],
        },
      },
    });
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      v.total_votes = response?.data?.[v?.broadcaster_address]?.total || 0;
      v.total_yes_votes = _.sum(Object.entries(response?.data?.[v?.broadcaster_address]?.chains || {}).map(c => Object.entries(c[1]?.confirms || {}).find(cf => cf[0] === 'true')?.[1] || 0));
      v.total_no_votes = _.sum(Object.entries(response?.data?.[v?.broadcaster_address]?.chains || {}).map(c => Object.entries(c[1]?.confirms || {}).find(cf => cf[0] === 'false')?.[1] || 0));
      data[i] = v;
    }

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      response = await axelard({ cmd: `axelard q tss key-shares-by-validator ${v?.operator_address} -oj`, cache: true, cache_timeout: 5 });
      v.key_shares = to_json(response?.data?.stdout) || [];
      data[i] = v;
    }

    let keygens_data;
    response = await searchKeygens({
      query: {
        bool: {
          must: [
            { range: { height: { gte: from_block, lte: to_block } } },
          ],
          must_not: [
            { exists: { field: 'failed' } },
          ],
        },
      },
      sort: [{ height: 'desc' }],
      size: 1000,
    });
    let keygens = Array.isArray(response?.data) ? response.data : [];
    for (let i = 0; i < keygens.length; i++) {
      const keygen = keygens[i];
      keygens[i] = {
        ...keygen,
        key_chain: keygen.key_chain || (keygen?.key_id?.split('-').length > 1 && keygen.key_id.split('-')[0]),
        key_role: keygen.key_role || (keygen?.key_id?.split('-').length > 2 && `${keygen.key_id.split('-')[1].toUpperCase()}_KEY`),
        participants: keygen.snapshot_validators?.validators?.map(v => v?.validator?.toLowerCase()),
        non_participants: keygen.snapshot_non_participant_validators?.validators?.map(v => v?.validator?.toLowerCase()),
        success: true,
      };
    }
    keygens_data = _.orderBy(_.concat(keygens_data || [], keygens), ['height'], ['desc']);

    response = await searchKeygens({
      query: {
        bool: {
          must: [
            { range: { height: { gte: from_block, lte: to_block } } },
            { match: { failed: true } },
          ],
        },
      },
      sort: [{ height: 'desc' }],
      size: 1000,
    });
    keygens = Array.isArray(response?.data) ? response.data : [];
    for (let i = 0; i < keygens.length; i++) {
      const keygen = keygens[i];
      keygens[i] = {
        ...keygen,
        key_chain: keygen.key_chain || (keygen?.key_id?.split('-').length > 1 && keygen.key_id.split('-')[0]),
        key_role: keygen.key_role || (keygen?.key_id?.split('-').length > 2 && `${keygen.key_id.split('-')[1].toUpperCase()}_KEY`),
        participants: keygen.snapshot_validators?.validators?.map(v => v?.validator?.toLowerCase()),
        non_participants: keygen.snapshot_non_participant_validators?.validators?.map(v => v?.validator?.toLowerCase()),
        success: false,
      };
    }
    keygens_data = _.orderBy(_.concat(keygens_data || [], keygens), ['height'], ['desc']);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      v.keygen_participated = keygens_data?.filter(k => k?.participants?.includes(v.operator_address?.toLowerCase())).length || 0;
      v.keygen_not_participated = keygens_data?.filter(k => k?.non_participants?.includes(v.operator_address?.toLowerCase())).length || 0;
      const total = v.keygen_participated + v.keygen_not_participated;
      v.keygen_participated_rate = total > 0 ? v.keygen_participated / total : 0;
      v.keygen_not_participated_rate = total > 0 ? v.keygen_not_participated / total : 0;
      data[i] = v;
    }

    let signs_data;
    response = await signAttempts({
      query: {
        bool: {
          must: [
            { match: { result: true } },
            { range: { height: { gte: from_block, lte: to_block } } },
          ],
        },
      },
      sort: [{ height: 'desc' }],
      size: 1000,
    });
    let signs = Array.isArray(response?.data) ? response.data : [];
    for (let i = 0; i < signs.length; i++) {
      const sign = signs[i];
      signs[i] = {
        ...sign,
        key_chain: sign.key_chain || (sign?.key_id?.split('-').length > 1 && sign.key_id.split('-')[0]),
        key_role: sign.key_role || (sign?.key_id?.split('-').length > 2 && `${sign.key_id.split('-')[1].toUpperCase()}_KEY`),
        participants: sign.participants?.map(v => v?.toLowerCase()),
        non_participants: sign.non_participants?.map(v => v?.toLowerCase()),
        success: true,
      };
    }
    signs_data = _.orderBy(_.concat(signs_data || [], signs), ['height'], ['desc']);

    response = await signAttempts({
      query: {
        bool: {
          must: [
            { match: { result: false } },
            { range: { height: { gte: from_block, lte: to_block } } },
          ],
        },
      },
      sort: [{ height: 'desc' }],
      size: 1000,
    });
    signs = Array.isArray(response?.data) ? response.data : [];
    for (let i = 0; i < signs.length; i++) {
      const sign = signs[i];
      signs[i] = {
        ...sign,
        key_chain: sign.key_chain || (sign?.key_id?.split('-').length > 1 && sign.key_id.split('-')[0]),
        key_role: sign.key_role || (sign?.key_id?.split('-').length > 2 && `${sign.key_id.split('-')[1].toUpperCase()}_KEY`),
        participants: sign.participants?.map(v => v?.toLowerCase()),
        non_participants: sign.non_participants?.map(v => v?.toLowerCase()),
        success: false,
      };
    }
    signs_data = _.orderBy(_.concat(signs_data || [], signs), ['height'], ['desc']);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      v.sign_participated = signs_data?.filter(s => s?.participants?.includes(v.operator_address?.toLowerCase())).length || 0;
      v.sign_not_participated = signs_data?.filter(s => s?.non_participants?.includes(v.operator_address?.toLowerCase())).length || 0;
      const total = v.sign_participated + v.sign_not_participated;
      v.sign_participated_rate = total > 0 ? v.sign_participated / total : 0;
      v.sign_not_participated_rate = total > 0 ? v.sign_not_participated / total : 0;
      data[i] = v;
    }

    response = await slashingParams();
    const maxMissed = response?.params ? Number(response.params.signed_blocks_window) - (Number(response.params.min_signed_per_window) * Number(response.params.signed_blocks_window)) : max_miss;
    let uptimes_data, from = 0;
    while (from < total_blocks) {
      const _uptimes_data = await uptimesForJailed(from_block + from, from_block - 1 + from + chunk_uptimes_size);
      uptimes_data = _.uniqBy(_.concat(uptimes_data || [], _uptimes_data), 'height');
      from += chunk_uptimes_size;
      if (uptimes_data?.length < 1) {
        break;
      }
    }

    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v.jailed_until > 0) {
        if (!(v?.uptime)) {
          v.times_jailed = -1;
          v.avg_jail_response_time = -1;
          v.num_blocks_jailed = total_blocks;
        }
        else if (uptimes_data?.length * (1 - (v.uptime / 100)) > maxMissed) {
          const _uptimes_data = jailedInfo(uptimes_data || [], from_block, to_block)?.data;
          if (uptimes_data && _uptimes_data) {
            const jailed_data = [];
            let numMissed = 0, jailed = false, numJailed = 0, previous_time;
            for (let j = 0; j < _uptimes_data.length; j++) {
              const _block = _uptimes_data[j];
              const uptime = uptimes_data.find(u => u?.height === _block?.height);
              _block.time = uptime?.timestamp || (previous_time + avg_block_time_ms);
              previous_time = _block.time;
              _block.up = uptime?.validators.includes(v.consensus_address);

              if (_block.up) {
                if (jailed) {
                  if (jailed_data.length - 1 >= 0) {
                    jailed_data[jailed_data.length - 1].unjail_time = _block.time;
                  }
                }
                numMissed = 0;
                jailed = false;
              }
              else {
                numMissed++;
              }

              if (numMissed > maxMissed && !jailed) {
                jailed_data.push(_block);
                jailed = true;
              }
              if (jailed) {
                numJailed++;
              }
            }
            v.times_jailed = jailed_data.length;
            v.avg_jail_response_time = jailed_data.filter(b => b.unjail_time).length > 0 ? _.meanBy(jailed_data.filter(b => b.unjail_time).map(b => { return { ...b, response_time: b.unjail_time - b.time }}), 'response_time') : -1;
            v.num_blocks_jailed = numJailed;
          }
        }
        else {
          v.times_jailed = 0;
          v.avg_jail_response_time = 0;
          v.num_blocks_jailed = 0;
        }
      }
      else {
        v.times_jailed = 0;
        v.avg_jail_response_time = 0;
        v.num_blocks_jailed = 0;
      }
      data[i] = v;
    }

    data = data.filter(v => v?.start_height <= to_block);
    return { data };
  };

  // parse function event to req
  const req = {
    body: (event.body && JSON.parse(event.body)) || {},
    query: event.queryStringParameters || {},
    params: event.pathParameters || {},
    method: event.requestContext?.http?.method,
    url: event.routeKey?.replace('ANY ', ''),
    headers: event.headers,
  };

  // initial response
  let response, res;  

  if (config?.[environment]) {
    // request api
    res = await requester.get('', { params: { module: 'rpc', path: '/status' } })
      .catch(error => { return { data: { results: null, error } }; });

    const latest_block = Number(res.data.latest_block_height);
    if (latest_block > snapshot_block_size) {
      const snapshot_block = latest_block - (latest_block % snapshot_block_size);
      // request api
      res = await requester.post('', { params: {
        module: 'index',
        index: 'historical',
        method: 'search',
        query: {
          bool: {
            must: [
              { match: { snapshot_block } },
            ],
          },
        },
        size: 0,
      } }).catch(error => { return { data: { error } }; });

      if (!(res?.data?.total > 0)) {
        // request api
        res = await requester.post('', { params: {
          module: 'index',
          index: 'historical',
          method: 'search',
          sort: [{ snapshot_block: 'desc' }],
          size: 1,
        } }).catch(error => { return { data: { error } }; });

        const last_snapshot_block = res?.data?.[0]?.snapshot_block;
        const from_block = (last_snapshot_block ? last_snapshot_block : snapshot_block - snapshot_block_size) + 1;
        const to_block = snapshot_block;

        // request api
        res = await requester.get('', { params: {
          module: 'data',
          collection: 'assets',
        } }).catch(error => { return { data: null }; });

        const denoms = res?.data;
        res = await allValidators(from_block, to_block, denoms, avg_block_time_ms);
        response = res?.data;

        if (response?.length > 0) {
          const validators_data = response;
          for (let i = 0; i < validators_data.length; i++) {
            const v = validators_data[i];

            const toDeleteFields = ['missed_blocks_counter'];
            for (let j = 0; j < toDeleteFields.length; j++) {
              delete v[toDeleteFields[j]];
            }
            const toNumberFields = ['unbonding_height', 'min_self_delegation'];
            for (let j = 0; j < toNumberFields.length; j++) {
              v[toNumberFields[j]] = Number(v[toNumberFields[j]]);
            }
            const toTimestampFields = ['unbonding_time'];
            for (let j = 0; j < toTimestampFields.length; j++) {
              v[toTimestampFields[j]] = v[toTimestampFields[j]] && moment(v[toTimestampFields[j]]).valueOf();
            }
            const toNormalizeUnitFields = ['tokens', 'delegator_shares', 'self_delegation'];
            for (let j = 0; j < toNormalizeUnitFields.length; j++) {
              v[toNormalizeUnitFields[j]] = denomer.amount(Number(v[toNormalizeUnitFields[j]]), 'uaxl', denoms);
            }

            if (v.commission) {
              if (v.commission.update_time) {
                v.commission.update_time = moment(v.commission.update_time).valueOf();
              }
              if (v.commission.commission_rates) {
                const _toNumberFields = ['rate', 'max_rate', 'max_change_rate'];
                for (let j = 0; j < _toNumberFields.length; j++) {
                  v.commission.commission_rates[_toNumberFields[j]] = Number(v.commission.commission_rates[_toNumberFields[j]]);
                }
              }
            }
            if (v.tss_illegibility_info) {
              v.tss_illegibility_info = Object.entries(v.tss_illegibility_info).filter(([key, value]) => value).map(([key, value]) => key);
            }

            const times_jailed_message = typeof v.times_jailed === 'number' ?
              v.times_jailed > 0 ? v.times_jailed :
                v.times_jailed < 0 ? 'Long Time Jailed' :
                  'Never Jailed'
              : '-';
            const avg_jail_response_time = typeof v.avg_jail_response_time === 'number' ?
              v.times_jailed > 0 ?
                v.avg_jail_response_time < 0 ? 'Never Unjailed' :
                  moment(v.avg_jail_response_time).diff(moment(0), 'seconds') < 60 ? `${moment(v.avg_jail_response_time).diff(moment(0), 'seconds')} sec` :
                    moment(v.avg_jail_response_time).diff(moment(0), 'minutes') < 60 ? `${moment(v.avg_jail_response_time).diff(moment(0), 'minutes')} min` :
                      `${moment(v.avg_jail_response_time).diff(moment(0), 'hours')} hrs`
                : v.times_jailed < 0 ?
                  'Never Unjailed' :
                  'Never Jailed'
              : '-';
            v.times_jailed_message = times_jailed_message;
            v.avg_jail_response_time_message = avg_jail_response_time;
            response[i] = v;

            // request api
            await requester.post('', {
              module: 'index',
              index: 'historical',
              method: 'set',
              id: `${snapshot_block}_${v?.operator_address}`,
              ...v,
              snapshot_block,
            }).catch(error => { return { data: { error } }; });
          }
        }
      }
    }
  }

  // return response
  return response;
};