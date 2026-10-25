import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCleanRootUrl,
  ensureApiV1Path,
  getHealthCheckUrl,
  cleanTrailingSlashes
} from '../apiConfig';

test('cleanTrailingSlashes: removes single and repeated trailing slashes', () => {
  assert.equal(cleanTrailingSlashes('https://netkeep.onrender.com/'), 'https://netkeep.onrender.com');
  assert.equal(cleanTrailingSlashes('https://netkeep.onrender.com///'), 'https://netkeep.onrender.com');
  assert.equal(cleanTrailingSlashes('http://localhost:8000'), 'http://localhost:8000');
});

test('getCleanRootUrl: extracts origin root whether input contains /api/v1 or not', () => {
  assert.equal(getCleanRootUrl('https://netkeep.onrender.com'), 'https://netkeep.onrender.com');
  assert.equal(getCleanRootUrl('https://netkeep.onrender.com/'), 'https://netkeep.onrender.com');
  assert.equal(getCleanRootUrl('https://netkeep.onrender.com/api/v1'), 'https://netkeep.onrender.com');
  assert.equal(getCleanRootUrl('https://netkeep.onrender.com/api/v1/'), 'https://netkeep.onrender.com');
  assert.equal(getCleanRootUrl(''), '');
  assert.equal(getCleanRootUrl(undefined), '');
});

test('ensureApiV1Path: attaches /api/v1 idempotently without duplicating /api/v1', () => {
  assert.equal(ensureApiV1Path('https://netkeep.onrender.com'), 'https://netkeep.onrender.com/api/v1');
  assert.equal(ensureApiV1Path('https://netkeep.onrender.com/'), 'https://netkeep.onrender.com/api/v1');
  assert.equal(ensureApiV1Path('https://netkeep.onrender.com/api/v1'), 'https://netkeep.onrender.com/api/v1');
  assert.equal(ensureApiV1Path('https://netkeep.onrender.com/api/v1/'), 'https://netkeep.onrender.com/api/v1');
  assert.equal(ensureApiV1Path('http://localhost:8000'), 'http://localhost:8000/api/v1');
  assert.equal(ensureApiV1Path('http://localhost:8000/api/v1'), 'http://localhost:8000/api/v1');
  assert.equal(ensureApiV1Path(''), '');
});

test('getHealthCheckUrl: returns root /health endpoint accurately', () => {
  assert.equal(getHealthCheckUrl('https://netkeep.onrender.com'), 'https://netkeep.onrender.com/health');
  assert.equal(getHealthCheckUrl('https://netkeep.onrender.com/api/v1'), 'https://netkeep.onrender.com/health');
  assert.equal(getHealthCheckUrl('http://localhost:8000/api/v1'), 'http://localhost:8000/health');
  assert.equal(getHealthCheckUrl(''), '');
});
