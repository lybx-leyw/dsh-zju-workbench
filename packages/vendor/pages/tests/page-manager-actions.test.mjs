import test from 'node:test';
import assert from 'node:assert/strict';
import { createPages } from '../src/pages-service.js';

/** The manager component is presentation-only, so its behavior is asserted through the actions it is given. */
function actionsFor(service) {
  return {
    selectPage: service.selectPage,
    setPageRegion: service.setPageRegion,
    setPageOrder: service.setPageOrder,
    promotePage: service.promotePage,
  };
}

test('manager actions reorder, regroup, hide and restore through one registry', () => {
  const { service, dispose } = createPages({ preferences: null });
  const actions = actionsFor(service);
  actions.setPageOrder('pages', -5);
  assert.equal(service.getSnapshot().pages[0].id, 'pages');
  actions.setPageRegion('pages', 'top');
  assert.equal(service.getSnapshot().pages.find(page => page.id === 'pages').region, 'top');
  // Third-party pages and the manager use the same group actions.
  const remove = service.registerPage({ id: 'notes', label: { en: 'Notes' }, order: 10 });
  actions.setPageRegion('notes', 'overflow');
  assert.equal(service.getSnapshot().pages.find(page => page.id === 'notes').region, 'overflow');
  actions.setPageRegion('notes', 'bottom');
  actions.promotePage('notes');
  assert.equal(service.getSnapshot().pages[0].id, 'notes');
  actions.selectPage('notes');
  assert.equal(service.getSnapshot().activePage, 'notes');
  remove();
  assert.equal(service.getSnapshot().activePage, 'home');
  dispose();
});

test('manager keeps working when the active page is removed by another registrant', () => {
  const { service, dispose } = createPages({ preferences: null });
  const remove = service.registerPage({ id: 'scratch', label: { en: 'Scratch' }, order: 5 });
  service.selectPage('scratch');
  assert.equal(service.getSnapshot().activePage, 'scratch');
  remove();
  assert.equal(service.getSnapshot().activePage, 'home');
  assert.throws(() => service.selectPage('scratch'), /unknown page/);
  dispose();
});
