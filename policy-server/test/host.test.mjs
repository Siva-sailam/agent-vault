import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHost } from '../src/config.mjs';

test('POLICY_HOST unset or blank -> loopback (laptop behaviour unchanged)', () => {
  assert.equal(resolveHost({}), '127.0.0.1');
  assert.equal(resolveHost({ POLICY_HOST: '' }), '127.0.0.1');
  assert.equal(resolveHost({ POLICY_HOST: '  ' }), '127.0.0.1');
});

test('POLICY_HOST overrides the listen address', () => {
  assert.equal(resolveHost({ POLICY_HOST: '0.0.0.0' }), '0.0.0.0');
  assert.equal(resolveHost({ POLICY_HOST: ' 10.0.0.5 ' }), '10.0.0.5');
});
