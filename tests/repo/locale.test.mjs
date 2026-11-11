import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesModule } from '../support/pinned-pages.mjs';
const { normalizeConfig, createPagesState } = await pagesModule('src/state.js');

test('supported labels accept plain strings and preserve unresolved LocalizedText', () => {
  const config = normalizeConfig({ homeLabel: 'Workbench', managerLabel: { en: 'Pages', zh: '页面' } });
  assert.equal(config.homeLabel, 'Workbench');
  assert.deepEqual(config.managerLabel, { en: 'Pages', zh: '页面' });
  const state = createPagesState(config);
  const label = { en: 'Notes', zh: '笔记' };
  state.registerPage({ id: 'notes', label });
  assert.deepEqual(state.getSnapshot().pages[0].label, label, 'host locale resolves labels at render time');
});

test('malformed supported labels fail loud and null falls back to defaults', () => {
  for (const key of ['homeLabel', 'managerLabel']) {
    for (const value of ['', 12, { zh: '页面' }, { en: 'Pages', zh: 42 }]) {
      assert.throws(() => normalizeConfig({ [key]: value }), /non-empty string or LocalizedText/);
    }
    assert.deepEqual(normalizeConfig({ [key]: null })[key], normalizeConfig({})[key]);
  }
  const state = createPagesState(normalizeConfig({}));
  assert.throws(() => state.registerPage({ id: 'bad', label: { zh: '笔记' } }), /label/);
});
