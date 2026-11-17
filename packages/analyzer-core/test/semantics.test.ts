import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  RegistrySemantics,
  type SemanticProvider,
  type SemanticReference,
  type WebComponentRecord,
} from '../dist/index.js';

const source: SemanticReference = {
  id: 'semantic-1',
  projectId: 'project',
  snapshotId: 'snapshot-1',
};
const target: SemanticReference = {
  id: 'semantic-2',
  projectId: 'project',
  snapshotId: 'snapshot-1',
};

function recordingProvider() {
  const assignableCalls: [SemanticReference, SemanticReference][] = [];
  const memberCalls: [string, string][] = [];
  const provider: SemanticProvider = {
    async getMemberType(componentId, memberName) {
      memberCalls.push([componentId, memberName]);
      return {text: 'number', reference: target};
    },
    async isAssignable(from, to) {
      assignableCalls.push([from, to]);
      return from.id === to.id;
    },
  };
  return {provider, assignableCalls, memberCalls};
}

test('assignability forwards opaque references, never display text', async () => {
  const {provider, assignableCalls} = recordingProvider();
  const semantics = new RegistrySemantics(provider);
  const result = await semantics.isAssignable(source, target);
  assert.equal(result, false);
  assert.deepEqual(assignableCalls, [[source, target]]);
});

test('member type queries delegate to the provider', async () => {
  const {provider, memberCalls} = recordingProvider();
  const semantics = new RegistrySemantics(provider);
  const query = await semantics.memberType('component#Id', 'count');
  assert.deepEqual(memberCalls, [['component#Id', 'count']]);
  assert.equal(query?.text, 'number');
  assert.equal(query?.reference, target);
});

test('member assignability uses the collected reference even when display text differs', async () => {
  const {provider, assignableCalls} = recordingProvider();
  const semantics = new RegistrySemantics(provider);
  const record = {
    members: [{memberName: 'count', declaration: {}, type: target}],
    declaration: {
      members: [{kind: 'field', name: 'count', type: {text: 'string'}}],
    },
  } as unknown as WebComponentRecord;
  await semantics.isAssignableToMember(source, record, 'count');
  assert.deepEqual(assignableCalls, [[source, target]]);
});

test('member without a collected reference is incomplete, not a successful check', async () => {
  const {provider} = recordingProvider();
  const semantics = new RegistrySemantics(provider);
  const record = {
    members: [{memberName: 'count', declaration: {}}],
    declaration: {
      members: [{kind: 'field', name: 'count', type: {text: 'number'}}],
    },
  } as unknown as WebComponentRecord;
  await assert.rejects(
    semantics.isAssignableToMember(source, record, 'count'),
    /no collected semantic type/
  );
});

test('cross-snapshot rejection propagates from the provider', async () => {
  const provider: SemanticProvider = {
    async getMemberType() {
      return undefined;
    },
    async isAssignable() {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    },
  };
  const semantics = new RegistrySemantics(provider);
  await assert.rejects(
    semantics.isAssignable(source, {...target, snapshotId: 'snapshot-2'}),
    /project|snapshot/i
  );
});
