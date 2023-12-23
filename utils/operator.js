const { toArray } = require('./parser');
const { isString, equalsIgnoreCase } = require('./string');

const find = (x, list = []) => list.find(_x => isString(x) ? equalsIgnoreCase(_x, x) : _x === x);

const includesStringList = (x, list = []) => toArray(list).findIndex(s => toArray(x).findIndex(_x => _x.includes(s)) > -1) > -1;

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  find,
  includesStringList,
  sleep,
};