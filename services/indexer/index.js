const _ = require('lodash');

const { normalizeSearchObjects, normalizeSearchParams, removeFieldsFromParams } = require('./utils');
const { createInstance, request } = require('../../utils/http');
const { toArray } = require('../../utils/parser');
const { log } = require('../../utils/logger');

const INDEXER_URL = process.env.INDEXER_URL;
const INDEXER_USERNAME = process.env.INDEXER_USERNAME;
const INDEXER_PASSWORD = process.env.INDEXER_PASSWORD;

const crud = async (params = {}) => {
  let response;
  // request parameters
  const _params = _.cloneDeep(params);
  const { collection, id, method, from, size, sort } = { ...params };
  params = normalizeSearchParams(params);
  const { use_raw_data, update_only, track_total_hits } = { ...params };
  let { path } = { ...params };
  params = normalizeSearchObjects(removeFieldsFromParams(params));

  if (INDEXER_URL && collection) {
    const indexer = createInstance(INDEXER_URL, { timeout: 30000, gzip: true });
    const auth = { username: INDEXER_USERNAME, password: INDEXER_PASSWORD };

    switch (method) {
      case 'get':
        path = path || `/${collection}/_doc/${id}`;
        response = await request(indexer, { path, params, auth });
        const { _id, _source } = { ...response };
        response = _source ? { ..._source, id: _id } : response;
        break;
      case 'set':
      case 'update':
        path = path || `/${collection}/_doc/${id}`;
        if (path.includes('/_update_by_query')) {
          response = await request(indexer, { method: 'post', path, params, auth });
        }
        else {
          response = await request(indexer, { method: path.includes('_update') ? 'post' : 'put', path, params: path.includes('_update') ? { doc: params } : params, auth });
          const { error } = { ...response };
          // retry with update / insert
          if (error) {
            path = path.replace(path.includes('_doc') ? '_doc' : '_update', path.includes('_doc') ? '_update' : '_doc');
            if (update_only && path.includes('_doc')) {
              const { _id, _source } = { ...await request(indexer, { path, auth }) };
              if (_source) path = path.replace('_doc', '_update');
            }
            response = await request(indexer, { method: path.includes('_update') ? 'post' : 'put', path, params: path.includes('_update') ? { doc: params } : params, auth });
          }
        }
        break;
      case 'query':
      case 'search':
        path = path || `/${collection}/_search`;
        const searchData = use_raw_data ? params : {
          query: {
            bool: {
              must: Object.entries({ ...params }).filter(([k, v]) => !['query', 'aggs', 'from', 'size', 'sort', 'fields', '_source'].includes(k)).map(([k, v]) => {
                switch (k) {
                  case 'id':
                    if (!v && id) v = id;
                    break;
                  default:
                    break;
                }
                return { match: { [k]: v } };
              }),
            },
          },
        };
        if (path.endsWith('/_search')) {
          searchData.from = !isNaN(from) ? Number(from) : 0;
          searchData.size = !isNaN(size) ? Number(size) : 10;
          searchData.sort = sort;
          searchData.track_total_hits = track_total_hits;
        }
        response = await request(indexer, { method: 'post', path, params: searchData, auth });
        const { hits, aggregations } = { ...response };
        if (hits?.hits || aggregations) {
          response = {
            data: toArray(hits?.hits).map(d => {
              const { _id, _source, fields } = { ...d };
              return { ..._source, ...fields, id: _id };
            }),
            total: hits?.total?.value,
            aggs: aggregations,
          };
        }
        break;
      case 'delete':
      case 'remove':
        path = path || `/${collection}/_doc/${id}`;
        response = await request(indexer, { method: 'delete', path, params, auth });
        break;
      default:
        break;
    }

    // log & remove error
    if (response?.error) {
      if (!['get', 'delete', 'remove'].includes(method)) log('debug', 'indexer', 'request to opensearch', { params: _params, error: response.error });
      delete response.error;
    }
  }
  return response;
};

const get = async (collection, id) => await crud({ method: 'get', collection, id });

const read = async (collection, query, params = {}) => await crud({ method: 'query', collection, query, use_raw_data: true, ...params });

const write = async (collection, id, data = {}, update_only = false, is_update = true) => await crud({ method: 'set', collection, id, path: is_update ? `/${collection}/_update/${id}` : undefined, update_only, ...data });

const remove = async (collection, id) => await crud({ method: 'delete', collection, id });

const deleteByQuery = async (collection, query, params = {}) => await crud({ method: 'query', collection, path: `/${collection}/_delete_by_query`, query, use_raw_data: true, ...params });

const getMapping = async collection => await crud({ method: 'get', collection, path: `/${collection}/_mapping` });

module.exports = {
  crud,
  get,
  read,
  write,
  remove,
  deleteByQuery,
  getMapping,
};